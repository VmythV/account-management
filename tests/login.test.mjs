import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

async function loginPage({initialized=true,enabled=true,supported=true,reauth=false}={}){
  const elements={},listeners={},events={},calls=[];
  for(const id of ['password','confirm','confirm-field','login-form','login-passkey','login-success','login-description','login-title','login-submit','passkey-login','login-error'])elements[id]={value:'',hidden:true,textContent:'',focus(){this.focused=true;},addEventListener(type,fn){listeners[id+':'+type]=fn;}};
  let authenticate=async()=>({signed:true}),postResult=()=>({ok:true}),cancellations=0;
  const context=vm.createContext({URLSearchParams,
    document:{querySelector:selector=>elements[selector.slice(1)]},
    location:{search:reauth?'?reauth=1':'',replace(url){this.redirect=url;}},
    window:{SimpleWebAuthnBrowser:supported?{browserSupportsWebAuthn:()=>true,startAuthentication:options=>authenticate(options),WebAuthnAbortService:{cancelCeremony(){cancellations++;}}}:undefined,addEventListener(type,fn){events[type]=fn;}},
    fetch:async(path,options)=>{calls.push({path,options});return {ok:true,json:async()=>options?postResult(path,JSON.parse(options.body)):{initialized,authenticated:false,passkeyEnabled:enabled}};},
  });
  const source=readFileSync(new URL('../public/login.js',import.meta.url),'utf8').replace(/load\(\);\s*$/,'');
  await vm.runInContext(source+'\nload();',context);
  return {elements,calls,context,get cancellations(){return cancellations;},system(fn){authenticate=fn;},response(fn){postResult=fn;},click:()=>listeners['passkey-login:click'](),submit:()=>listeners['login-form:submit']({preventDefault(){}}),leave:()=>events.pagehide()};
}

test('登录页显示两种方式且不自动触发系统验证；未绑定、不支持或首次设置时保留密码入口',async()=>{
  const h=await loginPage(),e=h.elements;
  assert.equal(e['login-passkey'].hidden,false);assert.equal(e['login-form'].hidden,false);assert.equal(e['passkey-login'].focused,true);assert.equal(e['login-submit'].className,'button wide');
  assert.deepEqual(h.calls.map(c=>c.path),['/api/session']);
  for(const options of [{enabled:false},{supported:false},{initialized:false}]){
    const page=await loginPage(options),el=page.elements;assert.equal(el['login-passkey'].hidden,true);assert.equal(el['login-form'].hidden,false);assert.equal(el.password.focused,true);
    el.password.value='test-password';el.confirm.value='test-password';await page.submit();
    assert.equal(page.calls.at(-1).path,options.initialized===false?'/api/setup':'/api/login');
    const body=JSON.parse(page.calls.at(-1).options.body);assert.equal(body.password,'test-password');assert.equal(body.confirm,options.initialized===false?'test-password':undefined);
    assert.equal(page.context.location.redirect,'/');
  }
});

test('点击通行密钥后才请求挑战，验证成功登录；重新登录显示完成提示，离开页面取消未完成验证',async()=>{
  const h=await loginPage({reauth:true}),e=h.elements;
  let resolve;h.system(async({optionsJSON})=>{assert.equal(optionsJSON.challenge,'test');return new Promise(r=>{resolve=r;});});
  h.response(path=>path.endsWith('/options')?{challenge:'test'}:{ok:true});
  const pending=h.click();await new Promise(r=>setImmediate(r));
  assert.equal(e['passkey-login'].disabled,true);assert.equal(e['login-submit'].disabled,true);
  await h.click();await h.submit();assert.equal(h.calls.filter(c=>c.path.endsWith('/options')).length,1);
  resolve({signed:true});await pending;
  assert.deepEqual(h.calls.map(c=>c.path),['/api/session','/api/login/passkey/options','/api/login/passkey/verify']);
  assert.equal(h.calls.at(-1).options.headers['X-Requested-With'],'account-archive');
  assert.deepEqual(JSON.parse(h.calls.at(-1).options.body),{response:{signed:true}});
  assert.equal(e['login-success'].hidden,false);assert.equal(e['login-form'].hidden,true);assert.equal(e['login-passkey'].hidden,true);assert.equal(h.context.location.redirect,undefined);
  const other=await loginPage();let finish;
  other.system(()=>new Promise(r=>{finish=r;}));const inFlight=other.click();await new Promise(r=>setImmediate(r));other.leave();finish({signed:true});await inFlight;
  assert.equal(other.cancellations,1);assert.equal(other.calls.some(c=>c.path.endsWith('/verify')),false);assert.equal(other.context.location.redirect,undefined);
});

test('系统取消与验证失败不登录，保留密码并可改用密码登录；密码不正确时保留表单',async()=>{
  const h=await loginPage(),e=h.elements;e.password.value='typed-password';
  h.system(()=>{throw new Error('cancelled');});await h.click();
  assert.match(e['login-error'].textContent,/系统验证未完成/);assert.equal(e['login-error'].hidden,false);assert.equal(e.password.value,'typed-password');assert.equal(h.context.location.redirect,undefined);
  h.system(async()=>({signed:true}));h.response(path=>{if(path.endsWith('/verify'))throw new Error('验证已过期');return {challenge:'test'};});await h.click();
  assert.match(e['login-error'].textContent,/验证已过期/);assert.equal(e['passkey-login'].disabled,false);assert.equal(h.context.location.redirect,undefined);
  h.response(()=>{throw new Error('密码不正确');});await h.submit();assert.match(e['login-error'].textContent,/密码不正确/);assert.equal(e.password.value,'typed-password');
  h.response(()=>({ok:true}));await h.submit();assert.equal(h.context.location.redirect,'/');assert.equal(e.password.value,'');assert.equal(e['login-error'].hidden,true);
});
