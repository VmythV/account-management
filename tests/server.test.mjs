import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createApp } from '../server.mjs';

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
  return {config,request,async restart(){await stop();await start();},setCookie(value){cookie=value;}};
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

test('拒绝跨站写入、不可信 Host、过大请求和密码字段；错误保留数据库内容',async t=>{
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
