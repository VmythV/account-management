import { Archive as A, api, reload } from './data.js';
import { $, esc, icon, tagStyle, localDateTime, toast } from './ui.js';
import { STATUSES } from './timeline.js';
import { mountSelects, destroySelects } from './selects.js';

let context, busy=false, sensitiveTimer;
const nowLocal=()=>localDateTime(new Date());
const codeField=()=>field('验证器验证码','code','',{required:true,maxLength:6,code:true,placeholder:'6 位动态验证码'});
const isCurrent=value=>context===value&&$('#modal').open&&!document.hidden;
const passkeyPending=()=>context?.kind==='bind-passkey'||context?.kind==='reveal-password';
function cancelPasskey(){
  window.SimpleWebAuthnBrowser?.WebAuthnAbortService.cancelCeremony();
  api('/api/security/passkey/challenge','DELETE',{}).catch(()=>{});
}
async function systemVerify(method,optionsJSON){
  try{return await window.SimpleWebAuthnBrowser[method]({optionsJSON});}
  catch{throw new Error(method==='startAuthentication'?'系统验证未完成。可以重试，或选择下方的“使用 2FA 验证码”。':'通行密钥绑定未完成。请检查系统设置后，使用新的 2FA 验证码重试。');}
}
function revealFields(current){
  const a=A.get(current.id);
  return `<p class="modal-description">${esc(a.name)} · ${esc(a.identifier)}</p>${current.usePasskey?`<div class="passkey-prompt">${icon('shield')}<h3>使用 Touch ID / 系统验证</h3><p>点击下方按钮，按照系统提示完成验证。</p><button type="button" class="text-button" data-use-totp>使用 2FA 验证码</button></div>`:codeField()}<p class="hint">每次查看都要重新验证；查看后 30 秒自动隐藏。${current.usePasskey?'系统可能允许设备密码或其他通行密钥方式。':'同一个验证码只能使用一次。'}</p>`;
}

function field(label,name,value='',options={}){
  const common=`id="field-${name}" name="${name}" ${options.required?'required':''} ${options.disabled?'disabled':''}`;
  const input=options.textarea?`<textarea ${common} rows="3" maxlength="5000">${esc(value)}</textarea>`:`<input ${common} value="${esc(value)}" type="${options.type||'text'}" maxlength="${options.maxLength||150}" ${options.type==='password'?`autocomplete="${options.autocomplete||'new-password'}"`:''} ${options.code?'inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code"':''} ${options.type==='number'?`min="1" max="${options.max||31}" step="1"`:''} ${options.type==='datetime-local'?`max="${nowLocal()}" step="1"`:''} placeholder="${esc(options.placeholder||'')}">`;
  const control=name==='password'&&options.type==='password'?`<div class="password-input">${input}<button type="button" class="password-toggle" data-password-toggle aria-controls="field-password" aria-pressed="false" aria-label="显示正在填写的密码" ${options.disabled?'disabled':''}>显示</button></div>`:input;
  return `<div class="field"><label for="field-${name}">${label}${options.required?' *':''}</label>${control}${options.help?`<small>${options.help}</small>`:''}</div>`;
}
function selectField(label,name,items,value,disabled=false){return `<div class="field"><label for="field-${name}">${label}</label><select id="field-${name}" name="${name}" ${disabled?'disabled':''} ${['account','source','from','to'].includes(name)?'data-search':''}>${items.map(item=>{const[v,l]=Array.isArray(item)?item:[item,item];return `<option value="${esc(v)}" ${v===value?'selected':''}>${esc(l)}</option>`;}).join('')}</select></div>`;}
const accountOptions=()=>A.accounts.map(a=>[a.id,`${a.name} · ${a.identifier}`]);
function tagsField(selected=[]){
  return `<fieldset class="field tag-picker"><legend>自定义标签</legend><div class="tag-options">${A.tags.map(t=>`<label class="tag-option" style="${tagStyle(t.color)}"><input type="checkbox" name="tagIds" value="${t.id}" ${selected.includes(t.id)?'checked':''}><span><i class="tag-dot" aria-hidden="true"></i>${esc(t.name)}${icon('check')}</span></label>`).join('')||'<small>还没有标签，可以在下面新建。</small>'}</div><small>可选择多个已有标签，再次点击取消。</small><div class="field new-tags-field"><label for="field-newTags">新建标签（选填）</label><select id="field-newTags" class="tag-entry" name="newTags" multiple data-tags></select><small id="new-tags-help">输入后按回车添加，点击 × 移除。保存账号时一起创建。</small></div></fieldset>`;
}
function colorField(color){return `<div class="field"><label for="field-color">标签颜色</label><label class="color-control" for="field-color"><input id="field-color" name="color" type="color" value="${esc(color)}"><span>选择颜色<output id="color-value" for="field-color">${esc(color.toUpperCase())}</output></span></label><small>点击色块打开颜色选择器，自由选择颜色。</small></div>`;}
function subscriptionFields(s,event){
  return `${field('操作时间','occurredAt',event?localDateTime(event.occurredAt):nowLocal(),{type:'datetime-local',required:true})}<div class="form-grid">${field('订阅等级','plan',event?.plan||'',{required:true,placeholder:'例如 Plus、Pro、200 GB'})}${selectField('节点后的状态','status',Object.entries(STATUSES),event?.status||'active')}</div>${selectField('续费提醒','renewalCycle',[['none','不设置'],['monthly','按月'],['yearly','按年']],event?.renewalCycle||'none')}<div class="form-grid" id="renewal-fields">${field('每年几月','renewalMonth',event?.renewalMonth||new Date().getMonth()+1,{type:'number',max:12})}${field('几号续费','renewalDay',event?.renewalDay||new Date().getDate(),{type:'number'})}</div>${field('这次做了什么','action',context.kind==='edit-sub-event'?event.action:s?'调整订阅信息':'开通订阅',{required:true})}${field('备注','notes',event?.notes||'',{textarea:true})}<p class="hint">每条记录保存完整状态。补录历史时请核对当时的等级、状态和续费日期；时间最晚的节点决定当前状态。</p>`;
}
export function openModal(kind,id){
  if(busy)return;
  const route=location.hash.slice(1).split('/'),accountId=route[0]==='account'?route[1]:undefined;
  if(!A.accounts.length&&['new-link','new-event','new-sub'].includes(kind)){toast('请先添加一个账号。');kind='new-account';id=undefined;}
  if(kind==='new-link'&&A.accounts.length<2){toast('至少需要两个账号才能建立关联。');return;}
  context={kind,id};let title='',content='',submit='保存';
  if(kind==='new-account'||kind==='edit-account'){
    const a=kind==='edit-account'?A.get(id):null;context.record=a;
    title=a?'编辑账号':'新增账号';
    content=`<p class="modal-description">邮箱、用户名、手机号或任意账号标识都可以。</p><div class="form-grid">${field('服务 / 平台名称','name',a?.name||'',{required:true})}${field('账号类型','type',a?.type||'',{required:true,placeholder:'邮箱、游戏平台、自定义类型…'})}</div>${field('账号标识','identifier',a?.identifier||'',{required:true,maxLength:300})}${field(a?.hasPassword?'更换密码（选填）':'密码（选填）','password','',{type:'password',maxLength:4096,disabled:!A.security?.twoFactorEnabled,placeholder:a?.hasPassword?'留空保留原密码':'可以不填写',help:A.security?.twoFactorEnabled?(a?.hasPassword?'留空保留原密码。':''):'请先到安全设置绑定验证器，之后即可保存密码。'})}${a?.hasPassword?'<label class="password-remove"><input type="checkbox" name="removePassword" value="yes"> 移除已保存的密码</label>':''}${field('网站（选填）','website',a?.website||'',{type:'url',maxLength:2048,placeholder:'https://example.com'})}<div class="form-grid">${field('注册日期（未知可留空）','created',a?.created||'',{type:'date'})}${selectField('账号状态','status',['正常','已归档'],a?.status||'正常')}</div>${tagsField(a?.tagIds||[])}${field('备注','notes',a?.notes||'',{textarea:true})}${a?'':`<div class="form-divider"><h3>关联已有账号（选填）</h3>${selectField('注册 / 登录来源','source',[['','暂不关联'],...accountOptions()],'')}${field('关联方式','relation','邮箱注册')}</div>`}`;
  }else if(kind==='delete-account'){
    const a=A.get(id);if(!a){toast('账号不存在，请刷新数据。');return;}context.record=a;
    title='删除账号';submit='确认删除';
    content=`<p class="modal-description">${esc(a.name)} · ${esc(a.identifier)}</p><p>确定永久删除这个账号？</p><ul class="help-list"><li>删除已保存的密码、订阅及其历史、账号操作记录。</li><li>解除与其他账号的关联；其他账号及自定义标签保留。</li></ul><p class="danger">此操作无法撤销。</p>`;
  }else if(kind==='bind-totp'){
    title='绑定验证器';submit='继续绑定';
    content=`<p class="modal-description">先验证管理工具访问密码，再用验证器 App 扫码绑定。所有账号共用这个验证器。</p>${field('管理工具访问密码','accessPassword','',{type:'password',required:true,maxLength:256,autocomplete:'current-password'})}<p class="hint">不提供恢复码。验证器丢失后，只能通过服务器重置。</p>`;
  }else if(kind==='bind-passkey'||kind==='remove-passkey'){
    title=kind==='remove-passkey'?'移除通行密钥':A.security?.passkeyEnabled?'更换通行密钥':'绑定通行密钥';submit=kind==='remove-passkey'?'验证并移除':'验证并绑定';
    content=`<p class="modal-description">${kind==='remove-passkey'?'移除后仍可通过 2FA 验证码查看密码。':'验证访问密码和 2FA 后，由系统创建通行密钥。更换成功后，旧通行密钥失效。'}</p>${field('管理工具访问密码','accessPassword','',{type:'password',required:true,maxLength:256,autocomplete:'current-password'})}${codeField()}<p class="hint">绑定或移除都会消耗本次验证码。系统可能使用 Touch ID 或设备密码。</p>`;
  }else if(kind==='reveal-password'){
    context.usePasskey=!!A.security?.passkeyEnabled&&!!window.SimpleWebAuthnBrowser?.browserSupportsWebAuthn();
    title='验证后查看密码';submit=context.usePasskey?'Touch ID / 系统验证':'验证并查看';content=revealFields(context);

  }else if(kind==='new-link'||kind==='edit-link'){
    const r=kind==='edit-link'?A.links.find(r=>r.id===id):null;context.record=r;
    title=r?'修改账号关联':'建立账号关联';
    const source=r?.from||id||accountId||A.accounts[0]?.id;
    content=`<p class="modal-description">来源账号 → 使用它注册或登录的账号。</p>${selectField('来源账号','from',accountOptions(),source)}${selectField('目标账号','to',accountOptions(),r?.to||A.accounts.find(a=>a.id!==source)?.id)}${field('关联方式','type',r?.type||'邮箱注册',{required:true})}${field('关联备注','notes',r?.notes||'',{textarea:true})}<p class="hint">一个账号可以关联多个来源；解除关联后仍保留操作记录。</p>`;
  }else if(kind==='new-tag'||kind==='edit-tag'){
    const tag=kind==='edit-tag'?A.tags.find(t=>t.id===id):null;context.record=tag;
    title=tag?'编辑标签':'新建自定义标签';
    content=`${field('标签名称','name',tag?.name||'',{required:true,maxLength:50,placeholder:'例如学习、副业、家庭'})}${colorField(tag?.color||'#6b9c87')}<p class="hint">标签改名和改色会同步应用到所有已关联账号。</p>`;
  }else if(kind==='new-event'||kind==='edit-event'){
    const e=kind==='edit-event'?A.events.find(e=>e.id===id):null;
    if(e?.subscription)return openModal('edit-sub-event',e.id);
    if(e?.automatic){toast('自动记录保留原始操作，请通过对应功能修改数据。');return;}
    context.record=e;title=e?'更正操作记录':'记录一次操作';
    content=`${selectField('所属账号','account',accountOptions(),e?.account||id||accountId||A.accounts[0]?.id,!!e)}<div class="form-grid">${selectField('记录类型','kind',['账号记录','关联变更','订阅变更'],e?.kind||'账号记录')}${field('操作时间','date',e?localDateTime(e.date):nowLocal(),{type:'datetime-local',required:true})}</div>${field('做了什么','title',e?.title||'',{required:true})}${field('详细记录','text',e?.text||'',{textarea:true})}<p class="hint">手动记录是文字档案，不会改变账号关联和订阅状态。</p>`;
  }else if(kind==='rename-sub'){
    const s=A.subscriptions.find(s=>s.id===id);context.record=s;title='编辑订阅名称';
    content=field('订阅名称','name',s.name,{required:true});
  }else if(['new-sub','edit-sub','edit-sub-event'].includes(kind)){
    let s,event;
    if(kind==='edit-sub')s=A.subscriptions.find(s=>s.id===id);
    if(kind==='edit-sub-event'){s=A.subscriptions.find(s=>s.events.some(e=>e.id===id));event=s.events.find(e=>e.id===id);}
    context.record=s;context.event=event;
    title=event?'更正订阅记录':s?'记录订阅变更':'新增订阅';
    content=`${selectField('所属账号','account',accountOptions(),s?.account||id||accountId||A.accounts[0]?.id,!!s)}${s?`<div class="help-callout">${esc(s.name)} · ${event?'仅更正这个节点，其他快照保持不变。':'保存新的历史节点。'}</div>`:field('订阅名称','name','',{required:true,placeholder:'例如 iCloud+、Apple Music、ChatGPT Plus'})}${subscriptionFields(s,event||s?.current)}`;
    // New changes occur now, even though their state is prefilled from the current snapshot.
    if(kind==='edit-sub')content=content.replace(`value="${localDateTime(s.current.occurredAt)}"`,`value="${nowLocal()}"`);
  }else{
    title='使用归屿';submit='知道了';
    content='<ol class="help-list"><li>账号支持任意标识，通过标签组合筛选。</li><li>箭头从注册或登录来源指向目标账号。</li><li>每次订阅操作保存独立快照，可补录和更正历史。</li><li>保存的账号密码需通过系统验证或 2FA 查看。</li></ol><p class="hint">续费是页面日历提醒，不会自动付款。请勿在备注中填写账号密码或密钥。</p>';
  }
  destroySelects($('#modal-content'));
  clearTimeout(sensitiveTimer);$('#modal-submit').hidden=false;$('#modal-note').textContent=kind==='reveal-password'?'仅验证本次查看':'';$('#modal-cancel').textContent='取消';
  $('#modal-title').textContent=title;$('#modal-content').innerHTML=content;$('#modal-submit').textContent=submit;$('#form-error').hidden=true;
  $('#modal-submit').className=kind==='delete-account'?'button destructive':'button primary';
  updateRenewalFields();$('#modal').showModal();mountSelects($('#modal-content'));
  if(kind==='delete-account')$('#modal-cancel').focus();
}
function updateRenewalFields(){
  const cycle=$('#field-renewalCycle');if(!cycle)return;
  $('#renewal-fields').hidden=cycle.value==='none';
  for(const [name,enabled] of [['renewalMonth',cycle.value==='yearly'],['renewalDay',cycle.value!=='none']]){
    const el=$('#field-'+name);el.disabled=!enabled;el.required=enabled;el.closest('.field').hidden=!enabled;
  }
}
export async function afterMutation(detail={}){
  try{await reload();document.dispatchEvent(new CustomEvent('archive-change',{detail}));toast(detail.deletedAccount?'已删除账号':'已保存');}
  catch(error){toast('操作已完成，但重新读取失败。请点击“刷新数据”，不要重复提交。');}
}
async function save(form){
  const tags=$('#field-newTags')?.tomselect;
  if(tags?.inputValue())tags.createItem();
  const fd=new FormData(form),d=Object.fromEntries(fd);for(const key in d)if(typeof d[key]==='string'&&!['password','accessPassword'].includes(key))d[key]=d[key].trim();
  const {kind,id,record}=context;let path,method=id?'PUT':'POST',body;
  if(kind==='help'||kind==='password-visible'){$('#modal').close();return;}
  if(kind==='bind-totp'){
    const pending=await api('/api/security/totp/enrollment','POST',{password:d.accessPassword});
    if(!$('#modal').open||context?.kind!==kind)return;
    context.kind='confirm-totp';
    $('#modal-content').innerHTML=`<p class="modal-description">用验证器 App 扫描二维码，然后输入生成的验证码完成绑定。</p><div class="totp-enrollment"><img src="${esc(pending.qr)}" width="256" height="256" alt="验证器绑定二维码"><details><summary>无法扫码？手动输入密钥</summary><code>${esc(pending.secret)}</code></details></div>${field('验证器验证码','code','',{required:true,maxLength:6,code:true,placeholder:'6 位动态验证码'})}<p class="hint">绑定信息 10 分钟内有效。不要分享二维码或密钥。</p>`;
    $('#modal-submit').textContent='确认绑定';
    sensitiveTimer=setTimeout(()=>{if(context?.kind==='confirm-totp'){$('#modal').close();toast('绑定已过期，请重新开始。');}},Math.max(0,pending.expires-Date.now()));
    return;
  }
  if(kind==='confirm-totp'){
    await api('/api/security/totp/confirm','POST',{code:d.code});$('#modal').close();await afterMutation();return;
  }
  if(kind==='bind-passkey'||kind==='remove-passkey'){
    const current=context;
    if(kind==='remove-passkey')await api('/api/security/passkey','DELETE',{password:d.accessPassword,code:d.code});
    else {
      if(!window.SimpleWebAuthnBrowser?.browserSupportsWebAuthn())throw new Error('此浏览器不支持通行密钥，请使用支持的浏览器。');
      const optionsJSON=await api('/api/security/passkey/registration/options','POST',{password:d.accessPassword,code:d.code});
      if(!isCurrent(current)){cancelPasskey();return;}
      const response=await systemVerify('startRegistration',optionsJSON);
      if(!isCurrent(current))return;
      await api('/api/security/passkey/registration/verify','POST',{response});
    }
    if(isCurrent(current))$('#modal').close();await afterMutation();return;
  }
  if(kind==='reveal-password'){
    const current=context,method=current.usePasskey;let result;
    if(method){
      const optionsJSON=await api(`/api/accounts/${id}/password/passkey/options`,'POST',{});
      if(!isCurrent(current)||!current.usePasskey){cancelPasskey();return;}
      const response=await systemVerify('startAuthentication',optionsJSON);
      if(!isCurrent(current)||!current.usePasskey){cancelPasskey();return;}
      result=await api(`/api/accounts/${id}/password/passkey/verify`,'POST',{response});
    }else result=await api(`/api/accounts/${id}/password`,'POST',{code:d.code});
    if(!isCurrent(current)||current.usePasskey!==method){result.password='';return;}
    context.kind='password-visible';$('#modal-title').textContent='账号密码';
    $('#modal-content').innerHTML='<p class="hint">30 秒后自动隐藏；关闭窗口、离开页面或切换标签页也会立即隐藏。</p><pre id="revealed-password" class="revealed-password" tabindex="0" aria-label="账号密码"></pre>';
    $('#revealed-password').textContent=result.password;result.password='';
    $('#modal-submit').hidden=true;$('#modal-cancel').textContent='隐藏并关闭';$('#modal-note').textContent='再次查看需重新验证';
    sensitiveTimer=setTimeout(()=>{if(context?.kind==='password-visible')$('#modal').close();},30_000);
    return;
  }
  if(kind==='delete-account'){
    path='/api/accounts/'+id;method='DELETE';body={version:record.version};
  }else if(['new-account','edit-account'].includes(kind)){
    path='/api/accounts'+(record?'/'+id:'');method=record?'PUT':'POST';
    body={name:d.name,identifier:d.identifier,type:d.type,created:d.created,status:d.status,notes:d.notes,website:d.website,...(d.password?{password:d.password}:{}),...(d.removePassword==='yes'?{removePassword:true}:{}),tagIds:fd.getAll('tagIds'),newTags:fd.getAll('newTags'),...(record?{version:record.version}:{source:d.source,relation:d.relation})};
  }else if(['new-tag','edit-tag'].includes(kind)){path='/api/tags'+(record?'/'+id:'');method=record?'PUT':'POST';body={name:d.name,color:d.color,...(record?{version:record.version}:{})};}
  else if(['new-link','edit-link'].includes(kind)){path='/api/relations'+(record?'/'+id:'');method=record?'PUT':'POST';body={from:d.from,to:d.to,type:d.type,notes:d.notes,...(record?{version:record.version}:{})};}
  else if(['new-event','edit-event'].includes(kind)){
    path='/api/events'+(record?'/'+id:'');method=record?'PUT':'POST';
    body={account:record?.account||d.account,date:new Date(d.date).toISOString(),title:d.title,text:d.text,kind:d.kind,...(record?{version:record.version}:{})};
  }else if(kind==='rename-sub'){
    path='/api/subscriptions/'+id;method='PATCH';body={name:d.name,version:record.version};
  }else{
    body={occurredAt:new Date(d.occurredAt).toISOString(),action:d.action,status:d.status,plan:d.plan,notes:d.notes,renewalCycle:d.renewalCycle,renewalDay:d.renewalCycle==='none'?null:Number(d.renewalDay),renewalMonth:d.renewalCycle==='yearly'?Number(d.renewalMonth):null};
    if(kind==='new-sub'){path='/api/subscriptions';method='POST';Object.assign(body,{account:d.account,name:d.name});}
    else{path=`/api/subscriptions/${record.id}/events`+(context.event?'/'+id:'');method=context.event?'PUT':'POST';body.version=record.version;}
  }
  const result=await api(path,method,body);$('#modal').close();
  await afterMutation(kind==='new-account'?{newAccount:result.id}:kind==='delete-account'?{deletedAccount:id}:{});
}
export function bindForms(){
  document.addEventListener('change',e=>{if(e.target.id==='field-renewalCycle')updateRenewalFields();});
  document.addEventListener('input',e=>{if(e.target.id==='field-color')$('#color-value').textContent=e.target.value.toUpperCase();});
  document.addEventListener('click',e=>{
    const toggle=e.target.closest('[data-password-toggle]'),input=$('#field-password');
    if(toggle&&input&&!input.disabled){
      const visible=input.type==='password';input.type=visible?'text':'password';
      toggle.textContent=visible?'隐藏':'显示';
      toggle.setAttribute('aria-pressed',String(visible));
      toggle.setAttribute('aria-label',`${visible?'隐藏':'显示'}正在填写的密码`);
    }
    if(e.target.closest('[data-use-totp]')&&context?.kind==='reveal-password'){
      cancelPasskey();context.usePasskey=false;$('#modal-content').innerHTML=revealFields(context);$('#modal-submit').textContent='验证并查看';$('#form-error').hidden=true;
    }
    if(e.target.closest('[data-action="close-modal"]')&&(!busy||passkeyPending()))$('#modal').close();
  });
  $('#modal').addEventListener('cancel',e=>{if(busy&&!passkeyPending())e.preventDefault();});
  $('#modal').addEventListener('close',()=>{
    if(passkeyPending())cancelPasskey();
    clearTimeout(sensitiveTimer);destroySelects($('#modal-content'));$('#modal-content').innerHTML='';
    if(context?.kind==='confirm-totp')api('/api/security/totp/enrollment','DELETE',{}).catch(()=>{});
    context=null;
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&(context?.kind==='password-visible'||passkeyPending()))$('#modal').close();});
  window.addEventListener('pagehide',()=>$('#modal').close());
  window.addEventListener('hashchange',()=>$('#modal').close());
  $('#modal-form').addEventListener('submit',async e=>{
    e.preventDefault();if(busy)return;busy=true;$('#modal-submit').disabled=true;$('#form-error').hidden=true;
    const current=context,usePasskey=current?.usePasskey;
    try{await save(e.currentTarget);}
    catch(error){
      if(!isCurrent(current)||current.usePasskey!==usePasskey)return;
      $('#form-error').textContent=error.message;
      if(error.status===401)$('#form-error').innerHTML+=` <a class="text-button" href="/login?reauth=1" target="_blank" rel="noopener">在新标签页重新登录</a>，然后返回这里再次保存。`;
      $('#form-error').hidden=false;
    }
    finally{busy=false;$('#modal-submit').disabled=false;}
  });
}
