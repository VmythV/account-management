import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { TOTP } from 'otpauth';
import { openStore } from '../lib/store.mjs';
import { createPasskeys } from '../lib/passkeys.mjs';
import { authenticator } from './helpers/authenticator.mjs';

const origin='https://accounts.example.com',token='session-1';
async function fixture(t) {
  const store=openStore(':memory:');t.after(()=>store.close());
  const v=store.vault,p=v.beginEnrollment();v.confirmEnrollment(p,new TOTP({secret:p.secret}).generate());
  const account=store.saveAccount({name:'Site',identifier:'me',type:'账号',status:'正常',password:'secret-for-test'});
  let active=true;const keys=createPasskeys(v,()=>active),device=authenticator(),options=await keys.registrationOptions(token,origin);
  await keys.register(token,origin,device.register(options,origin));
  return {store,v,keys,device,account,active:value=>{active=value;}};
}
test('真实公钥注册和签名：UV 必需，逐次查看、零计数器、并发和跨账号防重放',async t=>{
  const {v,keys,device,account,store}=await fixture(t);
  assert.equal(store.archive().security.passkeyEnabled,true);
  assert.equal(JSON.stringify(store.archive()).includes(v.passkey().credentialId),false);
  let options=await keys.authenticationOptions(token,origin,account);
  assert.equal(options.userVerification,'required');assert.equal(options.allowCredentials.length,1);
  let response=device.authenticate(options,origin);
  const both=await Promise.allSettled([keys.reveal(token,origin,account,response),keys.reveal(token,origin,account,response)]);
  assert.equal(both.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(both.find(x=>x.status==='fulfilled').value,'secret-for-test');
  await assert.rejects(keys.reveal(token,origin,account,response));
  options=await keys.authenticationOptions(token,origin,account);
  await assert.rejects(keys.reveal(token,origin,'another-account',device.authenticate(options,origin)));
  assert.equal(await keys.reveal(token,origin,account,device.authenticate(options,origin)),'secret-for-test');
  options=await keys.authenticationOptions(token,origin,account);
  assert.equal(await keys.reveal(token,origin,account,device.authenticate(options,origin,{counter:1})),'secret-for-test');
  options=await keys.authenticationOptions(token,origin,account);
  await assert.rejects(keys.reveal(token,origin,account,device.authenticate(options,origin,{counter:1})),/系统验证失败/);
});
test('拒绝错误来源、RP、挑战、签名、UV、用户句柄及错误凭据；持久限流',async t=>{
  const f=await fixture(t),{keys,device,account}=f;
  const bad=[{client:{origin:'https://evil.example'}},{rpID:'evil.example'},{client:{challenge:'invalid'}},{flags:1},{privateKey:generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey},{userHandle:'wrong-user'}];
  for(const override of bad){
    // Each valid verification clears the shared persisted failure counter.
    let o=await keys.authenticationOptions(token,origin,account);assert.equal(await keys.reveal(token,origin,account,device.authenticate(o,origin)),'secret-for-test');
    o=await keys.authenticationOptions(token,origin,account);
    await assert.rejects(keys.reveal(token,origin,account,device.authenticate(o,origin,override)),/系统验证失败/);
  }
  for(let i=0;i<4;i++){
    const o=await keys.authenticationOptions(token,origin,account),response=authenticator().authenticate(o,origin);
    await assert.rejects(keys.reveal(token,origin,account,response),/系统验证失败/);
  }
  await assert.rejects(keys.authenticationOptions(token,origin,account),{status:429});
});
test('取消、过期、会话退出、撤销和更换密钥都阻止未完成的查看',async t=>{
  const {keys,device,account,v,active}=await fixture(t);
  let o=await keys.authenticationOptions(token,origin,account);keys.cancel(token);
  await assert.rejects(keys.reveal(token,origin,account,device.authenticate(o,origin)));
  o=await keys.authenticationOptions(token,origin,account);
  await assert.rejects(keys.reveal('another-session',origin,account,device.authenticate(o,origin)));
  active(false);await assert.rejects(keys.reveal(token,origin,account,device.authenticate(o,origin)),{status:401});active(true);
  o=await keys.authenticationOptions(token,origin,account);
  const oldNow=Date.now;Date.now=()=>oldNow()+121_000;
  try{await assert.rejects(keys.reveal(token,origin,account,device.authenticate(o,origin)),{status:409});}finally{Date.now=oldNow;}
  o=await keys.authenticationOptions(token,origin,account);
  const inFlight=keys.reveal(token,origin,account,device.authenticate(o,origin));keys.cancel(token);
  await assert.rejects(inFlight,{status:409});
  o=await keys.authenticationOptions(token,origin,account);v.removePasskey();
  await assert.rejects(keys.reveal(token,origin,account,device.authenticate(o,origin)),{status:409});
  await assert.rejects(keys.authenticationOptions(token,origin,account),{status:409});
});
test('注册需要用户验证，挑战仅用一次；取消、更换及异步验证中的重置不接受旧凭据',async t=>{
  const {v,keys,device,account}=await fixture(t),replacement=authenticator();
  let o=await keys.registrationOptions(token,origin);
  assert.equal(o.authenticatorSelection.authenticatorAttachment,'platform');assert.equal(o.authenticatorSelection.userVerification,'required');
  await assert.rejects(keys.register(token,origin,replacement.register(o,origin,{flags:0x41})),/系统验证失败/);
  await assert.rejects(keys.register(token,origin,replacement.register(o,origin)));
  o=await keys.registrationOptions(token,origin);keys.cancel(token);await assert.rejects(keys.register(token,origin,replacement.register(o,origin)));
  o=await keys.registrationOptions(token,origin);const pending=keys.register(token,origin,replacement.register(o,origin));v.removePasskey();await assert.rejects(pending,{status:409});
  o=await keys.registrationOptions(token,origin);await keys.register(token,origin,replacement.register(o,origin));
  o=await keys.authenticationOptions(token,origin,account);await assert.rejects(keys.reveal(token,origin,account,device.authenticate(o,origin)),/系统验证失败/);
  o=await keys.authenticationOptions(token,origin,account);assert.equal(await keys.reveal(token,origin,account,replacement.authenticate(o,origin)),'secret-for-test');
});
