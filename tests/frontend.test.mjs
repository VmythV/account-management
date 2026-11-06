import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { openStore } from '../lib/store.mjs';
import * as timeline from '../public/timeline.js';

function pageHarness(t){
  const store=openStore(':memory:');t.after(()=>store.close());
  const listeners={},elements={};
  for(const id of ['main','navigation','sidebar-tags','breadcrumb-current','toast','modal','modal-form','modal-title','modal-content','modal-submit','form-error','reauth-link']){
    elements[id]={querySelectorAll:()=>[],innerHTML:'',textContent:'',hidden:true,open:false,addEventListener(type,fn){listeners[id+':'+type]=fn;},showModal(){this.open=true;},close(){this.open=false;}};
  }
  let offline=false,expired=false;
  const context=vm.createContext({modules:{timeline},console,Date,URL,Set,Map,JSON,setTimeout:()=>0,clearTimeout(){},setInterval(){},
    location:{hash:'#accounts'},window:{addEventListener(){},scrollTo(){}},
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
        else if(resource==='accounts')result={id:store.saveAccount(input,id)};
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
  return {store,context,elements,modules:context.modules,offline(value){offline=value;},expired(value){expired=value;},async submit(values){await listeners['modal-form:submit']({preventDefault(){},currentTarget:values});},async click(action,id){const button={dataset:{action,id}};for(const fn of listeners.click||[])await fn({target:{closest:selector=>selector==='[data-action]'?button:null}});}};
}

test('账号库右侧直接编辑指定账号；网站表单保存、回填、链接转义与清空',async t=>{
  const h=pageHarness(t),{modules:m,elements:e}=h;
  const first=h.store.saveAccount({name:'第一个账号',identifier:'one',type:'平台',status:'正常'});
  const id=h.store.saveAccount({name:'测试账号',identifier:'two',type:'平台',status:'正常'});
  await m.data.reload();m.app.state.selected=first;m.app.render();
  assert.ok(e.main.innerHTML.includes(`data-action="edit-account" data-id="${id}"`));
  await h.click('edit-account',id);
  assert.equal(e.modal.open,true);assert.equal(e['modal-title'].textContent,'编辑账号');
  assert.equal(m.app.state.selected,first,'点击编辑不能触发行预览');
  assert.match(e['modal-content'].innerHTML,/name="website"[^>]*type="url"/);
  const values={name:'测试账号',identifier:'two',type:'平台',created:'',status:'正常',notes:'',website:'https://example.com/login?a=1&b=2',tagIds:[],newTags:[]};
  await h.submit(values);assert.equal(m.data.Archive.get(id).website,values.website);
  await h.click('edit-account',id);assert.match(e['modal-content'].innerHTML,/https:\/\/example.com\/login\?a=1&amp;b=2/);
  e.modal.close();m.app.state.selected=id;m.app.render();
  assert.match(e.main.innerHTML,/访问网站/);
  h.context.location.hash=`#account/${id}/overview`;m.app.render();
  assert.match(e.main.innerHTML,/href="https:\/\/example.com\/login\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer"/);
  await h.click('edit-account',id);await h.submit({...values,website:'javascript:alert(1)'});
  assert.equal(e.modal.open,true);assert.match(e['form-error'].textContent,/网站地址/);
  await h.submit({...values,website:''});
  assert.equal(m.data.Archive.get(id).website,'');assert.doesNotMatch(e.main.innerHTML,/class="website-link"/);
});

test('空库页面、任意账号、多选标签、保存失败保留表单及输入；页面转义',async t=>{
  const h=pageHarness(t),{modules:m,elements:e}=h;
  await m.data.reload();
  for(const route of ['accounts','tags','graph','subscriptions','records']){h.context.location.hash='#'+route;m.app.render();assert.ok(e.main.innerHTML.length>100);}
  m.forms.openModal('new-account');assert.ok(e['modal-content'].innerHTML.includes('未知可留空'));assert.ok(!e['modal-content'].innerHTML.includes('type="password"'));
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
