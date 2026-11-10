import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createApp } from '../server.mjs';
import { TOTP } from 'otpauth';
import { authenticator } from './helpers/authenticator.mjs';

function rawRequest(url,{method='GET',headers={},body}={}) {
  return new Promise((resolve,reject)=>{
    if(body!==undefined)headers={'Content-Length':Buffer.byteLength(body),...headers};
    const req=httpRequest(url,{method,headers},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));
      res.on('end',()=>{const value=Buffer.concat(chunks).toString();const responseHeaders=new Headers();for(const [key,value] of Object.entries(res.headers))for(const item of [].concat(value??[]))responseHeaders.append(key,item);resolve({status:res.statusCode,headers:responseHeaders,text:value});});
    });
    req.on('error',reject);req.end(body);
  });
}

async function fixture(t,extra={}){
  const dir=mkdtempSync(join(tmpdir(),'archive-api-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const config={databasePath:join(dir,'db.sqlite'),authPath:join(dir,'access.json'),allowSetup:true,...extra};
  let server,base,cookie='';
  async function start(){server=createApp(config);server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;}
  async function stop(){const closing=once(server,'close');server.close();server.closeAllConnections();await closing;}
  await start();t.after(stop);
  async function request(path,method='GET',body,headers={}){
    const response=await rawRequest(base+path,{method,headers:{Cookie:cookie,...(method==='GET'?{}:{Origin:base,'X-Requested-With':'account-archive','Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const setCookie=response.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];
    const text=response.text;return {status:response.status,headers:response.headers,body:response.headers.get('content-type')?.includes('json')?JSON.parse(text):text};
  }
  return {config,request,get origin(){return base;},async restart(){await stop();await start();},setCookie(value){cookie=value;}};
}
const password='test-only-password-123';
test('HTTP 完整写入：账号、标签、关联、记录和订阅历史',async t=>{
  const {request:r}=await fixture(t);await r('/api/setup','POST',{password,confirm:password});
  const tag=(await r('/api/tags','POST',{name:'工作',color:'#12abcd'})).body.id;
  const payload={name:'Email',identifier:'demo',type:'邮箱',status:'正常',tagIds:[tag]};
  const a=(await r('/api/accounts','POST',payload)).body.id;
  const b=(await r('/api/accounts','POST',{...payload,name:'Site'})).body.id;
  assert.equal((await r(`/api/accounts/${a}`,'PUT',{...payload,notes:'编辑',version:1})).status,200);
  assert.equal((await r(`/api/tags/${tag}`,'PUT',{name:'工作新版',color:'#ffffff',version:1})).status,200);
  const relation=(await r('/api/relations','POST',{from:a,to:b,type:'邮箱注册'})).body.id;
  assert.equal((await r(`/api/relations/${relation}`,'PUT',{from:a,to:b,type:'恢复邮箱',version:1})).status,200);
  const e={account:a,date:'2025-01-01T00:00:00.000Z',title:'记录',text:'正文',kind:'账号记录'};
  const eid=(await r('/api/events','POST',e)).body.id;
  assert.equal((await r(`/api/events/${eid}`,'PUT',{...e,title:'更正记录',version:1})).status,200);
  const snapshot={occurredAt:'2025-01-01T00:00:00.000Z',action:'开通',plan:'Pro',status:'active',notes:'',renewalCycle:'none',renewalDay:null,renewalMonth:null};
  const subscription=(await r('/api/subscriptions','POST',{...snapshot,account:a,name:'套餐'})).body.id;
  assert.equal((await r(`/api/subscriptions/${subscription}`,'PATCH',{name:'套餐新版',version:1})).status,200);
  const event=(await r(`/api/subscriptions/${subscription}/events`,'POST',{...snapshot,occurredAt:'2025-02-01T00:00:00.000Z',status:'paused',version:2})).body.id;
  assert.ok(event);
  assert.equal((await r(`/api/subscriptions/${subscription}/events/${event}`,'PUT',{...snapshot,occurredAt:'2025-01-11T00:00:00.000Z',status:'paused',version:3})).status,200);
  const archive=(await r('/api/archive')).body;
  assert.equal(archive.subscriptions[0].name,'套餐新版');assert.equal(archive.subscriptions[0].events.length,2);
  assert.equal(archive.accounts.find(x=>x.id===a).tags[0],'工作新版');
  assert.equal((await r(`/api/relations/${relation}`,'DELETE',{version:2})).status,200);
  assert.equal((await r(`/api/tags/${tag}`,'DELETE',{version:2})).status,200);
  assert.equal((await r('/api/archive')).body.accounts.length,2);
});
test('首次本机设置、登录、持久化、退出与重启；只保存哈希且数据接口需认证',async t=>{
  const f=await fixture(t),r=f.request;
  assert.equal((await r('/')).status,303);assert.equal((await r('/api/archive')).status,401);
  assert.equal((await r('/api/session')).body.initialized,false);
  assert.equal((await r('/api/setup','POST',{password:'short',confirm:'short'})).status,400);
  let res=await r('/api/setup','POST',{password,confirm:password});assert.equal(res.status,200);
  assert.match(res.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  assert.ok(!readFileSync(f.config.authPath,'utf8').includes(password));
  for(const asset of ['/selects.js','/vendor/tom-select.complete.min.js','/vendor/tom-select.css'])assert.equal((await r(asset)).status,200);
  assert.equal((await r('/api/setup','POST',{password,confirm:password})).status,409);
  const created=await r('/api/accounts','POST',{name:'Test',identifier:'u',type:'账号',created:'',status:'正常',notes:'',tagIds:[],newTags:[]});assert.equal(created.status,201);
  assert.equal((await r('/api/archive')).body.accounts.length,1);
  assert.equal((await r('/data/accounts.sqlite')).status,404);assert.equal((await r('/data/access.json')).status,404);assert.equal((await r('/.env')).status,404);
  await f.restart();assert.equal((await r('/api/archive')).status,401);
  assert.equal((await r('/api/login','POST',{password:'incorrect'})).status,401);
  assert.equal((await r('/api/login','POST',{password})).status,200);
  assert.equal((await r('/api/archive')).body.accounts[0].id,created.body.id);
  assert.equal((await r('/api/logout','POST',{})).status,200);assert.equal((await r('/api/archive')).status,401);
});

test('拒绝跨站写入、不可信 Host、过大请求和不完整账号；错误保留数据库内容',async t=>{
  const f=await fixture(t),r=f.request;
  assert.equal((await r('/api/setup','POST',{password,confirm:password},{Origin:'https://evil.example'})).status,403);
  await r('/api/setup','POST',{password,confirm:password});
  assert.equal((await r('/api/archive','GET',undefined,{Host:'evil.example'})).status,403);
  assert.equal((await r('/api/accounts','POST',{}, {'X-Requested-With':''})).status,403);
  assert.equal((await r('/api/accounts','POST',{}, {'Content-Type':'text/plain'})).status,415);
  assert.equal((await r('/api/accounts','POST',{notes:'x'.repeat(70000)})).status,413);
  assert.equal((await r('/api/accounts','POST',{password:'never-store-this'})).status,400);
  assert.equal((await r('/api/archive')).body.accounts.length,0);
});

test('HTTPS 部署必须先初始化；Secure Cookie；登录限流',async t=>{
  const f=await fixture(t),r=f.request;
  assert.throws(()=>createApp({...f.config,origin:'https://accounts.example.com'}),/先以本机模式/);
  await r('/api/setup','POST',{password,confirm:password});
  const remote=createApp({...f.config,origin:'https://accounts.example.com',allowSetup:false});remote.listen(0,'127.0.0.1');await once(remote,'listening');
  t.after(()=>new Promise(resolve=>{remote.close(resolve);remote.closeAllConnections();}));
  const response=await rawRequest(`http://127.0.0.1:${remote.address().port}/api/login`,{method:'POST',headers:{Host:'accounts.example.com',Origin:'https://accounts.example.com','Content-Type':'application/json','X-Requested-With':'account-archive'},body:JSON.stringify({password})});
  assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/Secure/);
  for(let i=0;i<10;i++)assert.equal((await r('/api/login','POST',{password:'wrong'})).status,401);
  assert.equal((await r('/api/login','POST',{password})).status,429);
});

test('HTTP 密码查看必须逐次 2FA；绑定校验访问密码、会话和 CSRF；并发验证码只成功一次',async t=>{
  const original=Date.now;let now=1_800_000_000_000;Date.now=()=>now;t.after(()=>{Date.now=original;});
  const f=await fixture(t),r=f.request;
  assert.equal((await r('/api/security/totp/enrollment','POST',{password})).status,401);
  const setup=await r('/api/setup','POST',{password,confirm:password});const cookie=setup.headers.get('set-cookie').split(';')[0];
  assert.equal((await r('/api/security/totp/enrollment','POST',{password:'incorrect'})).status,400);
  assert.equal((await r('/api/security/totp/enrollment','POST',{password},{Origin:'https://evil.example'})).status,403);
  const pending=await r('/api/security/totp/enrollment','POST',{password});assert.equal(pending.status,200);
  assert.match(pending.body.qr,/^data:image\/png;base64,/);
  const otp=new TOTP({secret:pending.body.secret}),code=()=>otp.generate({timestamp:now});
  f.setCookie('');await r('/api/login','POST',{password});
  assert.equal((await r('/api/security/totp/confirm','POST',{code:code()})).status,400,'不能在另一个会话确认');
  f.setCookie(cookie);
  assert.equal((await r('/api/security/totp/confirm','POST',{code:code()})).status,200);
  const input={name:'Secure',identifier:'demo',type:'平台',status:'正常',password:'  sensitive-test-password  '};
  const created=await r('/api/accounts','POST',input);assert.equal(created.status,201);
  const path=`/api/accounts/${created.body.id}/password`;
  const archive=await r('/api/archive');assert.equal(archive.body.security.twoFactorEnabled,true);
  assert.equal(archive.body.accounts[0].hasPassword,true);
  assert.equal(JSON.stringify(archive.body).includes(input.password),false);
  assert.equal(JSON.stringify(archive.body).includes(pending.body.secret),false);
  assert.equal((await r(path)).status,404);
  assert.equal((await r(path,'POST',{code:code()},{Origin:'https://evil.example'})).status,403);
  assert.equal((await r(path,'POST',{code:code()})).status,409);
  now+=30_000;
  const both=await Promise.all([r(path,'POST',{code:code()}),r(path,'POST',{code:code()})]);
  assert.deepEqual(both.map(x=>x.status).sort(),[200,409]);
  assert.equal(both.find(x=>x.status===200).body.password,input.password);
  assert.equal(both[0].headers.get('cache-control'),'no-store');
  await f.restart();await r('/api/login','POST',{password});
  assert.equal((await r(path,'POST',{code:code()})).status,409,'重启后验证码不能重用');
  now+=30_000;assert.equal((await r(path,'POST',{code:code()})).body.password,input.password);
  f.setCookie('');assert.equal((await r(path,'POST',{code:code()})).status,401);
});

test('绑定超时、取消、错误次数限制持久化；已绑定不能从网页重新绑定',async t=>{
  const original=Date.now;let now=1_800_000_000_000;Date.now=()=>now;t.after(()=>{Date.now=original;});
  const f=await fixture(t),r=f.request;await r('/api/setup','POST',{password,confirm:password});
  let pending=(await r('/api/security/totp/enrollment','POST',{password})).body;
  now+=10*60_000;
  assert.equal((await r('/api/security/totp/confirm','POST',{code:new TOTP({secret:pending.secret}).generate({timestamp:now})})).status,400);
  pending=(await r('/api/security/totp/enrollment','POST',{password})).body;
  await r('/api/security/totp/enrollment','DELETE',{});
  assert.equal((await r('/api/security/totp/confirm','POST',{code:new TOTP({secret:pending.secret}).generate({timestamp:now})})).status,400);
  for(let i=0;i<5;i++)assert.equal((await r('/api/security/totp/enrollment','POST',{password:'bad'})).status,400);
  await f.restart();await r('/api/login','POST',{password});
  assert.equal((await r('/api/security/totp/enrollment','POST',{password})).status,429);
  now+=15*60_000;
  pending=(await r('/api/security/totp/enrollment','POST',{password})).body;
  const token=new TOTP({secret:pending.secret}).generate({timestamp:now});
  assert.equal((await r('/api/security/totp/confirm','POST',{code:token})).status,200);
  assert.equal((await r('/api/security/totp/enrollment','POST',{password})).status,409);
});


test('HTTP 通行密钥注册、逐次解锁、2FA 备用、撤销；会话来源检查与重启持久化',async t=>{
  const oldNow=Date.now;let now=1_800_000_000_000;Date.now=()=>now;t.after(()=>{Date.now=oldNow;});
  const f=await fixture(t),r=f.request,device=authenticator(),registration='/api/security/passkey/registration';
  assert.equal((await r(registration+'/options','POST',{password,code:'123456'})).status,401);
  await r('/api/setup','POST',{password,confirm:password});
  assert.equal((await r('/vendor/simplewebauthn.min.js')).status,200);
  const p=(await r('/api/security/totp/enrollment','POST',{password})).body,otp=new TOTP({secret:p.secret}),code=()=>otp.generate({timestamp:now});
  await r('/api/security/totp/confirm','POST',{code:code()});
  const id=(await r('/api/accounts','POST',{name:'Site',identifier:'me',type:'平台',status:'正常',password:'http-secret'})).body.id;
  const path=`/api/accounts/${id}/password`;
  assert.equal((await r(registration+'/options','POST',{password,code:code()})).status,409);
  now+=30000;
  assert.equal((await r(registration+'/options','POST',{password:'wrong',code:code()})).status,400);
  assert.equal((await r(registration+'/options','POST',{password,code:'bad'})).status,400);
  assert.equal((await r(registration+'/options','POST',{password,code:code()},{Origin:'https://evil.example'})).status,403);
  let o=(await r(registration+'/options','POST',{password,code:code()})).body;
  assert.equal(o.rp.id,'127.0.0.1');assert.equal(o.authenticatorSelection.userVerification,'required');
  let response=device.register(o,f.origin);
  assert.equal((await r(registration+'/verify','POST',{response})).status,200);
  assert.equal((await r(registration+'/verify','POST',{response})).status,400);
  const archive=(await r('/api/archive')).body;assert.equal(archive.security.passkeyEnabled,true);assert.equal(JSON.stringify(archive).includes(response.id),false);
  o=(await r(path+'/passkey/options','POST',{})).body;response=device.authenticate(o,f.origin);
  const both=await Promise.all([r(path+'/passkey/verify','POST',{response}),r(path+'/passkey/verify','POST',{response})]);
  assert.deepEqual(both.map(x=>x.status).sort(),[200,400]);assert.equal(both.find(x=>x.status===200).body.password,'http-secret');
  assert.equal(both[0].headers.get('cache-control'),'no-store');
  now+=30000;assert.equal((await r(path,'POST',{code:code()})).body.password,'http-secret');
  o=(await r(path+'/passkey/options','POST',{})).body;response=device.authenticate(o,f.origin);
  await r('/api/security/passkey/challenge','DELETE',{});assert.equal((await r(path+'/passkey/verify','POST',{response})).status,400);
  o=(await r(path+'/passkey/options','POST',{})).body;response=device.authenticate(o,f.origin);
  await r('/api/logout','POST',{});assert.equal((await r(path+'/passkey/verify','POST',{response})).status,401);
  await r('/api/login','POST',{password});assert.equal((await r(path+'/passkey/verify','POST',{response})).status,400);
  await f.restart();await r('/api/login','POST',{password});
  assert.equal((await r('/api/archive')).body.security.passkeyEnabled,true);
  o=(await r(path+'/passkey/options','POST',{})).body;response=device.authenticate(o,f.origin);
  assert.equal((await r(path+'/passkey/verify','POST',{response})).body.password,'http-secret');
  assert.equal((await r('/api/security/passkey','DELETE',{password,code:code()})).status,409);
  now+=30000;assert.equal((await r('/api/security/passkey','DELETE',{password,code:code()})).status,200);
  assert.equal((await r(path+'/passkey/options','POST',{})).status,409);
  now+=30000;assert.equal((await r(path,'POST',{code:code()})).body.password,'http-secret');
});

test('HTTP 删除账号要求登录和可信来源；版本冲突拒绝，确认成功后不可再读取',async t=>{
  const f=await fixture(t),r=f.request;
  await r('/api/setup','POST',{password,confirm:password});
  const input={name:'待删除',identifier:'user',type:'平台',status:'正常'};
  const id=(await r('/api/accounts','POST',input)).body.id;
  const path=`/api/accounts/${id}`;
  assert.equal((await r(path,'DELETE',{version:1},{Cookie:''})).status,401);
  assert.equal((await r(path,'DELETE',{version:1},{Origin:'https://evil.example'})).status,403);
  assert.equal((await r(path,'DELETE',{})).status,409);
  await r(path,'PUT',{...input,version:1,notes:'updated'});
  assert.equal((await r(path,'DELETE',{version:1})).status,409);assert.equal((await r('/api/archive')).body.accounts.length,1);
  assert.equal((await r(path,'DELETE',{version:2})).status,200);
  const archive=(await r('/api/archive')).body;assert.equal(archive.accounts.length,0);assert.equal(archive.events.length,0);
  assert.equal((await r(path,'DELETE',{version:2})).status,404);
  assert.equal((await r(path,'PUT',{...input,version:2})).status,404);
});
