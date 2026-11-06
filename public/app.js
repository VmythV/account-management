import { Archive as A, api, reload } from './data.js';
import { $, icon, esc, serviceIcon, tagStyle, localDateTime, toast } from './ui.js';
import { graphData, graphMarkup, destroyGraphs, mountGraphs } from './graphs.js';
import { openModal, bindForms, afterMutation } from './forms.js';
import { formatDuration } from './timeline.js';
import { mountSelects, destroySelects } from './selects.js';
const state={query:'',tags:[],status:'all',selected:null,subStatus:'all',recordKind:'all',recordAccount:'all',graphFocus:'all'};
const tagHTML = name => `<span class="tag" style="${tagStyle(A.tags.find(t=>t.name===name)?.color)}">${esc(name)}</span>`;
const dateText = value => value ? (value.length>10?localDateTime(value):value).slice(0,10).replaceAll('-','.') : '未记录';
const renewalRule = s => s.cycle==='monthly'?`每月 ${s.day} 日`:s.cycle==='yearly'?`每年 ${s.month} 月 ${s.day} 日`:'未设置提醒';
const renewalText = r => r.days===0?'今天续费':`${r.days} 天后续费`;
const dueSubs = () => A.subscriptions.filter(s=>{const r=A.renewal(s);return r&&r.days<=7;}).sort((a,b)=>A.renewal(a).days-A.renewal(b).days);
const linkCount = id => A.links.filter(l=>l.from===id||l.to===id).length;
const btn = (label,action,style='',id='') => `<button class="button ${style}" data-action="${action}" ${id?`data-id="${esc(id)}"`:''}>${label}</button>`;
const empty = (title,message,action='reset-filters',label='清除筛选') => `<div class="empty">${icon('search')}<h3>${title}</h3><p>${message}</p>${action?btn(label,action,'soft'):''}</div>`;
function route(){const [page='accounts',id,tab='overview']=location.hash.slice(1).split('/');return {page,id,tab};}
function relatedIds(id){return new Set([...A.related(id,'up'),...A.related(id,'down')]);}
function heading(title,description,actions,eyebrow='YOUR DIGITAL LIFE, CONNECTED'){return `<div class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${description}</p></div><div class="button-row">${actions||''}</div></div>`;}
function nav(){
  const r=route(), active=r.page==='account'?'accounts':r.page;
  const items=[['accounts','accounts','账号库',A.accounts.length],['graph','graph','关联图谱',''],['subscriptions','card','订阅管理',A.subscriptions.filter(s=>['订阅中','试用中'].includes(s.status)).length],['records','clock','操作记录',''],['tags','tag','标签管理','']];
  $('#navigation').innerHTML=items.map(([id,i,name,count])=>`<a href="#${id}" class="nav-item ${active===id?'active':''}" ${active===id?'aria-current="page"':''} title="${name}">${icon(i)}<span>${name}</span><small class="nav-count">${count}</small></a>`).join('');
  $('#sidebar-tags').innerHTML=A.tags.map(t=>`<button class="side-tag ${state.tags.includes(t.name)&&active==='accounts'?'selected':''}" data-action="side-tag" data-tag="${esc(t.name)}"><span class="tag-dot" style="${tagStyle(t.color)}"></span><span>${esc(t.name)}</span><small>${A.accounts.filter(a=>a.tags.includes(t.name)).length}</small></button>`).join('');
  $('#breadcrumb-current').textContent=r.page==='account'?`账号库 / ${A.get(r.id)?.name||'账号详情'}`:items.find(i=>i[0]===active)?.[2]||'账号库';
}
function stats(){return `<section class="stats-strip" aria-label="账号概览">${[
  ['全部账号',A.accounts.length,'个数字身份','accounts',''],['账号关联',A.links.length,'条清晰脉络','graph',''],
  ['使用中订阅',A.subscriptions.filter(s=>['订阅中','试用中'].includes(s.status)).length,'项持续陪伴','card',''],['近期续费',dueSubs().length,'项 · 未来 7 天','clock','accent']
].map(([label,n,caption,i,color])=>`<div class="stat"><div class="stat-top"><span>${label}</span>${icon(i)}</div><div class="stat-value"><strong class="${color}">${String(n).padStart(2,'0')}</strong><small>${caption}</small></div></div>`).join('')}</section>`;}
function renewalBanner(){const due=dueSubs();return due.length?`<div class="renewal-banner">${icon('bell')}<span><strong>${due.length} 项订阅即将续费</strong><span>　${due.map(s=>esc(A.get(s.account).name)).join('、')} 将在 7 天内续费</span></span><a class="text-button" href="#subscriptions">查看订阅 ${icon('arrow')}</a></div>`:'';}
function accountsPage(){
  const list=A.matching(state.query,state.tags,state.status);
  if(!list.some(a=>a.id===state.selected)) state.selected=list[0]?.id;
  return `${heading('账号库','所有账号，一个清晰的归处。',btn(`${icon('plus')} 新增账号`,'new-account','primary'))}${stats()}${renewalBanner()}
  <div class="library-layout"><section aria-label="账号列表"><div class="list-toolbar"><div class="tabs" aria-label="账号状态">${[['all','全部账号'],['正常','使用中'],['已归档','已归档']].map(([s,name])=>`<button class="tab ${state.status===s?'active':''}" data-action="account-status" data-status="${s}" aria-pressed="${state.status===s}">${name}${s==='all'?`<small>${A.accounts.length}</small>`:''}</button>`).join('')}</div><label class="search">${icon('search')}<input id="account-search" type="search" aria-label="搜索账号、用户名或邮箱" placeholder="搜索账号、用户名或邮箱" value="${esc(state.query)}"></label></div>
  <div class="filter-bar">${icon('filter')}<button class="filter-chip ${!state.tags.length?'active':''}" data-action="clear-tags">全部标签</button>${A.tags.map(t=>`<button class="filter-chip ${state.tags.includes(t.name)?'active':''}" data-action="filter-tag" data-tag="${esc(t.name)}" aria-pressed="${state.tags.includes(t.name)}"><span class="tag-dot" style="${tagStyle(t.color)}"></span>${esc(t.name)}</button>`).join('')}<span class="filter-note">${state.tags.length?'同时包含所选标签':'可多选'}</span></div>
  <div class="panel">${list.length?`<table class="accounts-table"><thead><tr><th>账号 / 标识</th><th>标签</th><th>关联</th><th>订阅状态</th><th class="account-actions">操作</th></tr></thead><tbody>${list.map(a=>{const subs=A.subscriptions.filter(s=>s.account===a.id),s=subs.find(s=>['订阅中','试用中'].includes(s.status))||subs[0];return `<tr class="account-row ${state.selected===a.id?'selected':''}" data-action="select-account" data-id="${a.id}" aria-label="预览 ${esc(a.name)}，${esc(a.identifier)}"><td><button class="identity account-select" data-action="select-account" data-id="${a.id}">${serviceIcon(a)}<span><span class="identity-name">${esc(a.name)}${a.status==='已归档'?'<span class="muted" style="font-size:8px">已归档</span>':''}</span><span class="identity-caption" title="${esc(a.identifier)}">${esc(a.identifier)}</span></span></button></td><td><div class="tags">${a.tags.map(tagHTML).join('')}</div></td><td><span class="count-link">${icon('link')}${linkCount(a.id)}</span></td><td>${s?`<span class="subscription-state ${s.status==='已暂停'?'paused':''}">${esc(s.status)}${subs.length>1?` · ${subs.length} 项`:''}</span>`:'<span class="muted">—</span>'}</td><td class="account-actions"><button class="icon-button" data-action="edit-account" data-id="${a.id}" title="编辑账号" aria-label="编辑 ${esc(a.name)}，${esc(a.identifier)}">${icon('edit')}</button></td></tr>`;}).join('')}</tbody></table>`:(A.accounts.length?empty('没有找到匹配的账号','试试其他关键词，或减少所选标签。'):empty('从第一个账号开始','记录邮箱、用户名或任意账号标识，再逐步建立关联。','new-account','新增账号'))}<div class="table-footer"><span>共 ${list.length} 个账号${state.tags.length?' · 标签取交集':''}</span><span>点击账号，查看关联速览 ${icon('arrow')}</span></div></div></section>
  <aside class="library-aside">${state.selected?previewPanel(state.selected):`<div class="panel">${empty('等待选择账号','调整筛选后，这里会显示账号关联。','','')}</div>`}${recentPanel()}</aside></div>`;
}
function previewPanel(id){
  const a=A.get(id), direct=A.links.filter(l=>l.from===id), down=A.related(id,'down').size-1;

  return `<section class="panel preview-panel"><div class="panel-heading"><h2>关联速览</h2><span class="kicker">ACCOUNT CONNECTIONS</span></div><div class="preview-identity"><div class="identity">${serviceIcon(a,'large')}<div><span class="identity-name">${esc(a.name)}<small class="preview-type">${esc(a.type)}</small></span><span class="identity-caption">${esc(a.identifier)}</span></div></div><div class="tags">${a.tags.map(tagHTML).join('')}</div></div><div class="preview-facts"><span class="muted">直接关联<strong>${linkCount(id)}</strong></span><span class="muted">下游账号<strong>${down}</strong></span></div><div class="preview-graph"><div class="graph-caption">${icon('graph')} 来源与去向<a href="#account/${id}/links" class="text-button">完整链路 ${icon('arrow')}</a></div>${graphMarkup(id,'preview')}</div><div class="preview-actions"><a class="button soft wide" href="#account/${id}/overview">查看账号详情 ${icon('arrow')}</a>${a.website?`<a class="button wide account-website-button" href="${esc(a.website)}" target="_blank" rel="noopener noreferrer" aria-label="访问网站（在新标签页打开）">访问网站 ${icon('external')}</a>`:''}<p class="preview-note">${direct.length?'这里记录账号之间的注册与登录关系，顺着链路，就能找到来处。':'关联保留登录来源；账号标识可以是邮箱，也可以只是用户名。'}</p></div></section>`;
}
function recentPanel(){return `<section class="panel recent-panel"><div class="panel-heading"><h2>最近动态</h2><a href="#records" class="text-button">全部 ${icon('chevron')}</a></div>${[...A.events].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,2).map(e=>`<a href="#account/${e.account}/records" class="recent-entry"><span class="recent-dot"></span><div><p>${esc(e.title)}</p><small>${esc(A.get(e.account).name)} · ${dateText(e.date)}</small></div></a>`).join('')}</section>`;}
function timeline(events,withAccount=false){return events.length?`<div class="timeline">${[...events].sort((a,b)=>b.date.localeCompare(a.date)).map(e=>`<article class="timeline-item"><div class="timeline-meta"><span>${dateText(e.date)} · ${localDateTime(e.date).slice(11,16)}</span><span>${esc(e.kind)}</span>${withAccount?`<a class="record-account" href="#account/${e.account}/overview">${serviceIcon(A.get(e.account),'tiny')}${esc(A.get(e.account).name)}</a>`:''}</div><h3>${esc(e.title)}</h3><p>${esc(e.text)}</p>${e.snapshot?`<span class="event-snapshot">${esc(e.snapshot)}</span>`:''}<div class="timeline-actions">${e.automatic?'<span class="muted">自动记录</span>':`<button class="text-button" data-action="edit-event" data-id="${e.id}">更正记录</button>`}</div></article>`).join('')}</div>`:empty('还没有操作记录','记录注册、变更或订阅，留下每一次变化。','new-event','记录一次操作');}
function detailPage(id,tab){
  const a=A.get(id);if(!a)return empty('没有找到这个账号','返回账号库，选择一个已有账号。','go-accounts','返回账号库');
  const subscriptions=A.subscriptions.filter(s=>s.account===id), events=A.events.filter(e=>e.account===id);
  const info=`<section class="panel"><div class="panel-heading"><h2>账号信息</h2><button class="text-button" data-action="edit-account" data-id="${id}">${icon('edit')} 编辑</button></div><dl class="info-grid"><div><dt>账号标识</dt><dd class="copy-line"><span>${esc(a.identifier)}</span><button class="icon-button" data-action="copy" data-id="${id}" aria-label="复制账号标识">${icon('copy')}</button></dd></div><div><dt>账号类型</dt><dd>${esc(a.type)}</dd></div><div><dt>注册日期</dt><dd>${dateText(a.created)}</dd></div><div><dt>自定义标签</dt><dd><div class="tags">${a.tags.map(tagHTML).join('')||'<span class="muted">未设置</span>'}</div></dd></div><div class="full"><dt>网站</dt><dd>${a.website?`<a class="website-link" href="${esc(a.website)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(a.website)}（在新标签页打开）"><span>${esc(a.website)}</span>${icon('external')}</a>`:'<span class="muted">未设置</span>'}</dd></div><div class="full"><dt>备注</dt><dd>${esc(a.notes||'还没有备注')}</dd></div></dl></section>`;
  const overviewGraph=`<section class="panel"><div class="detail-graph-heading"><div class="button-row"><a class="text-button" href="#account/${id}/links">展开完整链路 ${icon('arrow')}</a></div><h2>账号关联</h2><p>箭头从来源账号，指向使用它注册或登录的账号。</p></div>${graphMarkup(id,'overview')}<div class="relation-summary"><span>上游来源 <strong>${A.related(id,'up').size-1}</strong></span><span>下游账号 <strong>${A.related(id,'down').size-1}</strong></span><span>直接关联 <strong>${linkCount(id)}</strong></span></div></section>`;
  const records=`<section class="panel"><div class="panel-heading"><h2>操作时间线 <span class="muted">${events.length}</span></h2><button class="text-button" data-action="new-event" data-id="${id}">${icon('plus')} 记录操作</button></div>${timeline(events)}</section>`;
  return `<a class="back-link" href="#accounts">${icon('back')} 返回账号库</a><div class="detail-heading"><div class="identity">${serviceIcon(a,'large')}<div><h1>${esc(a.name)}<span class="status-pill">${a.status}</span></h1><span class="identity-caption">${esc(a.identifier)}</span></div></div><div class="button-row">${btn(`${icon('link')} 添加关联`,'new-link','',id)}${btn(`${icon('plus')} 记录操作`,'new-event','primary',id)}</div></div><div class="tabs detail-tabs">${[['overview','概览'],['links','关联链路'],['records','操作记录'],['subscriptions','订阅']].map(([t,label])=>`<a class="tab ${tab===t?'active':''}" href="#account/${id}/${t}" ${tab===t?'aria-current="page"':''}>${label}</a>`).join('')}</div>
  ${tab==='links'?`${graphPanel(id)}${linkTable(id)}`:tab==='records'?records:tab==='subscriptions'?`<div class="detail-layout"><div class="detail-main">${records}</div><aside class="detail-aside">${accountSubscriptions(subscriptions,id)}</aside></div>`:`<div class="detail-layout"><div class="detail-main">${info}${overviewGraph}${records}</div><aside class="detail-aside">${accountSubscriptions(subscriptions,id)}<div class="hint-box" style="margin-top:0"><h3>${icon('shield')} 只记录必要的信息</h3><p class="hint">账号标识、标签与关系都在这里。请勿在备注或操作记录中填写密码和密钥。</p></div></aside></div>`}`;
}
function subscriptionDetail(s,id){if(!s)return `<section class="panel"><div class="panel-heading"><h2>账号订阅</h2>${icon('card')}</div><div class="no-sub">${icon('card')}<h3>这个账号还没有订阅</h3><p>开通、续费、暂停或取消，<br>每一步都可以记录下来。</p>${btn(`${icon('plus')} 新增订阅`,'new-sub','soft',id)}</div></section>`;const r=A.renewal(s);return `<section class="panel"><div class="panel-heading"><h2>${esc(s.name)} <button class="icon-button" data-action="rename-sub" data-id="${s.id}" aria-label="编辑订阅名称">${icon('edit')}</button></h2><span class="subscription-state ${r?'':'paused'}">${esc(s.status)}</span></div><div class="sub-card-body"><span class="eyebrow">${esc(A.get(s.account).name.toUpperCase())}</span><h3 class="plan-name">${esc(s.plan)}</h3><p class="sub-description">${s.cycle==='monthly'?'月度订阅':s.cycle==='yearly'?'年度订阅':'自定义订阅'}</p><div class="renewal-box">${r?`<strong>${renewalText(r)}</strong><br>${r.date.getFullYear()}.${String(r.date.getMonth()+1).padStart(2,'0')}.${String(r.date.getDate()).padStart(2,'0')} · ${renewalRule(s)}`:`${esc(s.status)} · ${s.cycle==='none'?'未设置提醒':'续费提醒已暂停'}`}</div><div class="duration-line"><span>累计使用时长</span><strong>${formatDuration(s.activeMs)}</strong></div><div class="duration-line"><span>首次开通</span><strong>${dateText(s.start)}</strong></div>${btn('记录订阅变更','edit-sub','wide',s.id)}<p class="preview-note">订阅与试用计入时长，暂停和结束期间不计入。到期提醒不代表自动扣费。</p></div></section>`;}
function graphPanel(focus='all'){
  const {accounts,links}=graphData(focus);
  return `<section class="panel"><div class="graph-toolbar"><div class="graph-legend"><span><i class="legend-line"></i>来源 → 目标账号</span><span>拖动画布 · 滚轮缩放 · 点击查看</span></div>${route().page==='graph'?`<select data-search id="graph-focus" class="graph-select" aria-label="聚焦某个账号"><option value="all">全部账号的关联</option>${A.accounts.map(a=>`<option value="${a.id}" ${focus===a.id?'selected':''}>聚焦 ${esc(a.name)} · ${esc(a.identifier)}</option>`).join('')}</select>`:`<span class="pill-note">${esc(A.get(focus).name)} 的上游与下游</span>`}</div>${graphMarkup(focus)}<div class="graph-foot"><span>${accounts.length} 个账号 · ${links.length} 条关联${focus!=='all'?' · 包含间接关联':''}</span><span>注册与登录关系自动排布</span></div></section>`;
}

function linkTable(id){const links=A.links.filter(l=>l.from===id||l.to===id);return `<section class="panel" style="margin-top:22px"><div class="panel-heading"><h2>直接关联明细</h2>${btn(`${icon('plus')} 添加关联`,'new-link','quiet',id)}</div><div class="chain-list">${links.map(l=>`<div class="relation-item"><div class="chain-row"><a class="chain-node" href="#account/${l.from}/overview">${esc(A.get(l.from).name)}<small>${esc(A.get(l.from).identifier)}</small></a><span class="chain-edge">${esc(l.type)}${icon('arrow')}</span><a class="chain-node" href="#account/${l.to}/overview">${esc(A.get(l.to).name)}<small>${esc(A.get(l.to).identifier)}</small></a></div>${l.notes?`<p class="hint">${esc(l.notes)}</p>`:''}<div class="relation-actions"><button class="text-button" data-action="edit-link" data-id="${l.id}">编辑关联</button><button class="text-button danger" data-action="delete-link" data-id="${l.id}">解除关联</button></div></div>`).join('')||'<p class="hint">暂时没有直接关联。</p>'}</div></section>`;}
function graphPage(){if(!A.accounts.length)return `${heading('关联图谱','添加账号后，在这里查看它们的来源与去向。','')}${empty('还没有账号关联','先添加账号，再建立注册或登录关系。','new-account','新增账号')}`;return `${heading('关联图谱','从哪里注册，又通向哪里。一张图，理清账号之间的关系。',btn(`${icon('link')} 添加关联`,'new-link','primary'),'FOLLOW THE CONNECTIONS')}${graphPanel(state.graphFocus)}<div class="graph-explainer"><div class="panel explanation">${icon('graph')}<div><h3>从来源，看到完整链路</h3><p>邮箱 → Apple → Notion。注册关系与第三方登录可以串联，<br>聚焦一个账号，同时查看它的上游来源和下游服务。</p></div></div><div class="panel explanation">${icon('tag')}<div><h3>关系可以由你定义</h3><p>邮箱注册、Apple 登录、GitHub 登录，也可以自定义关联方式。<br>同一个账号可以有多个来源，不限制账号类型。</p></div></div></div>`;}
function subscriptionsPage(){const list=A.subscriptions.filter(s=>state.subStatus==='all'||(state.subStatus==='upcoming'?A.renewal(s)?.days<=7:s.status===state.subStatus));return `${heading('订阅管理','记下每次开通、续费与暂停，掌握你的使用节奏。',btn(`${icon('plus')} 新增订阅`,'new-sub','primary'),'MAKE EVERY SUBSCRIPTION COUNT')}${stats()}${renewalBanner()}<div class="sub-filter">${[['all','全部订阅'],['订阅中','订阅中'],['试用中','试用中'],['已暂停','已暂停'],['已取消','已取消'],['已到期','已到期'],['被封禁','被封禁'],['upcoming','即将续费']].map(([s,label])=>`<button class="filter-chip ${state.subStatus===s?'active':''}" data-action="sub-status" data-status="${s}" aria-pressed="${state.subStatus===s}">${label}</button>`).join('')}</div><div class="subscription-grid">${list.map(s=>{const a=A.get(s.account),r=A.renewal(s);return `<article class="panel subscription-card"><h2 class="subscription-name">${esc(s.name)}</h2><div class="identity">${serviceIcon(a)}<div><span class="identity-name">${esc(a.name)}</span><span class="identity-caption">${esc(a.identifier)}</span></div><span class="subscription-state ${r?'':'paused'}" style="margin-left:auto">${esc(s.status)}</span></div><div class="plan-line"><strong>${esc(s.plan)}</strong><small>${s.cycle==='monthly'?'月度订阅':s.cycle==='yearly'?'年度订阅':'自定义订阅'}</small></div><dl><dt>累计使用</dt><dd>${formatDuration(s.activeMs)}</dd><dt>首次开通</dt><dd>${dateText(s.start)}</dd><dt>续费规则</dt><dd>${renewalRule(s)}</dd></dl><div class="card-bottom"><span class="${r&&r.days<=7?(r.days<=3?'due urgent':'due'):'muted'}">${r?renewalText(r):s.cycle==='none'?'未设置提醒':'提醒已暂停'}</span><a class="text-button" href="#account/${a.id}/subscriptions">订阅详情 ${icon('arrow')}</a></div></article>`;}).join('')}</div>${!list.length?empty('没有这个状态的订阅','选择其他状态，或为账号添加一项订阅。','new-sub','新增订阅'):''}<p class="hint" style="margin-top:22px">时长由历史状态计算；续费提醒按日历计算，不自动确认付款。</p>`;}
function recordsPage(){const events=A.events.filter(e=>(state.recordKind==='all'||e.kind===state.recordKind)&&(state.recordAccount==='all'||e.account===state.recordAccount));return `${heading('操作记录','从第一次注册开始，为账号的每次变化留下记录。',btn(`${icon('plus')} 记录操作`,'new-event','primary'),'A TIMELINE OF YOUR DIGITAL LIFE')}<div class="records-layout"><section class="panel"><div class="panel-heading"><h2>所有动态 <span class="muted">${events.length}</span></h2><span class="kicker">最新记录在前</span></div>${timeline(events,true)}</section><aside><section class="panel records-filter"><h3>筛选记录</h3><div class="field"><label for="record-account-filter">所属账号</label><select data-search id="record-account-filter"><option value="all">全部账号</option>${A.accounts.map(a=>`<option value="${a.id}" ${state.recordAccount===a.id?'selected':''}>${esc(a.name)}</option>`).join('')}</select></div><div class="field"><label for="record-kind-filter">记录类型</label><select id="record-kind-filter">${['all','账号记录','关联变更','订阅变更'].map(k=>`<option value="${k}" ${state.recordKind===k?'selected':''}>${k==='all'?'全部类型':k}</option>`).join('')}</select></div><p class="hint">按操作发生的时间排列，<br>也可以补录过去的经历。</p></section><div class="hint-box"><h3>让变化有迹可循</h3><p class="hint">每次订阅变更都留下一份信息快照。更正旧记录时，其他记录保持原样。</p></div></aside></div>`;}
function render(){
  const focused=document.activeElement, focusId=focused?.id, cursor=focused?.selectionStart;
  A.updateTime();
  const r=route();nav();destroyGraphs();destroySelects($('#main'));
  $('#main').innerHTML=r.page==='account'?detailPage(r.id,r.tab):r.page==='graph'?graphPage():r.page==='subscriptions'?subscriptionsPage():r.page==='records'?recordsPage():r.page==='tags'?tagsPage():accountsPage();
  mountGraphs();mountSelects($('#main'));
  if(focusId){
    const input=document.getElementById(focusId);
    if(input){
      const picker=input.dataset.selectId?document.getElementById(input.dataset.selectId)?.tomselect:null;
      if(picker)picker.settings.openOnFocus=false;
      input.focus({preventScroll:true});
      if(picker)picker.settings.openOnFocus=true;
      if(cursor!=null&&input.type==='search')input.setSelectionRange(cursor,cursor);
    }
  }
}
function accountSubscriptions(list,id){return `${list.length?list.map(s=>subscriptionDetail(s,id)).join(''):subscriptionDetail(null,id)}${list.length?btn(`${icon('plus')} 再添加一项订阅`,'new-sub','wide',id):''}`;}
function tagsPage(){return `${heading('标签管理','给账号自由分类，名称与颜色随时调整。',btn(`${icon('plus')} 新建标签`,'new-tag','primary'))}<section class="panel tags-manager">${A.tags.map(t=>`<div class="tag-manager-row"><span class="tag" style="${tagStyle(t.color)}">${esc(t.name)}</span><span class="muted">${A.accounts.filter(a=>a.tagIds.includes(t.id)).length} 个账号</span><div class="button-row">${btn('编辑','edit-tag','quiet',t.id)}${btn('删除','delete-tag','quiet danger',t.id)}</div></div>`).join('')||empty('还没有自定义标签','创建标签后，即可在新增或编辑账号时使用。','new-tag','新建标签')}</section>`;}

bindForms();
document.addEventListener('archive-change',e=>{
  state.tags=state.tags.filter(name=>A.tags.some(t=>t.name===name));
  if(e.detail.newAccount){state.query='';state.tags=[];state.status='all';state.selected=e.detail.newAccount;location.hash=`#account/${e.detail.newAccount}/overview`;}
  render();
});
const modalActions=['new-account','edit-account','new-link','edit-link','new-event','edit-event','new-sub','edit-sub','edit-sub-event','rename-sub','new-tag','edit-tag','help'];
document.addEventListener('click',async e=>{
  const el=e.target.closest('[data-action]');if(!el)return;
  const action=el.dataset.action,id=el.dataset.id;
  try{
    if(modalActions.includes(action))return openModal(action,id);
    if(action==='close-modal')return;
    if(action==='logout'){await api('/api/logout','POST',{});location.replace('/login');return;}
    if(action==='refresh'){await reload();render();toast('数据已刷新');return;}
    if(action==='delete-tag'||action==='delete-link'){
      const tag=action==='delete-tag',record=(tag?A.tags:A.links).find(r=>r.id===id);
      if(!confirm(tag?`删除标签「${record.name}」？账号和其他记录会保留。`:'解除这条账号关联？已有操作记录会保留。'))return;
      el.disabled=true;
      try{await api(`/api/${tag?'tags':'relations'}/${id}`,'DELETE',{version:record.version});await afterMutation();}finally{el.disabled=false;}
      return;
    }
    if(action==='select-account'){state.selected=id;render();return;}
    if(action==='view-account'){location.hash=`#account/${id}/overview`;return;}
    if(action==='account-status')state.status=el.dataset.status;
    if(action==='filter-tag')state.tags=state.tags.includes(el.dataset.tag)?state.tags.filter(t=>t!==el.dataset.tag):[...state.tags,el.dataset.tag];
    if(action==='side-tag'){state.tags=[el.dataset.tag];state.query='';state.status='all';if(route().page!=='accounts'){location.hash='#accounts';return;}}
    if(action==='clear-tags')state.tags=[];
    if(action==='reset-filters'){state.tags=[];state.query='';state.status='all';}
    if(action==='sub-status')state.subStatus=el.dataset.status;
    if(action==='go-accounts'){location.hash='#accounts';return;}
    if(action==='copy'){try{await navigator.clipboard.writeText(A.get(id).identifier);toast('账号标识已复制');}catch{toast('请手动选择并复制账号标识。');}return;}
    render();
  }catch(error){toast(error.message);}
});
document.addEventListener('input',e=>{if(e.target.id==='account-search'){state.query=e.target.value;render();}});
document.addEventListener('change',e=>{const key={'graph-focus':'graphFocus','record-account-filter':'recordAccount','record-kind-filter':'recordKind'}[e.target.id];if(key){state[key]=e.target.value;render();}});
window.addEventListener('hashchange',()=>{render();window.scrollTo(0,0);});
document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
setInterval(()=>{if(!document.hidden&&!$('#modal').open)render();},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!$('#modal').open)render();});
async function start(){
  try{const session=await api('/api/session');if(!session.authenticated){location.replace('/login');return;}await reload();render();}
  catch(error){$('#main').innerHTML=`<div class="empty"><h3>暂时无法读取档案</h3><p>${esc(error.message)}</p>${btn('重新读取','refresh','primary')}</div>`;}
}
start();
