const $ = selector => document.querySelector(selector);
const A = Archive;
const state = {query:'',tags:[],status:'all',selected:'gmail',subStatus:'all',recordKind:'all',recordAccount:'all',graphFocus:'all'};
const paths = {
  grid:'M3 3h6v6H3z M15 3h6v6h-6z M3 15h6v6H3z M15 15h6v6h-6z',
  accounts:'M8 3h8v5H8z M5 5H3v16h18V5h-2 M8 13h8 M8 17h5',
  graph:'M3 9h5v6H3z M16 2h5v6h-5z M16 16h5v6h-5z M8 12h4V5h4 M12 12v7h4',
  card:'M3 5h18v14H3z M3 10h18 M7 15h3',
  clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2',
  shield:'M12 3l8 3v5c0 5-4 8-8 10-4-2-8-5-8-10V6z M8 12l3 3 5-6',
  search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6',
  plus:'M12 5v14 M5 12h14',
  arrow:'M4 12h16 M15 7l5 5-5 5',
  back:'M20 12H4 M9 7l-5 5 5 5',
  chevron:'M9 5l7 7-7 7',
  link:'M10 14l4-4 M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0 M16 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',
  bell:'M6 10a6 6 0 0 1 12 0v5l2 3H4l2-3z M10 21h4',
  filter:'M4 6h16 M7 12h10 M10 18h4',
  close:'M6 6l12 12 M18 6L6 18',
  help:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5 M12 17h.01',
  edit:'M14 5l5 5 M4 20l1-6L16 3l5 5-11 11z',
  copy:'M8 8h12v13H8z M16 8V3H3v13h5',
  tag:'M3 3h8l10 10-8 8L3 11z M7 7h.01',
  check:'M5 12l4 4L19 6',
  external:'M14 3h7v7 M21 3L10 14 M10 3H3v18h18v-7'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]||paths.accounts}"/></svg>`;
const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const serviceIcon = (a,size='') => `<span class="service-icon ${esc(a.brand||'')} ${size}" aria-hidden="true">${esc(a.mark||a.name.slice(0,1))}</span>`;
function tagStyle(color) {
  if(!/^#[0-9a-f]{6}$/i.test(color))color='#6b9c87';
  return `--tag-color:${color};--tag-bg:${color}1a;--tag-ink:color-mix(in srgb,${color} 25%,#24332c)`;
}
const tagHTML = name => `<span class="tag" style="${tagStyle(A.tags.find(t=>t.name===name)?.color)}">${esc(name)}</span>`;
const dateText = value => value.slice(0,10).replaceAll('-','.');
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
  const items=[['accounts','accounts','账号库',A.accounts.length],['graph','graph','关联图谱',''],['subscriptions','card','订阅管理',A.subscriptions.filter(s=>['订阅中','试用中'].includes(s.status)).length],['records','clock','操作记录','']];
  $('#navigation').innerHTML=items.map(([id,i,name,count])=>`<a href="#${id}" class="nav-item ${active===id?'active':''}" ${active===id?'aria-current="page"':''} title="${name}">${icon(i)}<span>${name}</span><small class="nav-count">${count}</small></a>`).join('');
  $('#sidebar-tags').innerHTML=A.tags.map(t=>`<button class="side-tag ${state.tags.includes(t.name)&&active==='accounts'?'selected':''}" data-action="side-tag" data-tag="${esc(t.name)}"><span class="tag-dot" style="${tagStyle(t.color)}"></span><span>${esc(t.name)}</span><small>${A.accounts.filter(a=>a.tags.includes(t.name)).length}</small></button>`).join('');
  $('#breadcrumb-current').textContent=r.page==='account'?`账号库 / ${A.get(r.id)?.name||'账号详情'}`:items.find(i=>i[0]===active)?.[2]||'账号库';
}
function stats(){return `<section class="stats-strip" aria-label="账号概览">${[
  ['全部账号',A.accounts.length,'个数字身份','accounts',''],['账号关联',A.links.length,'条清晰脉络','graph',''],
  ['使用中订阅',A.subscriptions.filter(s=>['订阅中','试用中'].includes(s.status)).length,'项持续陪伴','card',''],['近期续费',dueSubs().length,'项 · 未来 7 天','clock','accent']
].map(([label,n,caption,i,color])=>`<div class="stat"><div class="stat-top"><span>${label}</span>${icon(i)}</div><div class="stat-value"><strong class="${color}">${String(n).padStart(2,'0')}</strong><small>${caption}</small></div></div>`).join('')}</section>`;}
function renewalBanner(){const due=dueSubs();return due.length?`<div class="renewal-banner">${icon('bell')}<span><strong>${due.length} 项订阅即将续费</strong><span>　${due.map(s=>A.get(s.account).name).join('、')} 将在 7 天内续费</span></span><a class="text-button" href="#subscriptions">查看订阅 ${icon('arrow')}</a></div>`:'';}
function accountsPage(){
  const list=A.matching(state.query,state.tags,state.status);
  if(!list.some(a=>a.id===state.selected)) state.selected=list[0]?.id;
  return `${heading('账号库','所有账号，一个清晰的归处。',btn(`${icon('plus')} 新增账号`,'new-account','primary'))}${stats()}${renewalBanner()}
  <div class="library-layout"><section aria-label="账号列表"><div class="list-toolbar"><div class="tabs" aria-label="账号状态">${[['all','全部账号'],['正常','使用中'],['已归档','已归档']].map(([s,name])=>`<button class="tab ${state.status===s?'active':''}" data-action="account-status" data-status="${s}" aria-pressed="${state.status===s}">${name}${s==='all'?`<small>${A.accounts.length}</small>`:''}</button>`).join('')}</div><label class="search">${icon('search')}<input id="account-search" type="search" aria-label="搜索账号、用户名或邮箱" placeholder="搜索账号、用户名或邮箱" value="${esc(state.query)}"></label></div>
  <div class="filter-bar">${icon('filter')}<button class="filter-chip ${!state.tags.length?'active':''}" data-action="clear-tags">全部标签</button>${A.tags.map(t=>`<button class="filter-chip ${state.tags.includes(t.name)?'active':''}" data-action="filter-tag" data-tag="${esc(t.name)}" aria-pressed="${state.tags.includes(t.name)}"><span class="tag-dot" style="${tagStyle(t.color)}"></span>${esc(t.name)}</button>`).join('')}<span class="filter-note">${state.tags.length?'同时包含所选标签':'可多选'}</span></div>
  <div class="panel">${list.length?`<table class="accounts-table"><thead><tr><th>账号 / 标识</th><th>标签</th><th>关联</th><th>订阅状态</th></tr></thead><tbody>${list.map(a=>{const s=A.subscriptions.find(s=>s.account===a.id);return `<tr class="account-row ${state.selected===a.id?'selected':''}" tabindex="0" role="button" data-action="select-account" data-id="${a.id}" aria-label="预览 ${esc(a.name)}，${esc(a.identifier)}"><td><div class="identity">${serviceIcon(a)}<div><span class="identity-name">${esc(a.name)}${a.status==='已归档'?'<span class="muted" style="font-size:8px">已归档</span>':''}</span><span class="identity-caption" title="${esc(a.identifier)}">${esc(a.identifier)}</span></div></div></td><td><div class="tags">${a.tags.map(tagHTML).join('')}</div></td><td><span class="count-link">${icon('link')}${linkCount(a.id)}</span></td><td>${s?`<span class="subscription-state ${s.status==='已暂停'?'paused':''}">${esc(s.status)}</span>`:'<span class="muted">—</span>'}</td></tr>`;}).join('')}</tbody></table>`:empty('没有找到匹配的账号','试试其他关键词，或减少所选标签。')}<div class="table-footer"><span>共 ${list.length} 个账号${state.tags.length?' · 标签取交集':''}</span><span>点击账号，查看关联速览 ${icon('arrow')}</span></div></div></section>
  <aside class="library-aside">${state.selected?previewPanel(state.selected):`<div class="panel">${empty('等待选择账号','调整筛选后，这里会显示账号关联。','','')}</div>`}${recentPanel()}</aside></div>`;
}
function previewPanel(id){
  const a=A.get(id), direct=A.links.filter(l=>l.from===id), down=A.related(id,'down').size-1;

  return `<section class="panel preview-panel"><div class="panel-heading"><h2>关联速览</h2><span class="kicker">ACCOUNT CONNECTIONS</span></div><div class="preview-identity"><div class="identity">${serviceIcon(a,'large')}<div><span class="identity-name">${esc(a.name)}<small class="preview-type">${esc(a.type)}</small></span><span class="identity-caption">${esc(a.identifier)}</span></div></div><div class="tags">${a.tags.map(tagHTML).join('')}</div></div><div class="preview-facts"><span class="muted">直接关联<strong>${linkCount(id)}</strong></span><span class="muted">下游账号<strong>${down}</strong></span></div><div class="preview-graph"><div class="graph-caption">${icon('graph')} 来源与去向<a href="#account/${id}/links" class="text-button">完整链路 ${icon('arrow')}</a></div>${graphMarkup(id,'preview')}</div><div class="preview-actions"><a class="button soft wide" href="#account/${id}/overview">查看账号详情 ${icon('arrow')}</a><p class="preview-note">${direct.length?'这里记录账号之间的注册与登录关系，顺着链路，就能找到来处。':'关联保留登录来源；账号标识可以是邮箱，也可以只是用户名。'}</p></div></section>`;
}
function recentPanel(){return `<section class="panel recent-panel"><div class="panel-heading"><h2>最近动态</h2><a href="#records" class="text-button">全部 ${icon('chevron')}</a></div>${[...A.events].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,2).map(e=>`<a href="#account/${e.account}/records" class="recent-entry"><span class="recent-dot"></span><div><p>${esc(e.title)}</p><small>${esc(A.get(e.account).name)} · ${dateText(e.date)}</small></div></a>`).join('')}</section>`;}
function timeline(events,withAccount=false){return events.length?`<div class="timeline">${[...events].sort((a,b)=>b.date.localeCompare(a.date)).map(e=>`<article class="timeline-item"><div class="timeline-meta"><span>${dateText(e.date)} · ${e.date.slice(11,16)}</span><span>${esc(e.kind)}</span>${withAccount?`<a class="record-account" href="#account/${e.account}/overview">${serviceIcon(A.get(e.account),'tiny')}${esc(A.get(e.account).name)}</a>`:''}</div><h3>${esc(e.title)}</h3><p>${esc(e.text)}</p>${e.snapshot?`<span class="event-snapshot">${esc(e.snapshot)}</span>`:''}<div class="timeline-actions"><button class="text-button" data-action="edit-event" data-id="${e.id}">更正记录</button></div></article>`).join('')}</div>`:empty('还没有操作记录','记录注册、变更或订阅，留下每一次变化。','new-event','记录一次操作');}
function detailPage(id,tab){
  const a=A.get(id);if(!a)return empty('没有找到这个账号','返回账号库，选择一个已有账号。','go-accounts','返回账号库');
  const s=A.subscriptions.find(s=>s.account===id), events=A.events.filter(e=>e.account===id);
  const info=`<section class="panel"><div class="panel-heading"><h2>账号信息</h2><button class="text-button" data-action="edit-account" data-id="${id}">${icon('edit')} 编辑</button></div><dl class="info-grid"><div><dt>账号标识</dt><dd class="copy-line"><span>${esc(a.identifier)}</span><button class="icon-button" data-action="copy" data-id="${id}" aria-label="复制账号标识">${icon('copy')}</button></dd></div><div><dt>账号类型</dt><dd>${esc(a.type)}</dd></div><div><dt>创建日期</dt><dd>${dateText(a.created)}</dd></div><div><dt>自定义标签</dt><dd><div class="tags">${a.tags.map(tagHTML).join('')||'<span class="muted">未设置</span>'}</div></dd></div><div class="full"><dt>备注</dt><dd>${esc(a.notes||'还没有备注')}</dd></div></dl></section>`;
  const overviewGraph=`<section class="panel"><div class="detail-graph-heading"><div class="button-row"><a class="text-button" href="#account/${id}/links">展开完整链路 ${icon('arrow')}</a></div><h2>账号关联</h2><p>箭头从来源账号，指向使用它注册或登录的账号。</p></div>${graphMarkup(id,'overview')}<div class="relation-summary"><span>上游来源 <strong>${A.related(id,'up').size-1}</strong></span><span>下游账号 <strong>${A.related(id,'down').size-1}</strong></span><span>直接关联 <strong>${linkCount(id)}</strong></span></div></section>`;
  const records=`<section class="panel"><div class="panel-heading"><h2>操作时间线 <span class="muted">${events.length}</span></h2><button class="text-button" data-action="new-event" data-id="${id}">${icon('plus')} 记录操作</button></div>${timeline(events)}</section>`;
  return `<a class="back-link" href="#accounts">${icon('back')} 返回账号库</a><div class="detail-heading"><div class="identity">${serviceIcon(a,'large')}<div><h1>${esc(a.name)}<span class="status-pill">${a.status}</span></h1><span class="identity-caption">${esc(a.identifier)}</span></div></div><div class="button-row">${btn(`${icon('link')} 添加关联`,'new-link','',id)}${btn(`${icon('plus')} 记录操作`,'new-event','primary',id)}</div></div><div class="tabs detail-tabs">${[['overview','概览'],['links','关联链路'],['records','操作记录'],['subscriptions','订阅']].map(([t,label])=>`<a class="tab ${tab===t?'active':''}" href="#account/${id}/${t}" ${tab===t?'aria-current="page"':''}>${label}</a>`).join('')}</div>
  ${tab==='links'?`${graphPanel(id)}${linkTable(id)}`:tab==='records'?records:tab==='subscriptions'?`<div class="detail-layout"><div class="detail-main">${records}</div><aside class="detail-aside">${subscriptionDetail(s,id)}</aside></div>`:`<div class="detail-layout"><div class="detail-main">${info}${overviewGraph}${records}</div><aside class="detail-aside">${subscriptionDetail(s,id)}<div class="hint-box" style="margin-top:0"><h3>${icon('shield')} 只记录必要的信息</h3><p class="hint">账号标识、标签与关系都在这里。请勿在备注或操作记录中填写密码和密钥。</p></div></aside></div>`}`;
}
function subscriptionDetail(s,id){if(!s)return `<section class="panel"><div class="panel-heading"><h2>账号订阅</h2>${icon('card')}</div><div class="no-sub">${icon('card')}<h3>这个账号还没有订阅</h3><p>开通、续费、暂停或取消，<br>每一步都可以记录下来。</p>${btn(`${icon('plus')} 新增订阅`,'new-sub','soft',id)}</div></section>`;const r=A.renewal(s);return `<section class="panel"><div class="panel-heading"><h2>当前订阅</h2><span class="subscription-state ${r?'':'paused'}">${esc(s.status)}</span></div><div class="sub-card-body"><span class="eyebrow">${esc(A.get(s.account).name.toUpperCase())}</span><h3 class="plan-name">${esc(s.plan)}</h3><p class="sub-description">${s.cycle==='monthly'?'月度订阅':s.cycle==='yearly'?'年度订阅':'自定义订阅'}</p><div class="renewal-box">${r?`<strong>${renewalText(r)}</strong><br>${r.date.getFullYear()}.${String(r.date.getMonth()+1).padStart(2,'0')}.${String(r.date.getDate()).padStart(2,'0')} · ${renewalRule(s)}`:`${esc(s.status)} · 续费提醒已暂停`}</div><div class="duration-line"><span>累计使用时长</span><strong>${s.duration} 天</strong></div><div class="duration-line"><span>首次开通</span><strong>${dateText(s.start)}</strong></div>${btn('记录订阅变更','edit-sub','wide',s.id)}<p class="preview-note">订阅与试用计入时长，暂停和结束期间不计入。到期提醒不代表自动扣费。</p></div></section>`;}
function graphPanel(focus='all'){
  const {accounts,links}=graphData(focus);
  return `<section class="panel"><div class="graph-toolbar"><div class="graph-legend"><span><i class="legend-line"></i>来源 → 目标账号</span><span>拖动画布 · 滚轮缩放 · 点击查看</span></div>${route().page==='graph'?`<select id="graph-focus" class="graph-select" aria-label="聚焦某个账号"><option value="all">全部账号的关联</option>${A.accounts.map(a=>`<option value="${a.id}" ${focus===a.id?'selected':''}>聚焦 ${esc(a.name)}</option>`).join('')}</select>`:`<span class="pill-note">${esc(A.get(focus).name)} 的上游与下游</span>`}</div>${graphMarkup(focus)}<div class="graph-foot"><span>${accounts.length} 个账号 · ${links.length} 条关联${focus!=='all'?' · 包含间接关联':''}</span><span>注册与登录关系自动排布</span></div></section>`;
}

function linkTable(id){const links=A.links.filter(l=>l.from===id||l.to===id);return `<section class="panel" style="margin-top:22px"><div class="panel-heading"><h2>直接关联明细</h2>${btn(`${icon('plus')} 添加关联`,'new-link','quiet',id)}</div><div class="chain-list">${links.length?links.map(l=>`<div class="chain-row"><a class="chain-node" href="#account/${l.from}/overview">${serviceIcon(A.get(l.from),'tiny')}${esc(A.get(l.from).name)}</a><span class="chain-edge">${esc(l.type)}${icon('arrow')}</span><a class="chain-node" href="#account/${l.to}/overview">${serviceIcon(A.get(l.to),'tiny')}${esc(A.get(l.to).name)}</a></div>`).join(''):'<p class="hint" style="padding-top:20px">暂时没有直接关联。</p>'}</div></section>`;}
function graphPage(){return `${heading('关联图谱','从哪里注册，又通向哪里。一张图，理清账号之间的关系。',btn(`${icon('link')} 添加关联`,'new-link','primary'),'FOLLOW THE CONNECTIONS')}${graphPanel(state.graphFocus)}<div class="graph-explainer"><div class="panel explanation">${icon('graph')}<div><h3>从来源，看到完整链路</h3><p>邮箱 → Apple → Notion。注册关系与第三方登录可以串联，<br>聚焦一个账号，同时查看它的上游来源和下游服务。</p></div></div><div class="panel explanation">${icon('tag')}<div><h3>关系可以由你定义</h3><p>邮箱注册、Apple 登录、GitHub 登录，也可以自定义关联方式。<br>同一个账号可以有多个来源，不限制账号类型。</p></div></div></div>`;}
function subscriptionsPage(){const list=A.subscriptions.filter(s=>state.subStatus==='all'||(state.subStatus==='upcoming'?A.renewal(s)?.days<=7:s.status===state.subStatus));return `${heading('订阅管理','记下每次开通、续费与暂停，掌握你的使用节奏。',btn(`${icon('plus')} 新增订阅`,'new-sub','primary'),'MAKE EVERY SUBSCRIPTION COUNT')}${stats()}${renewalBanner()}<div class="sub-filter">${[['all','全部订阅'],['订阅中','订阅中'],['试用中','试用中'],['已暂停','已暂停'],['已取消','已取消'],['已到期','已到期'],['被封禁','被封禁'],['upcoming','即将续费']].map(([s,label])=>`<button class="filter-chip ${state.subStatus===s?'active':''}" data-action="sub-status" data-status="${s}" aria-pressed="${state.subStatus===s}">${label}</button>`).join('')}</div><div class="subscription-grid">${list.map(s=>{const a=A.get(s.account),r=A.renewal(s);return `<article class="panel subscription-card"><div class="identity">${serviceIcon(a)}<div><span class="identity-name">${esc(a.name)}</span><span class="identity-caption">${esc(a.identifier)}</span></div><span class="subscription-state ${r?'':'paused'}" style="margin-left:auto">${esc(s.status)}</span></div><div class="plan-line"><strong>${esc(s.plan)}</strong><small>${s.cycle==='monthly'?'月度订阅':s.cycle==='yearly'?'年度订阅':'自定义订阅'}</small></div><dl><dt>累计使用</dt><dd>${s.duration} 天</dd><dt>首次开通</dt><dd>${dateText(s.start)}</dd><dt>续费规则</dt><dd>${renewalRule(s)}</dd></dl><div class="card-bottom"><span class="${r&&r.days<=7?'due':'muted'}">${r?renewalText(r):'提醒已暂停'}</span><a class="text-button" href="#account/${a.id}/subscriptions">订阅详情 ${icon('arrow')}</a></div></article>`;}).join('')}</div>${!list.length?empty('没有这个状态的订阅','选择其他状态，或为账号添加一项订阅。','new-sub','新增订阅'):''}<p class="hint" style="margin-top:22px">预览基准日：2026.11.03。时长为示例值；续费提醒按日历计算，不自动确认付款。</p>`;}
function recordsPage(){const events=A.events.filter(e=>(state.recordKind==='all'||e.kind===state.recordKind)&&(state.recordAccount==='all'||e.account===state.recordAccount));return `${heading('操作记录','从第一次注册开始，为账号的每次变化留下记录。',btn(`${icon('plus')} 记录操作`,'new-event','primary'),'A TIMELINE OF YOUR DIGITAL LIFE')}<div class="records-layout"><section class="panel"><div class="panel-heading"><h2>所有动态 <span class="muted">${events.length}</span></h2><span class="kicker">最新记录在前</span></div>${timeline(events,true)}</section><aside><section class="panel records-filter"><h3>筛选记录</h3><div class="field"><label for="record-account-filter">所属账号</label><select id="record-account-filter"><option value="all">全部账号</option>${A.accounts.map(a=>`<option value="${a.id}" ${state.recordAccount===a.id?'selected':''}>${esc(a.name)}</option>`).join('')}</select></div><div class="field"><label for="record-kind-filter">记录类型</label><select id="record-kind-filter">${['all','账号记录','关联变更','订阅变更'].map(k=>`<option value="${k}" ${state.recordKind===k?'selected':''}>${k==='all'?'全部类型':k}</option>`).join('')}</select></div><p class="hint">按操作发生的时间排列，<br>也可以补录过去的经历。</p></section><div class="hint-box"><h3>让变化有迹可循</h3><p class="hint">每次订阅变更都留下一份信息快照。更正旧记录时，其他记录保持原样。</p></div></aside></div>`;}
function render(){
  const focused=document.activeElement, focusId=focused?.id, cursor=focused?.selectionStart;
  const r=route();nav();destroyGraphs();
  $('#main').innerHTML=r.page==='account'?detailPage(r.id,r.tab):r.page==='graph'?graphPage():r.page==='subscriptions'?subscriptionsPage():r.page==='records'?recordsPage():accountsPage();
  mountGraphs();
  if(focusId){const input=document.getElementById(focusId);if(input){input.focus({preventScroll:true});if(cursor!=null&&input.type==='search')input.setSelectionRange(cursor,cursor);}}
}
let toastTimer;
function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,3200);}
function localNow(){const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
function field(label,name,value='',options={}){return `<div class="field"><label for="field-${name}">${label}${options.required?' <span class="muted">*</span>':''}</label>${options.textarea?`<textarea id="field-${name}" name="${name}" rows="3" maxlength="1000" ${options.required?'required':''} placeholder="${esc(options.placeholder||'')}">${esc(value)}</textarea>`:`<input id="field-${name}" name="${name}" value="${esc(value)}" type="${options.type||'text'}" ${options.required?'required':''} ${options.type==='number'?`min="${options.min||1}" max="${options.max||31}" step="1"`:'maxlength="150"'} ${options.type==='datetime-local'?`max="${localNow()}"`:''} placeholder="${esc(options.placeholder||'')}">`}${options.help?`<small>${options.help}</small>`:''}</div>`;}
function selectField(label,name,items,value,required=false){return `<div class="field"><label for="field-${name}">${label}${required?' <span class="muted">*</span>':''}</label><select id="field-${name}" name="${name}" ${required?'required':''}>${items.map(item=>{const [v,l]=Array.isArray(item)?item:[item,item];return `<option value="${esc(v)}" ${value===v?'selected':''}>${esc(l)}</option>`;}).join('')}</select></div>`;}
const accountOptions = () => A.accounts.map(a=>[a.id,`${a.name} · ${a.identifier}`]);
function tagPicker(selected=[]){
  return `<fieldset class="field tag-picker"><legend>自定义标签</legend><div class="tag-options">${A.tags.map(t=>`<label class="tag-option" style="${tagStyle(t.color)}"><input type="checkbox" name="selectedTags" value="${esc(t.name)}" ${selected.includes(t.name)?'checked':''}><span><i class="tag-dot" aria-hidden="true"></i>${esc(t.name)}${icon('check')}</span></label>`).join('')}</div><small>点击选择已有标签，可多选；再次点击取消。</small><label class="new-tag-label" for="field-tags">新建标签 <span class="muted">（选填）</span></label><input id="field-tags" name="tags" maxlength="150" placeholder="输入新标签，多个用逗号分隔"><small>新标签会在保存账号时创建并选中。</small></fieldset>`;
}
let modalContext;
function openModal(kind,id){
  const r=route();id=id||((r.page==='account')?r.id:undefined);modalContext={kind,id};
  let title='',content='',submit='保存';const a=A.get(id);
  if(kind==='new-account'||kind==='edit-account'){
    const edit=kind==='edit-account';title=edit?'编辑账号':'新增账号';submit=edit?'保存修改':'加入账号库';
    content=`<p class="modal-description">记录一个数字身份。邮箱、用户名、手机号或其他账号标识都可以。</p><div class="form-grid">${field('服务 / 平台名称','name',a?.name||'',{required:true,placeholder:'例如 GitHub、Apple 或自定义名称'})}${field('账号类型','type',a?.type||'',{required:true,placeholder:'例如邮箱、游戏平台'})}</div>${field('账号标识','identifier',a?.identifier||'',{required:true,placeholder:'用户名、邮箱、手机号或自定义标识',help:'只记录标识，不设置密码字段。'})}<div class="form-grid">${field('创建日期','created',a?.created||'2026-11-03',{required:true,type:'date'})}${selectField('账号状态','status',['正常','已归档'],a?.status||'正常')}</div>${tagPicker(a?.tags||[])}${field('备注','notes',a?.notes||'',{textarea:true,placeholder:'这个账号的用途、需要记住的事情…'})}${!edit?`<div class="form-divider"><h3>关联已有账号 <span class="muted">（选填）</span></h3>${selectField('注册 / 登录来源','source',[['','暂不关联'],...accountOptions()],'')} ${field('关联方式','relation','邮箱注册',{placeholder:'邮箱注册、Apple 登录，或自定义关系'})}</div>`:''}`;
  }else if(kind==='new-link'){
    title='建立账号关联';submit='保存关联';content=`<p class="modal-description">从来源账号，指向使用它注册或登录的账号。<br>例如：Gmail → Apple → Notion。</p>${selectField('来源账号','from',accountOptions(),a?.id||'gmail',true)}${selectField('目标账号','to',accountOptions(),a?.id==='apple'?'notion':'apple',true)}${field('关联方式','relation','邮箱注册',{required:true,placeholder:'邮箱注册、Apple 登录、备用邮箱…'})}<div class="help-callout">一个账号可以关联多个来源，完整链路将在账号详情与关联图谱中展示。</div>`;
  }else if(kind==='new-event'||kind==='edit-event'){
    const e=kind==='edit-event'?A.events.find(e=>e.id===id):null;title=e?'更正操作记录':'记录一次操作';submit=e?'保存更正':'保存记录';
    content=`<p class="modal-description">${e?'更正当前记录，其他记录不受影响。':'记下已经发生的变化，也可以补录历史。'}</p>${selectField('所属账号','account',accountOptions(),e?.account||a?.id||A.accounts[0].id,true)}<div class="form-grid">${selectField('记录类型','kind',['账号记录','关联变更','订阅变更'],e?.kind||'账号记录')}${field('操作时间','date',e?.date||localNow(),{type:'datetime-local',required:true})}</div>${field('做了什么','title',e?.title||'',{required:true,placeholder:'例如：更换用户名、续费 Pro、暂停订阅'})}${field('详细记录','text',e?.text||'',{textarea:true,placeholder:'补充这次操作的原因、结果或使用体验…'})}${e?.snapshot?field('当时的订阅信息','snapshot',e.snapshot):''}<p class="hint">记录是文字档案。调整账号关联或订阅状态，请使用对应的编辑入口。</p>`;
  }else if(kind==='new-sub'||kind==='edit-sub'){
    const s=kind==='edit-sub'?A.subscriptions.find(s=>s.id===id):null;title=s?'记录订阅变更':'新增订阅';submit=s?'保存变更记录':'添加订阅';
    const choices=s?accountOptions().filter(x=>x[0]===s.account):accountOptions().filter(x=>!A.subscriptions.some(s=>s.account===x[0]));
    content=`<p class="modal-description">${s?'续费、升级、暂停或取消，保存后会生成一条操作记录。':'将订阅归到对应账号，状态与续费日期一目了然。'}</p>${selectField('所属账号','account',choices,s?.account||a?.id||choices[0]?.[0],true)}<div class="form-grid">${field('订阅等级','plan',s?.plan||'',{required:true,placeholder:'例如 Plus、Pro、Premium'})}${selectField('节点后的状态','status',['订阅中','试用中','已暂停','已取消','已到期','被封禁'],s?.status||'订阅中')}</div>${s?'':field('首次开通日期','start','2026-11-03',{type:'date',required:true})}${selectField('续费提醒','cycle',[['none','不设置'],['monthly','按月'],['yearly','按年']],s?.cycle||'monthly')}<div class="form-grid" id="renewal-fields">${field('每年几月','month',s?.month||11,{type:'number',max:12})}${field('几号续费','day',s?.day||5,{type:'number',max:31})}</div>${field('这次做了什么','action',s?'调整订阅信息':'开通订阅',{required:true})}<p class="hint">订阅和试用状态显示提醒。短月自动取月末；请自行确认付款。</p>`;
  }else if(kind==='new-tag'){
    title='新建自定义标签';submit='创建标签';content=`${field('标签名称','name','',{required:true,placeholder:'例如学习、副业、家庭'})}<div class="field"><label for="field-color">标签颜色</label><label class="color-control" for="field-color"><input id="field-color" name="color" type="color" value="#6b9c87" aria-describedby="color-help"><span>选择颜色<output id="color-value" for="field-color">#6B9C87</output></span></label><small id="color-help">点击色块打开颜色选择器，自由选择你喜欢的颜色。</small></div><p class="hint">创建后可在新增或编辑账号时使用，左侧点击标签即可筛选。</p>`;
  }else{
    title='欢迎来到归屿';submit='开始体验';content='<p class="modal-description">这是账号管理的本地页面原型，所有数据均为示例。</p><ol class="help-list"><li>在账号库中搜索，或组合多个自定义标签。</li><li>点击账号查看速览，再进入详情查看完整链路。</li><li>试试新增账号、建立关联和记录订阅变更。</li><li>在订阅页查看续费提醒，在记录页回顾操作。</li></ol><div class="help-callout">新增和修改只在本次预览有效，刷新后恢复示例。页面没有密码字段，也不会连接真实账号或进行付款。</div>';
  }
  $('#modal-title').textContent=title;$('#modal-content').innerHTML=content;$('#modal-submit').textContent=submit;$('#form-error').hidden=true;
  updateRenewalFields();$('#modal').showModal();
}
function updateRenewalFields(){const cycle=$('#field-cycle');if(!cycle)return;const fields=$('#renewal-fields');fields.hidden=cycle.value==='none';$('#field-month').closest('.field').hidden=cycle.value!=='yearly';$('#field-month').disabled=cycle.value!=='yearly';$('#field-day').disabled=cycle.value==='none';$('#field-day').required=cycle.value!=='none';$('#field-month').required=cycle.value==='yearly';}
function ensureTags(names){names.forEach(name=>{if(!A.tags.some(t=>t.name===name))A.tags.push({name,color:'#6b9c87'});});}
function addEvent(account,title,text,kind='账号记录',snapshot){A.events.push({id:crypto.randomUUID(),account,title,text,kind,snapshot,date:localNow()});}
function saveModal(form){
  const data=new FormData(form),d=Object.fromEntries(data);for(const k in d)d[k]=d[k].trim();const {kind,id}=modalContext;let target;
  if(kind==='new-account'||kind==='edit-account'){
    if(!d.name||!d.identifier||!d.type)return '请填写服务名称、账号标识和类型。';
    if(A.accounts.some(a=>a.id!==id&&a.name.toLowerCase()===d.name.toLowerCase()&&a.identifier.toLowerCase()===d.identifier.toLowerCase()))return '这个服务下的账号标识已经存在。';
    if(d.source&&!d.relation)return '请填写关联方式。';
    const tags=[...new Set([...data.getAll('selectedTags'),...d.tags.split(/[,，]/)].map(t=>t.trim()).filter(Boolean))];ensureTags(tags);
    const values={name:d.name,identifier:d.identifier,type:d.type,created:d.created,status:d.status,notes:d.notes,tags};
    if(kind==='edit-account'){Object.assign(A.get(id),values);addEvent(id,'更新账号信息','更新账号标识、标签或备注。');}
    else{const newId=crypto.randomUUID();A.accounts.unshift({id:newId,mark:d.name.slice(0,1).toUpperCase(),brand:'',...values});if(d.source)A.links.push({from:d.source,to:newId,type:d.relation});addEvent(newId,'加入账号档案',d.source?`通过 ${A.get(d.source).name} 建立「${d.relation}」关联。`:'记录账号基本信息。');state.tags=[];state.query='';state.status='all';state.selected=newId;target=`#account/${newId}/overview`;}
  }else if(kind==='new-link'){
    const error=A.validateLink(d.from,d.to,d.relation);if(error)return error;
    A.links.push({from:d.from,to:d.to,type:d.relation});addEvent(d.to,'建立账号关联',`${A.get(d.from).name} → ${A.get(d.to).name} · ${d.relation}`,'关联变更');
  }else if(kind==='new-event'||kind==='edit-event'){
    if(!d.title||!d.date)return '请填写操作标题和时间。';
    const date=new Date(d.date);if(!Number.isFinite(date.getTime())||date>new Date())return '请选择已经发生的操作时间。';
    if(!A.get(d.account))return '请选择有效账号。';
    const data={account:d.account,date:d.date,title:d.title,text:d.text,kind:d.kind};if(d.snapshot!==undefined)data.snapshot=d.snapshot;
    if(kind==='edit-event')Object.assign(A.events.find(e=>e.id===id),data);else A.events.push({id:crypto.randomUUID(),...data});
  }else if(kind==='new-sub'||kind==='edit-sub'){
    if(!d.plan||!d.action||!A.get(d.account))return '请填写账号、订阅等级与操作说明。';
    const month=Number(d.month||1),day=Number(d.day||1);
    if(d.cycle==='yearly'&&day>new Date(2024,month,0).getDate())return '请填写有效的年度续费月日。';
    const s={account:d.account,plan:d.plan,status:d.status,cycle:d.cycle,month,day};
    if(kind==='edit-sub')Object.assign(A.subscriptions.find(s=>s.id===id),s);
    else {if(A.subscriptions.some(s=>s.account===d.account))return '这个账号已有订阅，请在详情中记录变更。';A.subscriptions.push({id:crypto.randomUUID(),...s,start:d.start,duration:0});}
    // shortcut: durations are fixture values in this design prototype; calculate from dated snapshots when implementing storage.
    addEvent(d.account,d.action,'订阅信息已更新。','订阅变更',`${d.status} · ${d.plan} · ${renewalRule(s)}`);
  }else if(kind==='new-tag'){
    if(!d.name)return '请填写标签名称。';if(/[,，]/.test(d.name))return '一个标签不能包含逗号，请分别创建。';if(A.tags.some(t=>t.name===d.name))return '这个标签已经存在。';
    if(!/^#[0-9a-f]{6}$/i.test(d.color))return '请选择有效的标签颜色。';
    A.tags.push({name:d.name,color:d.color.toLowerCase()});
  }
  $('#modal').close();if(target&&location.hash!==target)location.hash=target;else render();toast(kind==='help'?'从一个账号开始探索吧':'已保存到本次预览');return '';
}
document.addEventListener('click',async e=>{
  const el=e.target.closest('[data-action]');if(!el)return;const action=el.dataset.action,id=el.dataset.id;
  if(['new-account','edit-account','new-link','new-event','edit-event','new-sub','edit-sub','new-tag','help'].includes(action))return openModal(action,id);
  if(action==='close-modal')return $('#modal').close();
  if(action==='select-account'){state.selected=id;render();return;}
  if(action==='view-account'){location.hash=`#account/${id}/overview`;return;}
  if(action==='account-status')state.status=el.dataset.status;
  if(action==='filter-tag')state.tags=state.tags.includes(el.dataset.tag)?state.tags.filter(t=>t!==el.dataset.tag):[...state.tags,el.dataset.tag];
  if(action==='side-tag'){state.tags=[el.dataset.tag];state.query='';state.status='all';if(route().page!=='accounts'){location.hash='#accounts';return;}}
  if(action==='clear-tags')state.tags=[];
  if(action==='reset-filters'){state.tags=[];state.query='';state.status='all';}
  if(action==='sub-status')state.subStatus=el.dataset.status;
  if(action==='go-accounts'){location.hash='#accounts';return;}
  if(action==='copy'){
    try{await navigator.clipboard.writeText(A.get(id).identifier);toast('账号标识已复制');}catch{toast('浏览器未开放剪贴板权限，请手动选择并复制标识。');}return;
  }
  render();
});
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('.account-row')){e.preventDefault();e.target.click();}});
document.addEventListener('input',e=>{if(e.target.id==='account-search'){state.query=e.target.value;render();}if(e.target.id==='field-color')$('#color-value').textContent=e.target.value.toUpperCase();});
document.addEventListener('change',e=>{
  if(e.target.id==='field-cycle'){updateRenewalFields();return;}
  const key={'graph-focus':'graphFocus','record-account-filter':'recordAccount','record-kind-filter':'recordKind'}[e.target.id];if(key){state[key]=e.target.value;render();}
});
$('#modal-form').addEventListener('submit',e=>{e.preventDefault();const error=saveModal(e.currentTarget);if(error){$('#form-error').textContent=error;$('#form-error').hidden=false;}});
window.addEventListener('hashchange',()=>{render();window.scrollTo(0,0);});
document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
render();
