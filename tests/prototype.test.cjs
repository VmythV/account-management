const assert = require('node:assert/strict');
const A = require('../dist/data.js');

assert.equal(A.matching('DEMO-BUILDS').length, 2, '用户名检索不区分大小写');
assert.deepEqual(A.matching('', ['工作','开发']).map(a=>a.id), ['github','cursor'], '多标签使用交集');
assert.equal(A.matching('', [], '已归档')[0].id, 'nintendo');
assert.equal(A.matching('不存在的账号').length, 0);
assert.deepEqual([...A.related('notion','up')], ['notion','apple','gmail'], '追溯多层登录来源');
assert.equal(A.related('gmail','down').size, 10, '包括直接与间接下游');
assert.equal(A.validateLink('apple','apple','登录'), '账号不能关联到自身。');
assert.equal(A.validateLink('gmail','apple','邮箱注册'), '这条关联已经存在。');
assert.equal(A.validateLink('missing','apple','登录'), '请选择已存在的账号。');
assert.equal(A.validateLink('outlook','apple','备用邮箱'), '');
A.links.push({from:'notion',to:'gmail',type:'备用关联'});
assert.equal(A.related('gmail','down').size, 10, '环形关系不会无限遍历');
A.links.pop();

const monthly = {status:'订阅中',cycle:'monthly',day:31};
assert.equal(A.renewal(monthly,new Date(2026,1,27)).date.getDate(),28, '短月取月末');
assert.equal(A.renewal(monthly,new Date(2026,1,28)).days,0, '到期当天仍显示当天');
assert.equal(A.renewal(monthly,new Date(2026,2,1)).date.getDate(),31, '下一月恢复原始日期');
assert.equal(A.renewal({...monthly,status:'已暂停'}),null, '暂停不显示提醒');
const leap={status:'试用中',cycle:'yearly',month:2,day:29};
assert.equal(A.renewal(leap,new Date(2027,1,1)).date.getDate(),28);
assert.equal(A.renewal(leap,new Date(2028,1,1)).date.getDate(),29);
assert.equal(A.subscriptions.filter(s=>A.renewal(s)?.days<=7).length,3);
assert.ok(A.accounts.every(a=>!Object.keys(a).some(k=>/password|secret/i.test(k))), '示例账号不包含密码字段');
console.log('通过：搜索、标签交集、状态筛选、多层与环形关联、关联校验、续费边界。');

// Exercise the buildless page renderer and form handlers without requiring a browser dependency.
const vm = require('node:vm');
const fs = require('node:fs');
const elements = Object.fromEntries(['main','navigation','sidebar-tags','breadcrumb-current','toast','modal','modal-form','modal-title','modal-content','modal-submit','form-error'].map(id=>[id,{innerHTML:'',textContent:'',addEventListener(){},showModal(){},close(){}}]));
const context = vm.createContext({
  document:{activeElement:null,querySelector:s=>elements[s.slice(1)]||null,querySelectorAll:()=>[],addEventListener(){}},
  location:{hash:'#accounts'}, window:{addEventListener(){},scrollTo(){}},
  crypto:require('node:crypto').webcrypto, setTimeout:()=>0,clearTimeout(){},
  FormData:class {
    constructor(values){this.entries=Object.entries(values).flatMap(([key,value])=>[].concat(value).map(v=>[key,v]));}
    [Symbol.iterator](){return this.entries[Symbol.iterator]();}
    getAll(name){return this.entries.filter(([key])=>key===name).map(([,value])=>value);}
  }
});
vm.runInContext(fs.readFileSync(require.resolve('../dist/data.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(require.resolve('../dist/graphs.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(require.resolve('../dist/app.js'),'utf8'),context);
for(const [hash,expected] of [
  ['#accounts','关联速览'],['#graph','查看 Notion 账号'],['#subscriptions','iCloud+'],['#records','操作时间线'],
  ['#account/apple/overview','账号信息'],['#account/apple/links','直接关联明细'],
  ['#account/gmail/records','注册 Gmail'],['#account/chatgpt/subscriptions','当前订阅']
]){
  context.location.hash=hash;vm.runInContext('render()',context);
  assert.ok(elements.main.innerHTML.includes(expected==="操作时间线"?'所有动态':expected),`页面渲染：${hash}`);
}
vm.runInContext("state.query='not-found'; location.hash='#accounts'; render()",context);
assert.ok(elements.main.innerHTML.includes('没有找到匹配的账号'));
vm.runInContext("openModal('new-account')",context);
assert.ok(!/type="password"/.test(elements['modal-content'].innerHTML));
assert.ok(elements['modal-content'].innerHTML.includes('name="selectedTags" value="工作"'), '新增账号可以选择已有标签');
vm.runInContext(`saveModal({name:'Example <service>',identifier:'user-name',type:'自定义',created:'2026-11-03',status:'正常',notes:'test',selectedTags:['个人','工作'],tags:'新标签，工作',source:'apple',relation:'Apple 登录'})`,context);
assert.ok(context.location.hash.startsWith('#account/'));
vm.runInContext('render()',context);
assert.ok(elements.main.innerHTML.includes('Example &lt;service&gt;'),'自定义名称作为文本渲染');
assert.ok(elements.main.innerHTML.includes('新标签'),'创建标签并应用到账号');
assert.ok(elements.main.innerHTML.includes('Apple 登录'),'新账号建立关联');
assert.equal(vm.runInContext("A.accounts.length",context),13);
assert.equal(vm.runInContext("A.links.length",context),11);
assert.equal(vm.runInContext("A.accounts[0].tags.join(',')",context),'个人,工作,新标签','合并多选与新标签并去重');
vm.runInContext("openModal('edit-account',A.accounts[0].id)",context);
assert.ok(elements['modal-content'].innerHTML.includes('value="个人" checked'), '编辑时回显已选标签');
assert.ok(elements['modal-content'].innerHTML.includes('value="新标签" checked'), '新标签也可以再次选择');
vm.runInContext(`saveModal({name:'Example <service>',identifier:'user-name',type:'自定义',created:'2026-11-03',status:'正常',notes:'test',selectedTags:['工作'],tags:''})`,context);
assert.equal(vm.runInContext("A.accounts[0].tags.join(',')",context),'工作','取消选择后移除对应标签');
vm.runInContext("openModal('edit-account',A.accounts[0].id)",context);
vm.runInContext(`saveModal({name:'Example <service>',identifier:'user-name',type:'自定义',created:'2026-11-03',status:'正常',notes:'test',tags:''})`,context);
assert.equal(vm.runInContext("A.accounts[0].tags.length",context),0,'允许清空账号标签');
vm.runInContext("openModal('new-link')",context);
assert.equal(vm.runInContext("saveModal({from:'apple',to:'apple',relation:'登录'})",context),'账号不能关联到自身。');
vm.runInContext("openModal('edit-sub','sub-chatgpt'); saveModal({account:'chatgpt',plan:'Plus',status:'已暂停',cycle:'monthly',day:'5',action:'暂停订阅'})",context);
assert.equal(vm.runInContext("A.renewal(A.subscriptions[0])",context),null);
assert.equal(vm.runInContext("A.events.at(-1).snapshot",context),'已暂停 · Plus · 每月 5 日');
console.log('通过：所有页面渲染、空状态、新增任意账号与标签、文本转义、添加关联、订阅变更记录。');

vm.runInContext("openModal('new-tag'); saveModal({name:'任意颜色',color:'#187EE5'})",context);
assert.equal(vm.runInContext("A.tags.at(-1).color",context),'#187ee5','保存预设之外的完整颜色值');
assert.ok(elements['sidebar-tags'].innerHTML.includes('--tag-color:#187ee5'),'侧边栏使用自选颜色');
vm.runInContext("location.hash='#accounts'; render()",context);
assert.ok(elements.main.innerHTML.includes('--tag-color:#187ee5'),'筛选项使用自选颜色');
assert.ok(vm.runInContext("tagHTML('任意颜色')",context).includes('--tag-color:#187ee5'),'账号标签使用自选颜色');
assert.ok(vm.runInContext("tagPicker(['任意颜色'])",context).includes('--tag-color:#187ee5'),'标签多选项使用自选颜色');
vm.runInContext("openModal('new-tag')",context);
assert.equal(vm.runInContext("saveModal({name:'无效颜色',color:'#fff;display:none'})",context),'请选择有效的标签颜色。');
assert.ok(!vm.runInContext("tagStyle('#fff;display:none')",context).includes('display:none'),'非法颜色不能注入样式');
assert.ok(vm.runInContext("tagStyle('#ffffff')",context).includes('#ffffff'),'支持纯白');
assert.ok(vm.runInContext("tagStyle('#000000')",context).includes('#000000'),'支持纯黑');
console.log('通过：任意颜色保存、各标签入口颜色一致、非法颜色校验。');

const cytoscape=require('../dist/vendor/cytoscape.min.js');
cytoscape.use(require('../dist/vendor/cytoscape-dagre.js'));
const diagram=(focus,mode='full')=>{
  const elements=JSON.parse(vm.runInContext(`JSON.stringify(graphElements(${JSON.stringify(focus)},${JSON.stringify(mode)}))`,context));
  return cytoscape({headless:true,styleEnabled:true,elements,style:[{selector:'node',style:{width:176,height:46}}]});
};
const layout=(cy,compact)=>cy.layout(vm.runInContext(`graphLayout(${compact})`,context)).run();
let cy=diagram('github','preview');layout(cy,true);
assert.deepEqual(cy.nodes().map(n=>n.id()).sort(),['cursor','github','gmail'],'速览同时保留上游和下游');
const [mail,hub,cursor]=['gmail','github','cursor'].map(id=>cy.getElementById(id).position());
assert.equal(mail.x,hub.x,'单条关联自动居中对齐');
assert.equal(hub.x,cursor.x,'下游与当前账号对齐');
assert.ok(mail.y<hub.y&&hub.y<cursor.y,'箭头从上游向下游排列');
cy.destroy();
cy=diagram('all');layout(cy,false);
const positions=cy.nodes().map(n=>n.position());
assert.ok(positions.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
for(let i=0;i<positions.length;i++)for(let j=i+1;j<positions.length;j++){
  assert.ok(Math.abs(positions[i].x-positions[j].x)>=176||Math.abs(positions[i].y-positions[j].y)>=46,'节点边框不重叠');
}
cy.add({data:{id:'test-cycle',source:'cursor',target:'gmail'}});layout(cy,false);
assert.ok(cy.nodes().every(n=>Number.isFinite(n.position().x)),'环形关系可以完成布局');
cy.destroy();
assert.ok(vm.runInContext("graphData('gmail','preview').omitted",context)>0,'速览明确提示未展开的关联');
console.log('通过：真实 Cytoscape + Dagre 布局、单链居中、来源去向、节点无重叠、环形关系。');
