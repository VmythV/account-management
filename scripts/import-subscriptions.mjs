import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, openSync, writeFileSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { snapshot } from '../lib/store.mjs';
import { text, occurredAt } from '../lib/validation.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const businessTables=['accounts','tags','account_tags','account_relations','account_events','subscriptions','subscription_events'];
const protectedTables=['account_secrets','vault_settings','passkey_credentials','account_relations'];
const rows=(db,table)=>db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
export const targetFingerprint=db=>hash(businessTables.map(table=>[table,rows(db,table)]));
export function readSource(db) {
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,2,'旧数据库版本不匹配');
  const subscriptions=db.prepare('SELECT * FROM subscriptions ORDER BY id').all();
  const events=db.prepare('SELECT * FROM events ORDER BY occurredAt,id').all();
  assert.ok(subscriptions.length&&events.length,'旧数据库没有可导入内容');
  assert.ok(events.every(e=>subscriptions.some(s=>s.id===e.subscriptionId)),'存在无所属订阅的历史记录');
  return {digest:hash([subscriptions,events]),subscriptions:subscriptions.map(s=>({...s,events:events.filter(e=>e.subscriptionId===s.id)}))};
}
function importId(kind,id) {
  // Stable IDs let retries detect the same source rows without changing the app schema.
  const bytes=createHash('sha256').update(`ai-subscription-records:v1:${kind}:${id}`).digest().subarray(0,16);
  bytes[6]=(bytes[6]&15)|128;bytes[8]=(bytes[8]&63)|128;
  const hex=bytes.toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
function healthy(db) {
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok','数据库完整性异常');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[],'数据库外键异常');
}

export function importSubscriptions({sourcePath,targetPath,plan,apply=false}) {
  assert.notEqual(realpathSync(sourcePath),realpathSync(targetPath),'不能导入到来源数据库');
  const source=new DatabaseSync(sourcePath,{readOnly:true,timeout:5000});
  let target;
  try {
    target=new DatabaseSync(targetPath,{timeout:5000});
    source.exec('BEGIN');target.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; BEGIN IMMEDIATE;');
    healthy(source);healthy(target);
    assert.equal(target.prepare('PRAGMA user_version').get().user_version,4,'目标数据库版本不匹配');
    const data=readSource(source);
    assert.equal(data.digest,plan.sourceDigest,'来源数据已变化，请重新核对迁移计划');
    const merges=plan.merges||{};
    assert.ok(Object.keys(merges).every(id=>data.subscriptions.some(s=>s.id===id)),'合并清单含未知订阅');
    const items=data.subscriptions.map(s=>{
      assert.ok(s.events.length,'订阅缺少历史记录');
      const name=text(s.name,'订阅名称',150,true),identifier=text(s.events.at(-1).email,'账号标识',300,true);
      occurredAt(s.createdAt);
      const merge=merges[s.id],account=merge?.accountId||importId('account',s.id),subscription=merge?.subscriptionId||importId('subscription',s.id);
      if(merge){
        const a=target.prepare('SELECT identifier FROM accounts WHERE id=?').get(account),sub=target.prepare('SELECT account FROM subscriptions WHERE id=?').get(subscription);
        assert.ok(a&&sub&&a.identifier===identifier&&sub.account===account,'合并目标或账号标识已变化');
      }
      const events=s.events.map(e=>{
        const email=text(e.email,'历史邮箱',254),notes=text(e.notes,'原备注',5000);
        assert.equal(email,e.email,'历史邮箱含非规范空白');assert.equal(notes,e.notes,'原备注含非规范空白');
        const event=snapshot({...e,notes:`${notes?notes+'\n\n':''}原记录邮箱：${email||'未填写'}\n来源：AI 订阅档案 · ${name}`});
        assert.equal(event.action,e.action,'操作说明不能在导入时被修改');assert.equal(event.plan,e.plan,'订阅等级不能在导入时被修改');
        return {id:importId('event',`${s.id}:${e.id}`),subscription,...event};
      });
      return {sourceId:s.id,name,identifier,createdAt:s.createdAt,account,subscription,merge:!!merge,events,auditId:importId('audit',s.id)};
    });
    assert.equal(new Set(items.map(x=>x.subscription)).size,items.length,'多项旧订阅不能合并进同一目标订阅');
    const all=items.flatMap(x=>x.events),existing=all.filter(e=>target.prepare('SELECT 1 FROM subscription_events WHERE id=?').get(e.id));
    const report={applied:apply,alreadyImported:false,newAccounts:0,newSubscriptions:0,importedEvents:0,skippedEvents:0,mappings:items.map(x=>({sourceId:x.sourceId,sourceName:x.name,accountId:x.account,subscriptionId:x.subscription,eventIds:x.events.map(e=>e.id)}))};
    if(existing.length){
      assert.equal(existing.length,all.length,'发现部分导入记录，拒绝重复或不完整导入');
      for(const e of all)assert.deepEqual({...target.prepare('SELECT * FROM subscription_events WHERE id=?').get(e.id)},e,'已导入记录被修改，拒绝覆盖');
      for(const item of items){
        assert.equal(target.prepare('SELECT account FROM subscriptions WHERE id=?').get(item.subscription)?.account,item.account,'已导入订阅归属发生变化');
        assert.ok(target.prepare('SELECT 1 FROM account_events WHERE id=? AND account=?').get(item.auditId,item.account),'导入记录不完整');
      }
      report.alreadyImported=true;report.skippedEvents=all.length;target.exec('ROLLBACK');return report;
    }
    assert.equal(targetFingerprint(target),plan.targetDigest,'目标数据已变化，请重新核对迁移计划');
    const protectedBefore=hash(protectedTables.map(table=>rows(target,table))),now=new Date().toISOString();
    let tag=target.prepare('SELECT id FROM tags WHERE name=?').get('旧订阅导入')?.id;
    if(!tag){tag=importId('tag','旧订阅导入');target.prepare('INSERT INTO tags(id,name,color) VALUES(?,?,?)').run(tag,'旧订阅导入','#6b9c87');}
    for(const item of items){
      if(!item.merge){
        target.prepare("INSERT INTO accounts(id,name,identifier,type,created,status,notes,website,insertedAt) VALUES(?,?,?,'AI','','正常',?,'',?)").run(item.account,item.name,item.identifier,`来源：AI 订阅档案 · ${item.name}\n原档案录入时间：${item.createdAt}`,now);
        target.prepare('INSERT INTO subscriptions(id,account,name) VALUES(?,?,?)').run(item.subscription,item.account,item.name);
        report.newAccounts++;report.newSubscriptions++;
      }
      const added=target.prepare('INSERT OR IGNORE INTO account_tags(account,tag) VALUES(?,?)').run(item.account,tag);
      if(item.merge&&added.changes)target.prepare('UPDATE accounts SET version=version+1 WHERE id=?').run(item.account);
      assert.ok(target.prepare('SELECT count(*) AS n FROM account_tags WHERE account=?').get(item.account).n<=50,'导入后标签超过限制');
      for(const e of item.events){
        target.prepare('INSERT INTO subscription_events(id,subscription,occurredAt,action,status,plan,notes,renewalCycle,renewalDay,renewalMonth) VALUES(?,?,?,?,?,?,?,?,?,?)').run(e.id,e.subscription,e.occurredAt,e.action,e.status,e.plan,e.notes,e.renewalCycle,e.renewalDay,e.renewalMonth);
        report.importedEvents++;
      }
      if(item.merge)target.prepare('UPDATE subscriptions SET version=version+1 WHERE id=?').run(item.subscription);
      target.prepare('INSERT INTO account_events(id,account,date,title,text,kind,automatic) VALUES(?,?,?,?,?,?,1)').run(item.auditId,item.account,now,'导入订阅历史',`从 AI 订阅档案导入「${item.name}」的 ${item.events.length} 条历史记录。原档案录入时间：${item.createdAt}。`,'订阅变更');
    }
    healthy(target);
    assert.equal(hash(protectedTables.map(table=>rows(target,table))),protectedBefore,'受保护数据发生变化');
    target.exec(apply?'COMMIT':'ROLLBACK');
    return report;
  } finally {
    if(target){if(target.isTransaction)target.exec('ROLLBACK');target.close();}
    if(source.isTransaction)source.exec('ROLLBACK');source.close();
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  let reportFile,committed=false;
  try {
    process.umask(0o077);
    const [sourcePath,targetPath,planPath,reportPath,flag,...extra]=process.argv.slice(2);
    assert.ok(sourcePath&&targetPath&&planPath&&reportPath&&!extra.length&&(!flag||flag==='--apply'),'用法：node scripts/import-subscriptions.mjs 来源库 目标库 计划.json 报告.json [--apply]');
    assert.ok(![sourcePath,targetPath,planPath].some(p=>resolve(p)===resolve(reportPath)),'报告不能覆盖数据库或计划');
    reportFile=openSync(reportPath,'wx',0o600);
    const report=importSubscriptions({sourcePath,targetPath,plan:JSON.parse(readFileSync(planPath,'utf8')),apply:flag==='--apply'});
    committed=report.applied;
    writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');
    const {mappings,...summary}=report;console.log(JSON.stringify(summary));
  } catch(error) {
    console.error(error.code==='ERR_ASSERTION'?error.message.split('\n')[0]:error.code||error.message);
    if(committed)console.error('数据库已提交；报告写入失败，可使用同一计划和新的报告路径重新核对。');
    process.exitCode=1;
  } finally {if(reportFile!==undefined)closeSync(reportFile);}
}
