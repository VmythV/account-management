import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOTP } from 'otpauth';
import { openStore } from '../lib/store.mjs';
import { summarize } from '../public/timeline.js';
import { importSubscriptions, readSource, targetFingerprint } from '../scripts/import-subscriptions.mjs';

function fixture(t) {
  const dir=mkdtempSync(join(tmpdir(),'archive-import-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const sourcePath=join(dir,'source.sqlite'),targetPath=join(dir,'target.sqlite');
  const source=new DatabaseSync(sourcePath);
  source.exec(`CREATE TABLE subscriptions(id TEXT PRIMARY KEY,name TEXT NOT NULL,createdAt TEXT NOT NULL) STRICT;
    CREATE TABLE events(id INTEGER PRIMARY KEY,subscriptionId TEXT NOT NULL REFERENCES subscriptions(id),occurredAt TEXT NOT NULL,action TEXT NOT NULL,status TEXT NOT NULL,email TEXT NOT NULL,plan TEXT NOT NULL,notes TEXT NOT NULL,renewalCycle TEXT NOT NULL,renewalDay INTEGER,renewalMonth INTEGER,UNIQUE(subscriptionId,occurredAt)) STRICT;
    PRAGMA user_version=2;`);
  for(const [id,name] of [['old-chat','chathgpt-01'],['old-claude3','Claude-03'],['old-claude4','claude-04']])source.prepare('INSERT INTO subscriptions VALUES(?,?,?)').run(id,name,'2025-01-02T00:00:00.000Z');
  for(const [id,subscription,date,status,email] of [[1,'old-chat','2025-01-01','active','user@example.com'],[2,'old-chat','2025-02-01','active','user@example.com'],[3,'old-claude3','2025-02-01','banned','relay@example.com'],[4,'old-claude4','2025-02-02','trial',''],[5,'old-claude4','2025-03-02','active','relay@example.com']]){
    source.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,subscription,date+'T00:00:00.000Z','操作 '+id,status,email,'Pro','原始备注 '+id,'monthly',24,null);
  }
  const store=openStore(targetPath),pending=store.vault.beginEnrollment();store.vault.confirmEnrollment(pending,new TOTP({secret:pending.secret}).generate());
  const account=store.saveAccount({name:'OpenAI',identifier:'user@example.com',type:'AI',status:'正常',notes:'已有备注',website:'https://example.com',password:'unchanged-secret',newTags:['工作']});
  store.vault.savePasskey({id:'credential',publicKey:Buffer.from('public-key'),counter:0},Buffer.from('user'),store.vault.generation());
  const subscription=store.createSubscription({account,name:'ChatGPT',occurredAt:'2025-03-01T00:00:00.000Z',action:'已有记录',status:'active',plan:'Pro',notes:'已有订阅备注',renewalCycle:'monthly',renewalDay:24,renewalMonth:null});
  store.close();
  const target=new DatabaseSync(targetPath);t.after(()=>{source.close();target.close();});
  const plan={sourceDigest:readSource(source).digest,targetDigest:targetFingerprint(target),merges:{'old-chat':{accountId:account,subscriptionId:subscription}}};
  return {source,target,sourcePath,targetPath,account,subscription,plan,run(apply=true){return importSubscriptions({sourcePath,targetPath,plan,apply});}};
}
test('导入保留同邮箱两个账号、合并历史及标签；原密码/验证器/通行密钥不变，重复执行不重复',t=>{
  const f=fixture(t),sourceBytes=readFileSync(f.sourcePath),existingAccount={...f.target.prepare('SELECT * FROM accounts WHERE id=?').get(f.account)};
  const protectedRows=['account_secrets','vault_settings','passkey_credentials','account_relations'].map(table=>f.target.prepare('SELECT * FROM '+table).all());
  const previousEvents=f.target.prepare('SELECT * FROM subscription_events').all();
  const report=f.run();assert.equal(report.newAccounts,2);assert.equal(report.newSubscriptions,2);assert.equal(report.importedEvents,5);
  const a=report.mappings.find(m=>m.sourceName==='Claude-03'),b=report.mappings.find(m=>m.sourceName==='claude-04');assert.notEqual(a.accountId,b.accountId);
  for(const id of [a.accountId,b.accountId]){const row=f.target.prepare('SELECT * FROM accounts WHERE id=?').get(id);assert.equal(row.identifier,'relay@example.com');assert.equal(row.created,'');assert.equal(row.website,'');assert.equal(row.type,'AI');}
  assert.equal(f.target.prepare('SELECT count(*) AS n FROM account_tags WHERE account=?').get(f.account).n,2);
  const account={...f.target.prepare('SELECT * FROM accounts WHERE id=?').get(f.account)};assert.equal(account.version,existingAccount.version+1);account.version--;assert.deepEqual(account,existingAccount);
  for(const e of previousEvents)assert.deepEqual(f.target.prepare('SELECT * FROM subscription_events WHERE id=?').get(e.id),e);
  assert.deepEqual(['account_secrets','vault_settings','passkey_credentials','account_relations'].map(table=>f.target.prepare('SELECT * FROM '+table).all()),protectedRows);
  for(const source of readSource(f.source).subscriptions){const mapping=report.mappings.find(m=>m.sourceId===source.id);for(let i=0;i<source.events.length;i++){
    const old=source.events[i],event=f.target.prepare('SELECT * FROM subscription_events WHERE id=?').get(mapping.eventIds[i]);
    for(const field of ['occurredAt','action','status','plan','renewalCycle','renewalDay','renewalMonth'])assert.equal(event[field],old[field]);
    assert.ok(event.notes.startsWith(old.notes+'\n\n'));assert.ok(event.notes.includes('原记录邮箱：'+(old.email||'未填写')));
  }}
  const merged=f.target.prepare('SELECT * FROM subscription_events WHERE subscription=?').all(f.subscription);
  const sourceHistory=readSource(f.source).subscriptions.find(s=>s.id==='old-chat').events;
  assert.equal(summarize(merged,Date.parse('2025-04-01')).activeMs,summarize([...sourceHistory,...previousEvents],Date.parse('2025-04-01')).activeMs);
  assert.deepEqual(readFileSync(f.sourcePath),sourceBytes);
  const digest=targetFingerprint(f.target),again=f.run();assert.equal(again.alreadyImported,true);assert.equal(again.skippedEvents,5);assert.equal(targetFingerprint(f.target),digest);
});
test('演练回滚全部变化；发生晚期唯一约束冲突时整批回滚',t=>{
  const f=fixture(t),before=targetFingerprint(f.target);
  assert.equal(f.run(false).importedEvents,5);assert.equal(targetFingerprint(f.target),before);
  f.target.prepare("INSERT INTO accounts(id,name,identifier,type,created,status,notes,insertedAt) VALUES('collision','Claude-03','relay@example.com','AI','','正常','','2025-01-01')").run();
  f.plan.targetDigest=targetFingerprint(f.target);assert.throws(()=>f.run(),/UNIQUE/);assert.equal(targetFingerprint(f.target),f.plan.targetDigest);
  assert.equal(f.target.prepare("SELECT count(*) AS n FROM tags WHERE name='旧订阅导入'").get().n,0);
});
test('来源或目标漂移、错误归属和已导入记录修改时拒绝写入',t=>{
  const f=fixture(t),before=targetFingerprint(f.target);
  f.source.prepare("UPDATE events SET notes='changed' WHERE id=1").run();assert.throws(()=>f.run(),/来源数据已变化/);assert.equal(targetFingerprint(f.target),before);
  f.source.prepare("UPDATE events SET notes='原始备注 1' WHERE id=1").run();
  f.target.prepare("UPDATE accounts SET notes='changed' WHERE id=?").run(f.account);assert.throws(()=>f.run(),/目标数据已变化/);
  f.plan.targetDigest=targetFingerprint(f.target);const original=f.plan.merges['old-chat'].accountId;f.plan.merges['old-chat'].accountId='missing';assert.throws(()=>f.run(),/合并目标/);f.plan.merges['old-chat'].accountId=original;
  const report=f.run();f.target.prepare("UPDATE subscription_events SET notes='edited later' WHERE id=?").run(report.mappings[0].eventIds[0]);
  const edited=targetFingerprint(f.target);assert.throws(()=>f.run(),/已导入记录被修改/);assert.equal(targetFingerprint(f.target),edited);
});
