import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { TOTP } from 'otpauth';
import { openStore } from '../lib/store.mjs';

const account=(extra={})=>({name:'测试',identifier:'demo',type:'平台',status:'正常',...extra});
function fixture(t){
  const dir=mkdtempSync(join(tmpdir(),'archive-vault-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'db.sqlite'),keyPath=join(dir,'keys','vault.key');
  let store=openStore(path,{keyPath});t.after(()=>store.close());
  const original=Date.now;let now=1_800_000_000_000;Date.now=()=>now;t.after(()=>{Date.now=original;});
  return {path,keyPath,get store(){return store;},advance(ms=30_000){now+=ms;},restart(change){store.close();change?.();store=openStore(path,{keyPath});},bind(){const pending=store.vault.beginEnrollment(),otp=new TOTP({secret:pending.secret});store.vault.confirmEnrollment(pending,otp.generate({timestamp:now}));return {pending,code:()=>otp.generate({timestamp:now})};}};
}

test('密码与 TOTP 密钥加密落库；接口和记录不泄露；逐次验证与跨账号、重启防重放',t=>{
  const f=fixture(t),{pending,code}=f.bind();
  const secret='  <&> 密码🔑\n保留空格  ';
  const id=f.store.saveAccount(account({password:secret}));
  const other=f.store.saveAccount(account({identifier:'other',password:'second-password'}));
  const archive=f.store.archive();assert.equal(archive.accounts.find(a=>a.id===id).hasPassword,true);
  assert.equal(JSON.stringify(archive).includes(secret),false);assert.equal(JSON.stringify(archive).includes(pending.secret),false);
  for(const value of [secret,pending.secret])assert.equal(readFileSync(f.path).includes(Buffer.from(value)),false);
  assert.equal(statSync(f.keyPath).mode & 0o777,0o600);
  assert.throws(()=>f.store.vault.reveal(id,code()),{status:409},'绑定时的验证码已经消耗');
  f.advance();assert.equal(f.store.vault.reveal(id,code()),secret);
  assert.throws(()=>f.store.vault.reveal(other,code()),{status:409});f.restart();
  assert.throws(()=>f.store.vault.reveal(id,code()),{status:409});
  f.advance();assert.equal(f.store.vault.reveal(other,code()),'second-password');
  assert.throws(()=>f.store.vault.beginEnrollment(),{status:409});
});

test('加密使用随机 nonce 和账号绑定；篡改、交换密文和错误密钥均无法解密',t=>{
  const f=fixture(t),{code}=f.bind();
  const id=f.store.saveAccount(account({password:'same-value'}));
  const other=f.store.saveAccount(account({identifier:'other',password:'same-value'}));
  const db=new DatabaseSync(f.path);t.after(()=>db.close());
  const first=db.prepare('SELECT ciphertext FROM account_secrets WHERE account=?').get(id).ciphertext;
  const second=db.prepare('SELECT ciphertext FROM account_secrets WHERE account=?').get(other).ciphertext;
  assert.notEqual(first,second);
  db.prepare('UPDATE account_secrets SET ciphertext=? WHERE account=?').run(second,id);
  f.advance();assert.throws(()=>f.store.vault.reveal(id,code()),/加密数据校验失败/);
  const tampered=first.split('.');tampered[2]=Buffer.alloc(16).toString('base64');
  db.prepare('UPDATE account_secrets SET ciphertext=? WHERE account=?').run(tampered.join('.'),id);
  f.advance();assert.throws(()=>f.store.vault.reveal(id,code()),/加密数据校验失败/);
  const correct=readFileSync(f.keyPath);writeFileSync(f.keyPath,Buffer.alloc(32));
  assert.throws(()=>openStore(f.path,{keyPath:f.keyPath}),/加密数据校验失败/);
  unlinkSync(f.keyPath);assert.throws(()=>openStore(f.path,{keyPath:f.keyPath}),/密钥丢失/);
  writeFileSync(f.keyPath,correct,{mode:0o600});
});

test('密码更改、保留和移除与账号事务一致；失败回滚，不记录明文',t=>{
  const f=fixture(t),{code}=f.bind();
  const id=f.store.saveAccount(account({password:' first '}));
  f.store.saveAccount(account({version:1,password:''}),id);
  f.advance();assert.equal(f.store.vault.reveal(id,code()),' first ');
  assert.throws(()=>f.store.saveAccount(account({version:1,password:'stale'}),id),{status:409});
  assert.throws(()=>f.store.saveAccount(account({version:2,password:'new',removePassword:true}),id),{status:400});
  assert.throws(()=>f.store.saveAccount(account({version:2,password:'new',source:'missing',newTags:['rollback'],tagIds:['missing']}),id),{status:404});
  assert.equal(f.store.archive().accounts[0].version,2);
  assert.equal(f.store.archive().tags.length,0);
  f.store.saveAccount(account({version:2,password:'second'}),id);f.advance();assert.equal(f.store.vault.reveal(id,code()),'second');
  f.store.saveAccount(account({version:3,removePassword:true}),id);
  assert.equal(f.store.archive().accounts[0].hasPassword,false);
  assert.throws(()=>f.store.vault.reveal(id,code()),{status:404});
  for(const value of [42,{},'x'.repeat(4097),'bad\0value','\ud800'])assert.throws(()=>f.store.saveAccount(account({version:4,password:value}),id),{status:400});
});

test('错误和过期验证码限流持久化；服务器重置不解密密码且旧绑定失效',t=>{
  const f=fixture(t),{pending,code}=f.bind();
  const id=f.store.saveAccount(account({password:'keep-encrypted'}));
  const expired=code();f.advance(120_000);
  assert.throws(()=>f.store.vault.reveal(id,expired),{status:400});
  for(let i=0;i<4;i++)assert.throws(()=>f.store.vault.reveal(id,'invalid'),{status:400});
  f.restart();assert.throws(()=>f.store.vault.reveal(id,code()),{status:429});
  f.advance(15*60_000);assert.equal(f.store.vault.reveal(id,code()),'keep-encrypted');
  let out;f.restart(()=>{out=execFileSync(process.execPath,['scripts/reset-2fa.mjs','--confirm-reset'],{env:{...process.env,DATABASE_PATH:f.path},encoding:'utf8'});});
  assert.match(out,/保持加密/);
  assert.equal(f.store.vault.enabled(),false);
  assert.throws(()=>f.store.vault.reveal(id,code()),{status:403});
  assert.throws(()=>f.store.vault.confirmEnrollment(pending,code()),{status:409});
  const rebound=f.bind();f.advance();assert.equal(f.store.vault.reveal(id,rebound.code()),'keep-encrypted');
});

test('版本 2 升级只新增密码表；原有数据保留且默认无密码、未绑定',t=>{
  const f=fixture(t);f.store.saveAccount(account());const before=JSON.stringify(f.store.archive());
  f.restart(()=>{const db=new DatabaseSync(f.path);db.exec('DROP TABLE account_secrets; DROP TABLE vault_settings; PRAGMA user_version=2;');db.close();});
  assert.equal(JSON.stringify(f.store.archive()),before);
});
