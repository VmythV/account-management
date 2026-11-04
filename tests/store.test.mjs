import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../lib/store.mjs';
import { summarize } from '../public/timeline.js';

const account=(overrides={})=>({name:'GitHub',identifier:'arbitrary-user',type:'平台账号',created:'',status:'正常',notes:'',tagIds:[],newTags:[],...overrides});
const event=(overrides={})=>({occurredAt:'2025-01-01T00:00:00.000Z',action:'开通',status:'active',plan:'Pro',notes:'',renewalCycle:'monthly',renewalDay:31,renewalMonth:null,...overrides});
const memory=t=>{const s=openStore(':memory:');t.after(()=>s.close());return s;};

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
