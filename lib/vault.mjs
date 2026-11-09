import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { TOTP, Secret } from 'otpauth';
import { HttpError } from './validation.mjs';

const totp = secret => new TOTP({issuer:'归屿 · 账号档案',label:'密码查看',algorithm:'SHA1',digits:6,period:30,secret});

export function createVault(db, keyPath) {
  const settings = () => db.prepare('SELECT * FROM vault_settings WHERE id=1').get();
  let key;
  if (!keyPath) key=randomBytes(32); // In-memory databases only.
  else {
    try { key=readFileSync(keyPath); }
    catch(error) {
      if(error.code!=='ENOENT')throw error;
      if(settings().keyCheck)throw new Error('加密密钥丢失，请恢复原密钥；不能生成新密钥替代。');
      mkdirSync(dirname(keyPath),{recursive:true,mode:0o700});
      try { writeFileSync(keyPath,randomBytes(32),{flag:'wx',mode:0o600}); }
      catch(error) { if(error.code!=='EEXIST')throw error; }
      key=readFileSync(keyPath);
    }
    if(![0o600,0o640].includes(statSync(keyPath).mode & 0o777))throw new Error('请将加密密钥权限设置为 0600 或 0640。');
  }
  if(key.length!==32)throw new Error('加密密钥格式错误，请恢复原密钥。');
  function encrypt(value, purpose) {
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv,{authTagLength:16});
    cipher.setAAD(Buffer.from(purpose));
    const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
    return ['v1',iv.toString('base64'),cipher.getAuthTag().toString('base64'),data.toString('base64')].join('.');
  }
  function decrypt(value,purpose) {
    try {
      const [version,iv,tag,data,...extra]=value.split('.');
      if(version!=='v1'||extra.length||!iv||!tag||data===undefined)throw new Error();
      const nonce=Buffer.from(iv,'base64'),authTag=Buffer.from(tag,'base64');
      if(nonce.length!==12||authTag.length!==16)throw new Error();
      const decipher=createDecipheriv('aes-256-gcm',key,nonce,{authTagLength:16});
      decipher.setAAD(Buffer.from(purpose));decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(Buffer.from(data,'base64')),decipher.final()]).toString('utf8');
    } catch { throw new Error('加密数据校验失败，请检查密钥或恢复备份。'); }
  }
  const check=settings().keyCheck;
  if(check) { if(decrypt(check,'key-check')!=='account-archive-v1')throw new Error('加密密钥不匹配。'); }
  else db.prepare('UPDATE vault_settings SET keyCheck=? WHERE id=1').run(encrypt('account-archive-v1','key-check'));
  function checkRate() {
    const state=settings();
    if(state.lockedUntil>Date.now())throw new HttpError(429,'验证失败次数过多，请 15 分钟后重试。');
    if(state.lockedUntil)db.prepare('UPDATE vault_settings SET failures=0,lockedUntil=0 WHERE id=1').run();
  }
  function fail(message='验证码不正确或已过期。') {
    db.prepare('UPDATE vault_settings SET failures=failures+1,lockedUntil=CASE WHEN failures+1>=5 THEN ? ELSE 0 END WHERE id=1').run(Date.now()+15*60_000);
    throw new HttpError(400,message);
  }
  function stepFor(secret,code) {
    if(typeof code!=='string'||!/^\d{6}$/.test(code))return fail('请输入 6 位动态验证码。');
    const now=Date.now(),delta=totp(secret).validate({token:code,timestamp:now,window:1});
    if(delta===null)return fail();
    return Math.floor(now/30_000)+delta;
  }
  function verifyTotp(code) {
    checkRate();
    const state=settings();
    if(!state.totpSecret)throw new HttpError(403,'请先绑定验证器。');
    const step=stepFor(decrypt(state.totpSecret,'totp'),code);
    if(step<=state.lastStep)throw new HttpError(409,'这个验证码已经使用，请等待验证器生成下一个验证码。');
    // Claim the time step in SQLite before decrypting, across sessions and restarts.
    const claimed=db.prepare('UPDATE vault_settings SET lastStep=?,failures=0,lockedUntil=0 WHERE id=1 AND lastStep<? AND totpSecret=?').run(step,step,state.totpSecret);
    if(claimed.changes!==1)throw new HttpError(409,'验证码已被使用或绑定状态已变化，请重新验证。');
  }
  const passkey=()=>db.prepare('SELECT * FROM passkey_credentials WHERE id=1').get();
  function passwordRow(account) {
    const row=db.prepare('SELECT ciphertext FROM account_secrets WHERE account=?').get(account);
    if(!row)throw new HttpError(404,'这个账号没有保存密码。');
    return row;
  }
  return {
    enabled:()=>!!settings().totpSecret,
    checkRate,fail,verifyTotp,passkey,passwordRow,
    generation:()=>settings().generation,
    savePasskey(credential,userId,generation) {
      db.exec('BEGIN IMMEDIATE');
      try {
        if(!settings().totpSecret||settings().generation!==generation)throw new HttpError(409,'安全设置已变化，请重新绑定。');
        db.prepare('INSERT OR REPLACE INTO passkey_credentials VALUES(1,?,?,?,?,?,?)').run(credential.id,credential.publicKey,userId,credential.counter,JSON.stringify(credential.transports||[]),new Date().toISOString());
        db.prepare('UPDATE vault_settings SET generation=generation+1,failures=0,lockedUntil=0 WHERE id=1').run();
        db.exec('COMMIT');
      } catch(error) { db.exec('ROLLBACK');throw error; }
    },
    removePasskey() {
      db.exec('BEGIN IMMEDIATE; DELETE FROM passkey_credentials; UPDATE vault_settings SET generation=generation+1 WHERE id=1; COMMIT;');
    },
    revealWithPasskey(account,credential,newCounter,generation) {
      if(!settings().totpSecret||settings().generation!==generation)throw new HttpError(409,'安全设置已变化，请重新验证。');
      const row=passwordRow(account);
      const claimed=db.prepare('UPDATE passkey_credentials SET counter=? WHERE id=1 AND credentialId=? AND counter=? AND EXISTS(SELECT 1 FROM vault_settings WHERE id=1 AND generation=? AND totpSecret IS NOT NULL)').run(newCounter,credential.credentialId,credential.counter,generation);
      if(claimed.changes!==1)throw new HttpError(409,'通行密钥已变化，请重新验证。');
      db.prepare('UPDATE vault_settings SET failures=0,lockedUntil=0 WHERE id=1').run();
      return decrypt(row.ciphertext,'account:'+account);
    },
    beginEnrollment() {
      checkRate();
      const state=settings();
      if(state.totpSecret)throw new HttpError(409,'已经绑定验证器。更换验证器需要通过服务器重置。');
      const secret=new Secret({size:20}).base32;
      return {secret,uri:totp(secret).toString(),generation:state.generation};
    },
    confirmEnrollment(pending,code) {
      checkRate();
      const state=settings();
      if(state.totpSecret||state.generation!==pending.generation)throw new HttpError(409,'绑定状态已变化，请刷新页面。');
      const step=stepFor(pending.secret,code);
      const result=db.prepare('UPDATE vault_settings SET totpSecret=?,lastStep=?,failures=0,lockedUntil=0,generation=generation+1 WHERE id=1 AND totpSecret IS NULL AND generation=?')
        .run(encrypt(pending.secret,'totp'),step,pending.generation);
      if(result.changes!==1)throw new HttpError(409,'绑定状态已变化，请刷新页面。');
    },
    save(account,password,removePassword) {
      if(password!==undefined&&(typeof password!=='string'||password.length>4096||password.includes('\0')||!password.isWellFormed()))throw new HttpError(400,'账号密码不能超过 4096 个字符或包含无效字符。');
      if(removePassword!==undefined&&typeof removePassword!=='boolean')throw new HttpError(400,'移除密码选项无效。');
      if(password&&removePassword)throw new HttpError(400,'填写新密码和移除密码不能同时选择。');
      if(password) {
        if(!settings().totpSecret)throw new HttpError(403,'请先在安全设置中绑定验证器，再保存账号密码。');
        db.prepare('INSERT INTO account_secrets(account,ciphertext) VALUES(?,?) ON CONFLICT(account) DO UPDATE SET ciphertext=excluded.ciphertext').run(account,encrypt(password,'account:'+account));
        return '已设置或更新加密密码。';
      }
      if(removePassword) {
        db.prepare('DELETE FROM account_secrets WHERE account=?').run(account);
        return '已移除保存的密码。';
      }
      return '';
    },
    reveal(account,code) {
      const row=passwordRow(account);
      verifyTotp(code);
      return decrypt(row.ciphertext,'account:'+account);
    },
  };
}
