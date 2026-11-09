import { randomBytes } from 'node:crypto';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { HttpError } from './validation.mjs';

export function createPasskeys(vault, sessionActive) {
  const pending=new Map();
  function begin(token,origin,account) {
    if(!sessionActive(token))throw new HttpError(401,'登录已过期，请重新登录。');
    vault.checkRate();
    if(!vault.enabled())throw new HttpError(403,'请先绑定验证器。');
    for(const [key,value] of pending)if(value.expires<=Date.now()||!sessionActive(key))pending.delete(key);
    const state={origin,rpID:new URL(origin).hostname,account,challenge:randomBytes(32),generation:vault.generation(),expires:Date.now()+120_000};
    pending.set(token,state);
    return state;
  }
  function check(token,state) {
    if(pending.get(token)!==state)throw new HttpError(409,'验证请求已取消，请重新开始。');
    if(!sessionActive(token))throw new HttpError(401,'登录已过期，请重新登录。');
    if(state.expires<=Date.now()||state.generation!==vault.generation())throw new HttpError(409,'验证已过期或安全设置已变化，请重新验证。');
    vault.checkRate();
  }
  function take(token,origin,account) {
    const state=pending.get(token);
    if(!state||state.used||state.origin!==origin||state.account!==account)throw new HttpError(400,'验证请求已失效，请重新开始。');
    state.used=true;check(token,state);
    return state;
  }
  const expected=state=>({expectedChallenge:state.challenge.toString('base64url'),expectedOrigin:state.origin,expectedRPID:state.rpID,requireUserVerification:true});
  return {
    cancel:token=>pending.delete(token),
    async registrationOptions(token,origin) {
      const state=begin(token,origin,null),existing=vault.passkey();
      state.userId=existing?.userId||randomBytes(32);
      return generateRegistrationOptions({rpName:'归屿 · 账号档案',rpID:state.rpID,userName:'账号档案',userID:state.userId,challenge:state.challenge,timeout:120_000,attestationType:'none',
        excludeCredentials:existing?[{id:existing.credentialId,transports:JSON.parse(existing.transports)}]:[],
        authenticatorSelection:{authenticatorAttachment:'platform',residentKey:'preferred',userVerification:'required'}});
    },
    async register(token,origin,response) {
      const state=take(token,origin,null);let result;
      try { result=await verifyRegistrationResponse({response,...expected(state)}); }
      catch { vault.fail('系统验证失败，请重新绑定通行密钥。'); }
      check(token,state);
      if(!result.verified)vault.fail('系统验证失败，请重新绑定通行密钥。');
      vault.savePasskey(result.registrationInfo.credential,state.userId,state.generation);pending.delete(token);
    },
    async authenticationOptions(token,origin,account) {
      const credential=vault.passkey();
      if(!credential)throw new HttpError(409,'尚未绑定通行密钥，请使用 2FA 验证码。');
      vault.passwordRow(account);
      const state=begin(token,origin,account);state.credential=credential;
      return generateAuthenticationOptions({rpID:state.rpID,challenge:state.challenge,timeout:120_000,userVerification:'required',allowCredentials:[{id:credential.credentialId,transports:JSON.parse(credential.transports)}]});
    },
    async reveal(token,origin,account,response) {
      const state=take(token,origin,account),credential=state.credential;let result;
      try {
        if(response?.id!==credential.credentialId||response.response?.userHandle&&response.response.userHandle!==Buffer.from(credential.userId).toString('base64url'))throw new Error();
        result=await verifyAuthenticationResponse({response,...expected(state),credential:{id:credential.credentialId,publicKey:credential.publicKey,counter:credential.counter,transports:JSON.parse(credential.transports)}});
      } catch { vault.fail('系统验证失败，请重试或使用 2FA 验证码。'); }
      check(token,state);
      if(!result.verified)vault.fail('系统验证失败，请重试或使用 2FA 验证码。');
      const password=vault.revealWithPasskey(account,credential,result.authenticationInfo.newCounter,state.generation);pending.delete(token);return password;
    },
  };
}
