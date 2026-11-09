import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createVault } from './vault.mjs';
import { HttpError, text, fields, choice, occurredAt, calendarDate, website } from './validation.mjs';
import { STATUSES } from '../public/timeline.js';

const accountFields = ['name','identifier','type','created','status','notes','website','tagIds','newTags','source','relation','version','password','removePassword'];
const eventFields = ['account','date','title','text','kind','version'];
const snapshotFields = ['occurredAt','action','status','plan','notes','renewalCycle','renewalDay','renewalMonth'];

function names(values) {
  if (!Array.isArray(values) || values.length > 50) throw new HttpError(400, '每个账号最多选择 50 个标签。');
  return [...new Set(values.map(v => text(v, '标签', 80, true)))];
}
function tagName(value) {
  const name = text(value, '标签名称', 50, true);
  if (/[,，]/.test(name)) throw new HttpError(400, '标签名称不能包含逗号。');
  return name;
}
function tagColor(value) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new HttpError(400, '请选择有效的标签颜色。');
  return value.toLowerCase();
}
function snapshot(input) {
  const renewalCycle = choice(input.renewalCycle, ['none','monthly','yearly'], '续费周期');
  const renewalDay = input.renewalDay ?? null, renewalMonth = input.renewalMonth ?? null;
  if (renewalCycle === 'none' && (renewalDay !== null || renewalMonth !== null)
    || renewalCycle !== 'none' && (!Number.isInteger(renewalDay) || renewalDay < 1 || renewalDay > 31)
    || renewalCycle === 'monthly' && renewalMonth !== null
    || renewalCycle === 'yearly' && (!Number.isInteger(renewalMonth) || renewalMonth < 1 || renewalMonth > 12
      || renewalDay > new Date(Date.UTC(2000, renewalMonth, 0)).getUTCDate())) {
    throw new HttpError(400, '请填写有效的续费月日；不设置提醒时月日应留空。');
  }
  return {
    occurredAt: occurredAt(input.occurredAt), action: text(input.action, '操作说明', 150, true),
    status: choice(input.status, Object.keys(STATUSES), '订阅状态'), plan: text(input.plan, '订阅等级', 150, true),
    notes: text(input.notes ?? '', '备注', 5000), renewalCycle, renewalDay, renewalMonth,
  };
}

export function openStore(filename,{keyPath=filename===':memory:'?null:join(dirname(filename),'vault.key')}={}) {
  if(filename!==':memory:'&&(typeof keyPath!=='string'||!keyPath))throw new Error('持久数据库必须配置持久加密密钥路径。');
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename, { timeout: 5000 });
  if (filename !== ':memory:') chmodSync(filename, 0o600);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > 4) { db.close(); throw new Error('数据库版本比程序新，请升级程序后再启动。'); }
  try {
    if (version < 4) {
      db.exec('BEGIN IMMEDIATE');
      if (version === 0) db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
      else if (version === 1) db.exec("ALTER TABLE accounts ADD COLUMN website TEXT NOT NULL DEFAULT ''");
      if (version < 3) db.exec(readFileSync(new URL('./vault-schema.sql', import.meta.url), 'utf8'));
      db.exec(readFileSync(new URL('./passkey-schema.sql', import.meta.url), 'utf8'));
      db.exec('PRAGMA user_version=4; COMMIT;');
    }
  } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  let vault;
  try { vault=createVault(db,keyPath); } catch(error) { db.close(); throw error; }

  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) {
      db.exec('ROLLBACK');
      if (error.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed/.test(error.message)) {
        throw new HttpError(409, '存在重复的账号、标签、关联或订阅操作时间，请检查后重试。');
      }
      throw error;
    }
  }
  // Table names below are internal constants; user values are always bound parameters.
  function requireRow(table, id) {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
    if (!row) throw new HttpError(404, '记录不存在，请刷新页面。');
    return row;
  }
  function checkVersion(row, value) {
    if (!Number.isInteger(value) || row.version !== value) throw new HttpError(409, '这条数据已发生变化，请保留输入，刷新核对后重新编辑。');
  }
  function log(account, title, message, kind = '账号记录') {
    db.prepare('INSERT INTO account_events(id,account,date,title,text,kind,automatic) VALUES(?,?,?,?,?,?,1)')
      .run(randomUUID(), account, new Date().toISOString(), title, message, kind);
  }
  function accountTags(account) {
    return db.prepare('SELECT t.id,t.name FROM tags t JOIN account_tags a ON a.tag=t.id WHERE a.account=? ORDER BY t.name').all(account);
  }
  function relate(input, id) {
    const source = requireRow('accounts', text(input.from, '来源账号', 80, true));
    const target = requireRow('accounts', text(input.to, '目标账号', 80, true));
    if (source.id === target.id) throw new HttpError(400, '账号不能关联到自身。');
    const type = text(input.type, '关联方式', 100, true), notes = text(input.notes ?? '', '关联备注', 5000);
    const relationId = id || randomUUID();
    let before;
    if (id) {
      before = requireRow('account_relations', id); checkVersion(before, input.version);
      db.prepare('UPDATE account_relations SET source=?,target=?,type=?,notes=?,version=version+1 WHERE id=?')
        .run(source.id, target.id, type, notes, id);
    } else db.prepare('INSERT INTO account_relations(id,source,target,type,notes) VALUES(?,?,?,?,?)').run(relationId, source.id, target.id, type, notes);
    const description = `${source.name}（${source.identifier}） → ${target.name}（${target.identifier}） · ${type}${notes ? '\n'+notes : ''}`;
    const previous = before ? `原关联：${requireRow('accounts',before.source).name} → ${requireRow('accounts',before.target).name} · ${before.type}\n新关联：` : '';
    for (const account of new Set([source.id,target.id,...(before ? [before.source,before.target] : [])])) {
      log(account, id ? '修改账号关联' : '建立账号关联', previous + description, '关联变更');
    }
    return relationId;
  }
  function insertSnapshot(subscription, input, eventId) {
    const s = snapshot(input), id = eventId || randomUUID();
    const values = [s.occurredAt,s.action,s.status,s.plan,s.notes,s.renewalCycle,s.renewalDay,s.renewalMonth];
    if (eventId) db.prepare('UPDATE subscription_events SET occurredAt=?,action=?,status=?,plan=?,notes=?,renewalCycle=?,renewalDay=?,renewalMonth=? WHERE id=? AND subscription=?').run(...values, id, subscription);
    else db.prepare('INSERT INTO subscription_events(id,subscription,occurredAt,action,status,plan,notes,renewalCycle,renewalDay,renewalMonth) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, subscription, ...values);
    return id;
  }

  return {
    vault,
    archive() {
      const tags = db.prepare('SELECT * FROM tags ORDER BY name').all();
      const accounts = db.prepare('SELECT *,EXISTS(SELECT 1 FROM account_secrets WHERE account=accounts.id) AS hasPassword FROM accounts ORDER BY insertedAt DESC,id').all().map(a => {
        const assigned = accountTags(a.id);
        return { ...a, hasPassword:!!a.hasPassword, tagIds: assigned.map(t=>t.id), tags: assigned.map(t=>t.name), mark: [...a.name][0].toUpperCase(), brand: '' };
      });
      const subscriptions = db.prepare('SELECT * FROM subscriptions ORDER BY rowid DESC').all();
      const events = db.prepare('SELECT * FROM subscription_events ORDER BY occurredAt,id').all();
      return {
        accounts, tags, security:{twoFactorEnabled:vault.enabled(),passkeyEnabled:!!vault.passkey()},
        links: db.prepare('SELECT id,source AS "from",target AS "to",type,notes,version FROM account_relations ORDER BY rowid').all(),
        events: db.prepare('SELECT * FROM account_events ORDER BY date DESC,id').all(),
        subscriptions: subscriptions.map(s=>({...s,events:events.filter(e=>e.subscription===s.id)})),
      };
    },
    saveAccount(input, id) {
      fields(input, accountFields);
      const data = {
        name:text(input.name,'平台名称',150,true), identifier:text(input.identifier,'账号标识',300,true),
        type:text(input.type,'账号类型',100,true), created:calendarDate(input.created ?? ''),
        status:choice(input.status,['正常','已归档'],'账号状态'), notes:text(input.notes ?? '', '备注',5000),
        website:website(input.website ?? ''),
      };
      const selected = names(input.tagIds ?? []), additions = names(input.newTags ?? []).map(tagName);
      if (selected.length + additions.length > 50) throw new HttpError(400,'每个账号最多选择 50 个标签。');
      return transaction(() => {
        const accountId = id || randomUUID();
        let before;
        if (id) {
          before = requireRow('accounts',id); checkVersion(before,input.version);
          before.tags = accountTags(id).map(t=>t.name);
          // Older open tabs do not send website; keep the saved address until explicitly changed.
          if (input.website === undefined) data.website = before.website;
          db.prepare('UPDATE accounts SET name=?,identifier=?,type=?,created=?,status=?,notes=?,website=?,version=version+1 WHERE id=?').run(...Object.values(data),id);
        } else db.prepare('INSERT INTO accounts(id,name,identifier,type,created,status,notes,website,insertedAt) VALUES(?,?,?,?,?,?,?,?,?)')
          .run(accountId,...Object.values(data),new Date().toISOString());
        const tagIds = new Set(selected);
        for (const tag of selected) requireRow('tags',tag);
        for (const name of additions) {
          let tag = db.prepare('SELECT id FROM tags WHERE name=?').get(name);
          if (!tag) { tag={id:randomUUID()}; db.prepare('INSERT INTO tags(id,name,color) VALUES(?,?,?)').run(tag.id,name,'#6b9c87'); }
          tagIds.add(tag.id);
        }
        db.prepare('DELETE FROM account_tags WHERE account=?').run(accountId);
        for (const tag of tagIds) db.prepare('INSERT INTO account_tags(account,tag) VALUES(?,?)').run(accountId,tag);
        const after = { ...data, tags:accountTags(accountId).map(t=>t.name) };
        const labels={name:'平台名称',identifier:'账号标识',type:'账号类型',created:'注册日期',status:'状态',notes:'备注',website:'网站',tags:'标签'};
        const detail = Object.entries(labels).filter(([key])=>!before || JSON.stringify(before[key])!==JSON.stringify(after[key]))
          .map(([key,label])=>`${label}：${before ? `${Array.isArray(before[key])?before[key].join('、'):before[key] || '未设置'} → ` : ''}${Array.isArray(after[key])?after[key].join('、'):after[key] || '未设置'}`).join('\n');
        const passwordChange=vault.save(accountId,input.password,input.removePassword);
        log(accountId,id?'更新账号信息':'加入账号档案',[detail,passwordChange].filter(Boolean).join('\n') || '信息已核对，无字段变化。');
        if (!id && input.source) relate({from:input.source,to:accountId,type:input.relation,notes:''});
        return accountId;
      });
    },
    saveTag(input,id) {
      fields(input,['name','color','version']);
      const name=tagName(input.name), color=tagColor(input.color);
      return transaction(()=>{
        if (id) {
          const before=requireRow('tags',id);checkVersion(before,input.version);
          db.prepare('UPDATE tags SET name=?,color=?,version=version+1 WHERE id=?').run(name,color,id);
        } else { id=randomUUID();db.prepare('INSERT INTO tags(id,name,color) VALUES(?,?,?)').run(id,name,color); }
        return id;
      });
    },
    deleteTag(id,input) {
      fields(input,['version']);
      return transaction(()=>{checkVersion(requireRow('tags',id),input.version);db.prepare('DELETE FROM tags WHERE id=?').run(id);});
    },
    saveRelation(input,id) {
      fields(input,['from','to','type','notes','version']);
      return transaction(()=>relate(input,id));
    },
    deleteRelation(id,input) {
      fields(input,['version']);
      return transaction(()=>{
        const r=requireRow('account_relations',id);checkVersion(r,input.version);
        const from=requireRow('accounts',r.source),to=requireRow('accounts',r.target);
        for (const account of [r.source,r.target]) log(account,'解除账号关联',`${from.name}（${from.identifier}） → ${to.name}（${to.identifier}） · ${r.type}`,'关联变更');
        db.prepare('DELETE FROM account_relations WHERE id=?').run(id);
      });
    },
    saveEvent(input,id) {
      fields(input,eventFields);
      const data = [text(input.account,'账号',80,true),occurredAt(input.date),text(input.title,'操作标题',150,true),text(input.text ?? '','记录内容',5000),choice(input.kind,['账号记录','关联变更','订阅变更'],'记录类型')];
      return transaction(()=>{
        requireRow('accounts',data[0]);
        if (id) {
          const event=requireRow('account_events',id);checkVersion(event,input.version);
          if (event.automatic) throw new HttpError(403,'自动操作记录不能更正，请修改对应账号或关联。');
          if (event.account!==data[0]) throw new HttpError(400,'更正记录不能改变所属账号。');
          db.prepare('UPDATE account_events SET account=?,date=?,title=?,text=?,kind=?,version=version+1 WHERE id=?').run(...data,id);
        } else {id=randomUUID();db.prepare('INSERT INTO account_events(id,account,date,title,text,kind) VALUES(?,?,?,?,?,?)').run(id,...data);}
        return id;
      });
    },
    createSubscription(input) {
      fields(input,['account','name',...snapshotFields]);
      return transaction(()=>{
        const account=text(input.account,'所属账号',80,true);requireRow('accounts',account);
        const id=randomUUID();
        db.prepare('INSERT INTO subscriptions(id,account,name) VALUES(?,?,?)').run(id,account,text(input.name,'订阅名称',150,true));
        insertSnapshot(id,input);
        return id;
      });
    },
    renameSubscription(id,input) {
      fields(input,['name','version']);
      return transaction(()=>{
        const s=requireRow('subscriptions',id);checkVersion(s,input.version);
        const name=text(input.name,'订阅名称',150,true);
        db.prepare('UPDATE subscriptions SET name=?,version=version+1 WHERE id=?').run(name,id);
        log(s.account,'修改订阅名称',`${s.name} → ${name}`,'订阅变更');
      });
    },
    saveSubscriptionEvent(subscription,input,eventId) {
      fields(input,['version',...snapshotFields]);
      return transaction(()=>{
        const s=requireRow('subscriptions',subscription);checkVersion(s,input.version);
        if (eventId && requireRow('subscription_events',eventId).subscription!==subscription) throw new HttpError(404,'订阅记录不存在。');
        const id=insertSnapshot(subscription,input,eventId);
        db.prepare('UPDATE subscriptions SET version=version+1 WHERE id=?').run(subscription);
        return id;
      });
    },
    close() { db.close(); },
  };
}
