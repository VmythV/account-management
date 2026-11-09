import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { openStore } from '../lib/store.mjs';
import { TOTP } from 'otpauth';
import { createPasskeys } from '../lib/passkeys.mjs';
import { authenticator } from './helpers/authenticator.mjs';
import * as timeline from '../public/timeline.js';

function pageHarness(t){
  const store=openStore(':memory:');t.after(()=>store.close());
  const listeners={},elements={},timers=new Map(),windowListeners={};let timerId=0,pending;
  for(const id of ['main','navigation','sidebar-tags','breadcrumb-current','toast','modal','modal-form','modal-title','modal-content','modal-submit','form-error','reauth-link','modal-note','modal-cancel','revealed-password']){
    elements[id]={querySelectorAll:()=>[],innerHTML:'',textContent:'',hidden:true,open:false,addEventListener(type,fn){listeners[id+':'+type]=fn;},showModal(){this.open=true;},close(){this.open=false;listeners[id+':close']?.();}};
  }
  let offline=false,expired=false;
  const keys=createPasskeys(store.vault,()=>!expired),origin='https://accounts.example.com';
  const context=vm.createContext({modules:{timeline},console,Date,URL,Set,Map,JSON,setTimeout(fn,ms){timers.set(++timerId,{fn,ms});return timerId;},clearTimeout(id){timers.delete(id);},setInterval(){},
    location:{hash:'#accounts'},window:{addEventListener(type,fn){(windowListeners[type]??=[]).push(fn);},scrollTo(){}},
    document:{hidden:false,activeElement:null,querySelector:s=>elements[s.slice(1)]||null,querySelectorAll:()=>[],getElementById:id=>elements[id],addEventListener(type,fn){(listeners[type]??=[]).push(fn);},dispatchEvent(e){for(const fn of listeners[e.type]||[])fn(e);}},
    CustomEvent:class {constructor(type,{detail}){this.type=type;this.detail=detail;}},
    FormData:class{constructor(values){this.values=Object.entries(values).flatMap(([key,value])=>[].concat(value).map(v=>[key,v]));}[Symbol.iterator](){return this.values[Symbol.iterator]();}getAll(key){return this.values.filter(v=>v[0]===key).map(v=>v[1]);}},
    async fetch(path,opts={}){
      if(offline)throw new Error('offline');
      if(expired)return {ok:false,status:401,json:async()=>({error:'登录已过期'})};
      let result;
      try{
        const input=opts.body?JSON.parse(opts.body):{},parts=path.split('/'),resource=parts[2],id=parts[3];
        if(resource==='archive')result=store.archive();
        else if(resource==='security'){
          if(parts[3]==='passkey'){
            if(parts[4]==='challenge'){keys.cancel('session');result={ok:true};}
            else if(opts.method==='DELETE'){store.vault.verifyTotp(input.code);store.vault.removePasskey();result={ok:true};}
            else if(parts[5]==='options'){store.vault.verifyTotp(input.code);result=await keys.registrationOptions('session',origin);}
            else {await keys.register('session',origin,input.response);result={ok:true};}
          }
          else if(parts[4]==='confirm'){store.vault.confirmEnrollment(pending,input.code);result={ok:true};}
          else if(opts.method==='DELETE'){pending=null;result={ok:true};}
          else {pending=store.vault.beginEnrollment();result={secret:pending.secret,qr:'data:image/png;base64,TEST',expires:Date.now()+600000};}
        }
        else if(resource==='accounts'&&parts[5]==='passkey')result=parts[6]==='options'?await keys.authenticationOptions('session',origin,id):{password:await keys.reveal('session',origin,id,input.response)};
        else if(resource==='accounts')result=parts[4]==='password'?{password:store.vault.reveal(id,input.code)}:{id:store.saveAccount(input,id)};
        else if(resource==='tags')result={id:store.saveTag(input,id)};
        else if(resource==='relations')result={id:store.saveRelation(input,id)};
        else if(resource==='events')result={id:store.saveEvent(input,id)};
        else if(resource==='subscriptions')result={id:parts[4]==='events'?store.saveSubscriptionEvent(id,input,parts[5]):opts.method==='PATCH'?store.renameSubscription(id,input):store.createSubscription(input)};
        return {ok:true,json:async()=>JSON.parse(JSON.stringify(result))};
      }catch(error){return {ok:false,status:error.status,json:async()=>({error:error.message})};}
    },
  });
  function load(name,imports,exports){
    let source=readFileSync(new URL(`../public/${name}.js`,import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
    if(name==='app')source=source.replace(/start\(\);\s*$/,'');
    context.modules[name]=vm.runInContext(`(()=>{${imports}\n${source}\nreturn {${exports}};})()`,context);
  }
  load('ui','','$,icon,esc,serviceIcon,tagStyle,localDateTime,toast');
  load('data','const {nextRenewal,summarize,STATUSES,renewalRule}=modules.timeline;','Archive,api,reload');
  load('graphs','const {Archive:A}=modules.data;const {esc}=modules.ui;','graphData,graphMarkup,graphElements,graphLayout,destroyGraphs,mountGraphs');
  load('selects','','mountSelects,destroySelects');
  load('forms','const {Archive:A,api,reload}=modules.data;const {$,esc,icon,tagStyle,localDateTime,toast}=modules.ui;const {STATUSES}=modules.timeline;const {mountSelects,destroySelects}=modules.selects;','openModal,bindForms,afterMutation');
  load('app','const {Archive:A,api,reload}=modules.data;const {$,icon,esc,serviceIcon,tagStyle,localDateTime,toast}=modules.ui;const {graphData,graphMarkup,destroyGraphs,mountGraphs}=modules.graphs;const {openModal,bindForms,afterMutation}=modules.forms;const {formatDuration}=modules.timeline;const {mountSelects,destroySelects}=modules.selects;','render,state');
  return {store,keys,origin,context,elements,runTimer(ms){for(const [id,timer] of timers)if(timer.ms===ms){timers.delete(id);timer.fn();}},windowEvent(type){for(const fn of windowListeners[type]||[])fn();},modules:context.modules,offline(value){offline=value;},expired(value){expired=value;},async submit(values){await listeners['modal-form:submit']({preventDefault(){},currentTarget:values});},async clickElement(selector,element){for(const fn of listeners.click||[])await fn({target:{closest:s=>s===selector?element:null}});},async click(action,id){const button={dataset:{action,id}};for(const fn of listeners.click||[])await fn({target:{closest:selector=>selector==='[data-action]'?button:null}});}};
}

test('账号库右侧进入指定账号详情并可编辑；网站表单保存、回填、链接转义与清空',async t=>{
  const h=pageHarness(t),{modules:m,elements:e}=h;
  const first=h.store.saveAccount({name:'第一个账号',identifier:'one',type:'平台',status:'正常'});
  const id=h.store.saveAccount({name:'测试账号',identifier:'two',type:'平台',status:'正常'});
  await m.data.reload();m.app.state.selected=first;m.app.render();
  assert.ok(e.main.innerHTML.includes(`data-action="view-account" data-id="${id}"`));
  await h.click('view-account',id);
  assert.equal(h.context.location.hash,`#account/${id}/overview`);
  assert.equal(e.modal.open,false,'查看详情不能打开编辑弹窗');
  assert.equal(m.app.state.selected,first,'点击详情不能触发行预览');
  m.app.render();assert.match(e.main.innerHTML,/账号信息/);
  assert.equal(e['breadcrumb-current'].textContent,'账号库 / 测试账号');
  assert.ok(e.main.innerHTML.includes(`data-action="edit-account" data-id="${id}"`));
  await h.click('edit-account',id);
  assert.equal(e.modal.open,true);assert.equal(e['modal-title'].textContent,'编辑账号');
  assert.equal(m.app.state.selected,first,'点击编辑不能触发行预览');
  assert.match(e['modal-content'].innerHTML,/name="website"[^>]*type="url"/);
  const values={name:'测试账号',identifier:'two',type:'平台',created:'',status:'正常',notes:'',website:'https://example.com/login?a=1&b=2',tagIds:[],newTags:[]};
  await h.submit(values);assert.equal(m.data.Archive.get(id).website,values.website);
  await h.click('edit-account',id);assert.match(e['modal-content'].innerHTML,/https:\/\/example.com\/login\?a=1&amp;b=2/);
  e.modal.close();h.context.location.hash='#accounts';m.app.state.selected=id;m.app.render();
  assert.match(e.main.innerHTML,/访问网站/);
  h.context.location.hash=`#account/${id}/overview`;m.app.render();
  assert.match(e.main.innerHTML,/href="https:\/\/example.com\/login\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer"/);
  await h.click('edit-account',id);await h.submit({...values,website:'javascript:alert(1)'});
  assert.equal(e.modal.open,true);assert.match(e['form-error'].textContent,/网站地址/);
  await h.submit({...values,website:''});
  assert.equal(m.data.Archive.get(id).website,'');assert.doesNotMatch(e.main.innerHTML,/class="website-link"/);
});

test('绑定页面与密码表单；每次打开重新验证，超时、关闭和切走清除密码',async t=>{
  const original=Date.now;let now=1_800_000_000_000;Date.now=()=>now;t.after(()=>{Date.now=original;});
  const h=pageHarness(t),{modules:m,elements:e}=h;
  await m.data.reload();h.context.location.hash='#security';m.app.render();
  assert.match(e.main.innerHTML,/绑定验证器/);
  await h.click('bind-totp');await h.submit({accessPassword:'test-access-password'});
  const secret=e['modal-content'].innerHTML.match(/<code>([A-Z2-7]+)<\/code>/)[1],otp=new TOTP({secret});
  assert.match(e['modal-content'].innerHTML,/data:image\/png/);
  await h.submit({code:otp.generate({timestamp:now})});
  assert.equal(e.modal.open,false);assert.equal(e['modal-content'].innerHTML,'');
  assert.equal(m.data.Archive.security.twoFactorEnabled,true);
  m.forms.openModal('new-account');
  assert.doesNotMatch(e['modal-content'].innerHTML,/name="password"[^>]*disabled/);
  const password='  <script>secret</script>  ';
  await h.submit({name:'加密账号',identifier:'user',type:'平台',created:'',status:'正常',notes:'',password,tagIds:[],newTags:[]});
  const id=m.data.Archive.accounts[0].id;
  assert.equal(m.data.Archive.accounts[0].hasPassword,true);
  assert.equal(e.main.innerHTML.includes(password),false);
  await h.click('edit-account',id);assert.equal(e['modal-content'].innerHTML.includes(password),false);e.modal.close();
  now+=30000;await h.click('reveal-password',id);
  await h.submit({code:'bad'});assert.equal(e.modal.open,true);assert.match(e['form-error'].textContent,/6 位/);
  await h.submit({code:otp.generate({timestamp:now})});
  assert.equal(e['revealed-password'].textContent,password,'密码保留空格，使用 textContent 显示');
  assert.equal(e['modal-submit'].hidden,true);h.runTimer(30000);
  assert.equal(e.modal.open,false);assert.equal(e['modal-content'].innerHTML,'');
  await h.click('reveal-password',id);assert.match(e['modal-content'].innerHTML,/name="code"/);
  assert.equal(e['modal-content'].innerHTML.includes(password),false);
  await h.submit({code:otp.generate({timestamp:now})});assert.match(e['form-error'].textContent,/已经使用/);
  now+=30000;await h.submit({code:otp.generate({timestamp:now})});
  h.context.document.hidden=true;h.context.document.dispatchEvent({type:'visibilitychange'});
  assert.equal(e.modal.open,false);assert.equal(e['modal-content'].innerHTML,'');
  h.context.document.hidden=false;now+=30000;await h.click('reveal-password',id);await h.submit({code:otp.generate({timestamp:now})});
  h.windowEvent('hashchange');assert.equal(e['modal-content'].innerHTML,'');
});

test('新增和编辑账号可显示、隐藏当前输入；不请求已保存密码或提交表单，重新打开默认隐藏',async t=>{
  const h=pageHarness(t),{modules:m,elements:e}=h;
  await m.data.reload();m.forms.openModal('new-account');
  assert.match(e['modal-content'].innerHTML,/<button[^>]*data-password-toggle[^>]*disabled>显示<\/button>/);
  e.modal.close();
  const pending=h.store.vault.beginEnrollment();
  h.store.vault.confirmEnrollment(pending,new TOTP({secret:pending.secret}).generate());
  const stored='stored-password-must-not-appear';
  const id=h.store.saveAccount({name:'测试账号',identifier:'demo',type:'平台',status:'正常',password:stored});
  await m.data.reload();let networkCalls=0;
  h.context.fetch=()=>{networkCalls++;throw new Error('不应请求服务器');};
  for(const kind of ['new-account','edit-account']){
    m.forms.openModal(kind,kind==='edit-account'?id:undefined);
    const html=e['modal-content'].innerHTML;
    assert.match(html,/name="password"[^>]*value="" type="password"/);
    assert.match(html,/<button type="button"[^>]*data-password-toggle[^>]*aria-pressed="false"/);
    assert.equal(html.includes(stored),false);
    const typed='  newly-typed-密码<&>  ';
    const input=e['field-password']={type:'password',value:typed,disabled:false};
    const toggle={textContent:'显示',attributes:{},setAttribute(name,value){this.attributes[name]=value;}};
    await h.clickElement('[data-password-toggle]',toggle);
    assert.equal(input.type,'text');assert.equal(input.value,typed);
    assert.equal(toggle.textContent,'隐藏');assert.equal(toggle.attributes['aria-pressed'],'true');
    assert.equal(toggle.attributes['aria-label'],'隐藏正在填写的密码');
    await h.clickElement('[data-password-toggle]',toggle);
    assert.equal(input.type,'password');assert.equal(input.value,typed);
    assert.equal(toggle.textContent,'显示');assert.equal(toggle.attributes['aria-pressed'],'false');
    input.disabled=true;await h.clickElement('[data-password-toggle]',toggle);
    assert.equal(input.type,'password');assert.equal(e.modal.open,true);
    e.modal.close();m.forms.openModal(kind,kind==='edit-account'?id:undefined);
    assert.match(e['modal-content'].innerHTML,/name="password"[^>]*value="" type="password"/);
    assert.match(e['modal-content'].innerHTML,/aria-pressed="false"/);e.modal.close();
  }
  assert.equal(networkCalls,0);assert.equal(h.store.archive().accounts[0].version,1);
});

test('空库页面、任意账号、多选标签、保存失败保留表单及输入；页面转义',async t=>{
  const h=pageHarness(t),{modules:m,elements:e}=h;
  await m.data.reload();
  for(const route of ['accounts','tags','graph','subscriptions','records']){h.context.location.hash='#'+route;m.app.render();assert.ok(e.main.innerHTML.length>100);}
  m.forms.openModal('new-account');assert.ok(e['modal-content'].innerHTML.includes('未知可留空'));assert.match(e['modal-content'].innerHTML,/name="password"[^>]*disabled/);
  const values={name:'<script>Test</script>',identifier:'arbitrary-user',type:'平台',created:'',status:'正常',notes:'备注',newTags:['个人','工作'],source:'',relation:'邮箱注册'};
  const formHTML=e['modal-content'].innerHTML;h.offline(true);await h.submit(values);
  assert.equal(e.modal.open,true);assert.equal(e['modal-content'].innerHTML,formHTML);assert.match(e['form-error'].textContent,/连接失败/);
  h.offline(false);h.expired(true);await h.submit(values);assert.equal(e.modal.open,true);assert.match(e['form-error'].innerHTML,/target="_blank"/);
  h.expired(false);await h.submit(values);assert.equal(e.modal.open,false);
  const a=m.data.Archive.accounts[0];assert.equal(a.tags.length,2);assert.equal(a.created,'');
  assert.match(e.main.innerHTML,/&lt;script&gt;Test&lt;\/script&gt;/);assert.ok(!e.main.innerHTML.includes('<script>Test'));
  m.forms.openModal('edit-account',a.id);assert.match(e['modal-content'].innerHTML,/type="checkbox"[^>]+checked/);
  await h.submit({...values,newTags:[],tagIds:[a.tagIds[0]]});assert.equal(m.data.Archive.accounts[0].tagIds.length,1);
  m.forms.openModal('new-tag');await h.submit({name:'自由色',color:'#1234AB'});assert.equal(m.data.Archive.tags.find(t=>t.name==='自由色').color,'#1234ab');
  h.context.location.hash='#accounts';m.app.render();assert.match(e.main.innerHTML,/--tag-color:#1234ab/);assert.match(e.main.innerHTML,/<button class="identity account-select"/);
});

test('筛选重绘恢复焦点时不会重新展开下拉菜单',t=>{
  const h=pageHarness(t),settings={openOnFocus:true};let opened=false,focused=false;
  const input={id:'filter-control',dataset:{selectId:'filter'},focus(){focused=true;opened=settings.openOnFocus;}};
  h.elements['filter-control']=input;h.elements.filter={tomselect:{settings}};
  h.context.document.activeElement=input;h.context.location.hash='#records';
  h.modules.app.render();
  assert.equal(focused,true);assert.equal(opened,false);assert.equal(settings.openOnFocus,true);
});

test('动态标签保存数组、复用已有同名标签；清空后不残留新标签',async t=>{
  const h=pageHarness(t),m=h.modules;
  const tag=h.store.saveTag({name:'工作',color:'#123456'});await m.data.reload();
  const values={name:'标签测试',identifier:'tag-test',type:'平台',created:'',status:'正常',notes:'',tagIds:[tag],newTags:['工作','学习','学习','<标签>'],source:'',relation:'邮箱注册'};
  m.forms.openModal('new-account');
  assert.match(h.elements['modal-content'].innerHTML,/<select[^>]+name="newTags"[^>]+multiple data-tags/);
  await h.submit(values);
  const a=m.data.Archive.accounts[0];assert.deepEqual(Array.from(a.tags).sort(),['<标签>','学习','工作'].sort());
  assert.equal(m.data.Archive.tags.find(t=>t.name==='工作').color,'#123456');
  assert.match(h.elements.main.innerHTML,/&lt;标签&gt;/);
  m.forms.openModal('edit-account',a.id);
  await h.submit({...values,newTags:[]});
  assert.deepEqual(Array.from(m.data.Archive.get(a.id).tags),['工作']);
  m.forms.openModal('new-account');await h.submit({...values,identifier:'no-tags',tagIds:[],newTags:[]});
  assert.equal(m.data.Archive.accounts.find(a=>a.identifier==='no-tags').tags.length,0);
});

test('多订阅表单、变更与历史更正接入快照；标签改名和订阅名编辑',async t=>{
  const h=pageHarness(t),m=h.modules,e=h.elements;
  const account=h.store.saveAccount({name:'Apple',identifier:'user',type:'账号',status:'正常',newTags:[]});await m.data.reload();
  h.context.location.hash=`#account/${account}/subscriptions`;
  const values={account,name:'Storage',occurredAt:'2025-01-01T12:00:00',plan:'200 GB',status:'active',renewalCycle:'none',action:'开通',notes:''};
  m.forms.openModal('new-sub',account);await h.submit(values);
  m.forms.openModal('new-sub',account);await h.submit({...values,name:'Music'});
  assert.equal(m.data.Archive.subscriptions.length,2);assert.match(e.main.innerHTML,/Storage/);assert.match(e.main.innerHTML,/Music/);
  const sub=m.data.Archive.subscriptions.find(s=>s.name==='Storage');
  m.forms.openModal('edit-sub',sub.id);await h.submit({...values,status:'paused',occurredAt:'2025-01-11T12:00:00',action:'暂停'});
  const paused=m.data.Archive.subscriptions.find(s=>s.id===sub.id);assert.equal(paused.status,'已暂停');assert.equal(paused.activeMs,10*86400000);
  m.forms.openModal('edit-sub-event',paused.current.id);await h.submit({...values,status:'paused',occurredAt:'2025-01-10T12:00:00',action:'修正'});
  assert.equal(m.data.Archive.subscriptions.find(s=>s.id===sub.id).activeMs,9*86400000);
  m.forms.openModal('rename-sub',sub.id);await h.submit({name:'iCloud+'});assert.match(e.main.innerHTML,/iCloud\+/);
});

test('正式组件在多来源和循环关系中布局；关联表单与账号链路',async t=>{
  const h=pageHarness(t),m=h.modules;
  const a=h.store.saveAccount({name:'邮箱',identifier:'mail',type:'邮箱',status:'正常'}),b=h.store.saveAccount({name:'Apple',identifier:'user',type:'账号',status:'正常'}),c=h.store.saveAccount({name:'Notion',identifier:'user',type:'账号',status:'正常'});
  await m.data.reload();
  for(const[from,to,type]of[[a,b,'邮箱注册'],[b,c,'Apple 登录'],[c,a,'恢复账号']]){m.forms.openModal('new-link',from);await h.submit({from,to,type,notes:''});}
  assert.equal(m.data.Archive.related(a,'down').size,3);
  const require=createRequire(import.meta.url),cytoscape=require('../public/vendor/cytoscape.min.js');cytoscape.use(require('../public/vendor/cytoscape-dagre.js'));
  const cy=cytoscape({headless:true,styleEnabled:true,elements:JSON.parse(JSON.stringify(m.graphs.graphElements('all'))),style:[{selector:'node',style:{width:176,height:58}}]});
  cy.layout(JSON.parse(JSON.stringify(m.graphs.graphLayout(false)))).run();assert.equal(cy.nodes().length,3);
  assert.ok(cy.nodes().every(n=>Number.isFinite(n.position().x)));cy.destroy();
  h.context.location.hash=`#account/${b}/links`;m.app.render();assert.match(h.elements.main.innerHTML,/编辑关联/);assert.match(h.elements.main.innerHTML,/解除关联/);
});


test('默认系统验证；每次重新验证、取消后 2FA 备用、关闭弹窗丢弃迟到的验证',async t=>{
  const oldNow=Date.now;let now=1_800_000_000_000;Date.now=()=>now;t.after(()=>{Date.now=oldNow;});
  const h=pageHarness(t),{modules:m,elements:e}=h,device=authenticator();
  const pending=h.store.vault.beginEnrollment(),otp=new TOTP({secret:pending.secret}),code=()=>otp.generate({timestamp:now});
  h.store.vault.confirmEnrollment(pending,code());now+=30000;
  let assertions=0,cancelled=0;
  h.context.window.SimpleWebAuthnBrowser={browserSupportsWebAuthn:()=>true,WebAuthnAbortService:{cancelCeremony(){cancelled++;}},
    startRegistration:async({optionsJSON})=>device.register(optionsJSON,h.origin),
    startAuthentication:async({optionsJSON})=>{assertions++;return device.authenticate(optionsJSON,h.origin);}};
  await m.data.reload();m.forms.bindForms();m.forms.openModal('bind-passkey');await h.submit({accessPassword:'test-access-password',code:code()});
  assert.equal(e.modal.open,false);assert.equal(m.data.Archive.security.passkeyEnabled,true);
  const id=h.store.saveAccount({name:'Site',identifier:'me',type:'平台',status:'正常',password:'frontend-passkey-secret'});await m.data.reload();
  m.forms.openModal('reveal-password',id);assert.equal(e['modal-submit'].textContent,'Touch ID / 系统验证');assert.match(e['modal-content'].innerHTML,/data-use-totp/);assert.doesNotMatch(e['modal-content'].innerHTML,/name="code"/);
  await h.submit({});assert.equal(e['revealed-password'].textContent,'frontend-passkey-secret');h.runTimer(30000);assert.equal(e.modal.open,false);
  m.forms.openModal('reveal-password',id);await h.submit({});assert.equal(assertions,2);e.modal.close();
  h.context.window.SimpleWebAuthnBrowser.startAuthentication=async()=>{throw new Error('NotAllowedError');};
  m.forms.openModal('reveal-password',id);await h.submit({});assert.match(e['form-error'].textContent,/2FA/);
  await h.clickElement('[data-use-totp]',{});assert.match(e['modal-content'].innerHTML,/name="code"/);assert.equal(e['form-error'].hidden,true);
  now+=30000;await h.submit({code:code()});assert.equal(e['revealed-password'].textContent,'frontend-passkey-secret');e.modal.close();
  let finish,started;const ready=new Promise(resolve=>{started=resolve;});
  h.context.window.SimpleWebAuthnBrowser.startAuthentication=({optionsJSON})=>new Promise(resolve=>{finish=()=>resolve(device.authenticate(optionsJSON,h.origin));started();});
  m.forms.openModal('reveal-password',id);const submitting=h.submit({});await ready;e.modal.close();finish();await submitting;
  assert.equal(e['modal-content'].innerHTML,'');assert.equal(e['form-error'].hidden,true);assert.ok(cancelled>0);
  h.context.window.SimpleWebAuthnBrowser.browserSupportsWebAuthn=()=>false;
  m.forms.openModal('reveal-password',id);assert.equal(e['modal-submit'].textContent,'验证并查看');assert.match(e['modal-content'].innerHTML,/name="code"/);
});
