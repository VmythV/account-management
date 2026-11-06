import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../lib/store.mjs';
import { DatabaseSync } from 'node:sqlite';
import { summarize } from '../public/timeline.js';

const account=(overrides={})=>({name:'GitHub',identifier:'arbitrary-user',type:'平台账号',created:'',status:'正常',notes:'',tagIds:[],newTags:[],...overrides});
const event=(overrides={})=>({occurredAt:'2025-01-01T00:00:00.000Z',action:'开通',status:'active',plan:'Pro',notes:'',renewalCycle:'monthly',renewalDay:31,renewalMonth:null,...overrides});
const memory=t=>{const s=openStore(':memory:');t.after(()=>s.close());return s;};

test('网站可选、编辑、清空和自动留痕；拒绝非网页链接与登录凭据',t=>{
  const s=memory(t),id=s.saveAccount(account({website:' https://EXAMPLE.com/account?a=1&b=2 '}));
  assert.equal(s.archive().accounts[0].website,'https://example.com/account?a=1&b=2');
  s.saveAccount(account({notes:'旧页面编辑未发送网站字段',version:1}),id);
  assert.equal(s.archive().accounts[0].website,'https://example.com/account?a=1&b=2');
  s.saveAccount(account({website:'http://localhost:8080/login',version:2}),id);
  assert.ok(s.archive().events.some(e=>e.text.includes('网站：https://example.com/account?a=1&b=2 → http://localhost:8080/login')));
  s.saveAccount(account({website:'',version:3}),id);
  assert.equal(s.archive().accounts[0].website,'');
  for(const website of ['javascript:alert(1)','data:text/html,test','//example.com','example.com','ftp://example.com','https://','https://user:password@example.com','https://user@example.com','https://example.com/\npath','https://example.com/'+'x'.repeat(2048),{},42]) {
    assert.throws(()=>s.saveAccount(account({website,version:4}),id),{status:400});
  }
  assert.equal(s.archive().accounts[0].version,4);
});

test('版本 1 数据库升级后保留账号、标签、关联、记录和订阅；重启不重复迁移',t=>{
  const dir=mkdtempSync(join(tmpdir(),'archive-migration-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'archive.sqlite');let s=openStore(path);
  const a=s.saveAccount(account({newTags:['工作'],notes:'原有备注'}));
  const b=s.saveAccount(account({identifier:'other',source:a,relation:'注册'}));
  s.createSubscription({account:b,name:'套餐',...event()});
  const before=JSON.parse(JSON.stringify(s.archive()));s.close();
  const legacy=new DatabaseSync(path);
  legacy.exec('ALTER TABLE accounts DROP COLUMN website; PRAGMA user_version=1;');legacy.close();
  s=openStore(path);assert.deepEqual(JSON.parse(JSON.stringify(s.archive())),before);
  s.saveAccount(account({website:'https://example.com',version:1}),a);s.close();
  s=openStore(path);assert.equal(s.archive().accounts.find(x=>x.id===a).website,'https://example.com/');s.close();
  const db=new DatabaseSync(path);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,2);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');db.close();
});

test('账号与任意颜色标签持久化；改名同步；删除标签保留账号；归档可恢复',t=>{
  const dir=mkdtempSync(join(tmpdir(),'archive-store-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'archive.sqlite');let s=openStore(path);
  const tag=s.saveTag({name:'工作',color:'#187EE5'});
  const id=s.saveAccount(account({tagIds:[tag],newTags:['新标签']}));
  assert.equal(s.archive().tags.find(t=>t.id===tag).color,'#187ee5');
  s.saveTag({name:'工作新版',color:'#ffffff',version:1},tag);
  let a=s.archive().accounts[0];assert.ok(a.tags.includes('工作新版'));
  s.saveAccount(account({status:'已归档',tagIds:a.tagIds,version:a.version}),id);
  a=s.archive().accounts[0];assert.equal(a.status,'已归档');
  s.saveAccount(account({status:'正常',tagIds:a.tagIds,version:a.version}),id);
  s.deleteTag(tag,{version:2});
  const saved=JSON.parse(JSON.stringify(s.archive()));s.close();
  copyFileSync(path,join(dir,'backup.sqlite'));
  s=openStore(join(dir,'backup.sqlite'));assert.deepEqual(JSON.parse(JSON.stringify(s.archive())),saved);
  assert.equal(s.archive().accounts.length,1);assert.deepEqual(s.archive().accounts[0].tags,['新标签']);s.close();
});

test('创建账号附带标签和关联全部提交或全部回滚；拒绝密码字段和错误日期',t=>{
  const s=memory(t);
  assert.throws(()=>s.saveAccount(account({newTags:['不应留下'],source:'missing',relation:'注册'})),{status:404});
  assert.deepEqual(s.archive(),{accounts:[],tags:[],links:[],events:[],subscriptions:[]});
  for(const input of [{password:'not-allowed'},{created:'2025-02-29'},{tagIds:'invalid'},{newTags:['a,b']},{identifier:''}])assert.throws(()=>s.saveAccount(account(input)),{status:400});
  s.saveAccount(account());assert.throws(()=>s.saveAccount(account({name:'github'})),{status:409});
  s.saveAccount(account({identifier:'ARBITRARY-user'}));assert.equal(s.archive().accounts.length,2,'标识保留大小写语义');
  assert.throws(()=>s.saveTag({name:'bad',color:'#fff;display:none'}),{status:400});
});

test('多来源、循环关联允许；禁止自身和重复关联；更改及解除保留两端历史',t=>{
  const s=memory(t),a=s.saveAccount(account()),b=s.saveAccount(account({identifier:'other'})),c=s.saveAccount(account({name:'邮箱'}));
  const id=s.saveRelation({from:a,to:b,type:'登录'});
  s.saveRelation({from:c,to:b,type:'邮箱注册'});s.saveRelation({from:b,to:a,type:'恢复邮箱'});
  assert.throws(()=>s.saveRelation({from:a,to:a,type:'登录'}),{status:400});
  assert.throws(()=>s.saveRelation({from:a,to:b,type:'登录'}),{status:409});
  s.saveRelation({from:a,to:b,type:'第三方登录',notes:'已核对',version:1},id);
  s.deleteRelation(id,{version:2});
  assert.equal(s.archive().links.length,2);
  assert.equal(s.archive().events.filter(e=>e.title==='解除账号关联').length,2);
});

test('并发修改拒绝覆盖；手动记录可以更正；系统记录不可篡改',t=>{
  const s=memory(t),id=s.saveAccount(account());
  s.saveAccount(account({version:1,notes:'new'}),id);
  assert.throws(()=>s.saveAccount(account({version:1,notes:'stale'}),id),{status:409});
  const payload={account:id,date:'2025-01-01T00:00:00.000Z',title:'补录',text:'内容',kind:'账号记录'};
  const eid=s.saveEvent(payload);s.saveEvent({...payload,title:'更正',version:1},eid);
  assert.equal(s.archive().events.find(e=>e.id===eid).title,'更正');
  const automatic=s.archive().events.find(e=>e.automatic);
  assert.throws(()=>s.saveEvent({...payload,version:1},automatic.id),{status:403});
  assert.throws(()=>s.saveEvent({...payload,date:'2999-01-01T00:00:00.000Z'}),{status:400});
});

test('同一账号多订阅；补录和更正历史重算时长；不修改其他快照',t=>{
  const s=memory(t),accountId=s.saveAccount(account());
  const id=s.createSubscription({account:accountId,name:'Cloud',...event()});
  s.createSubscription({account:accountId,name:'Music',...event()});
  s.saveSubscriptionEvent(id,{...event({occurredAt:'2025-01-26T00:00:00.000Z',status:'cancelled',action:'取消'}),version:1});
  const pause=s.saveSubscriptionEvent(id,{...event({occurredAt:'2025-01-11T00:00:00.000Z',status:'paused',action:'暂停'}),version:2});
  s.saveSubscriptionEvent(id,{...event({occurredAt:'2025-01-21T00:00:00.000Z',action:'恢复'}),version:3});
  let subscription=s.archive().subscriptions.find(s=>s.id===id);
  const total=()=>summarize(subscription.events,Date.parse('2025-02-01T00:00:00.000Z'));
  assert.equal(total().activeMs,15*86400000);assert.equal(total().current.status,'cancelled');
  const untouched=subscription.events.filter(e=>e.id!==pause);
  s.saveSubscriptionEvent(id,{...event({occurredAt:'2025-01-10T00:00:00.000Z',status:'paused',action:'修正暂停日期'}),version:4},pause);
  subscription=s.archive().subscriptions.find(s=>s.id===id);
  assert.equal(total().activeMs,14*86400000);assert.deepEqual(subscription.events.filter(e=>e.id!==pause),untouched);
  assert.equal(s.archive().subscriptions.length,2);
  assert.throws(()=>s.saveSubscriptionEvent(id,{...event(),version:4}),{status:409});
  assert.throws(()=>s.saveSubscriptionEvent(id,{...event(),version:5}),{status:409});
});

test('订阅快照拒绝无效月日、未来时间；失败创建不留下空订阅',t=>{
  const s=memory(t),id=s.saveAccount(account());
  for(const input of [{renewalCycle:'weekly'},{renewalDay:'1'},{renewalDay:32},{renewalDay:0},{renewalCycle:'none'},{renewalCycle:'yearly',renewalMonth:2,renewalDay:30},{renewalCycle:'yearly',renewalMonth:4,renewalDay:31},{occurredAt:'2999-01-01T00:00:00.000Z'}]){
    assert.throws(()=>s.createSubscription({account:id,name:'test',...event(input)}),{status:400});
  }
  assert.equal(s.archive().subscriptions.length,0);
  s.createSubscription({account:id,name:'test',...event({renewalCycle:'yearly',renewalMonth:2,renewalDay:29})});
});
