const $=s=>document.querySelector(s);
let initialized=true,busy=false,attempt=0;
const reauth=new URLSearchParams(location.search).has('reauth');
function success(){
  $('#password').value='';$('#confirm').value='';
  if(reauth){$('#login-form').hidden=true;$('#login-passkey').hidden=true;$('#login-success').hidden=false;$('#login-description').textContent='身份验证成功。';}
  else location.replace('/');
}
function setBusy(value){busy=value;$('#login-submit').disabled=value;$('#passkey-login').disabled=value;}
async function post(path,body){
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'account-archive'},body:JSON.stringify(body)});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'登录失败，请重试。');
  return result;
}
async function load(){
  try{
    const response=await fetch('/api/session');if(!response.ok)throw new Error('连接失败，请刷新页面重试。');
    const session=await response.json();initialized=session.initialized;
    if(session.authenticated)return success();
    const passkey=initialized&&session.passkeyEnabled&&!!window.SimpleWebAuthnBrowser?.browserSupportsWebAuthn();
    $('#login-title').textContent=initialized?'访问我的档案':'设置访问密码';
    $('#login-description').textContent=initialized?(passkey?'使用通行密钥或访问密码登录。':'输入访问密码，继续整理你的账号与关联。'):'首次使用，请在本机设置 12–256 位访问密码。之后也可以绑定通行密钥登录。';
    $('#login-passkey').hidden=!passkey;
    $('#confirm-field').hidden=initialized;$('#confirm').required=!initialized;
    $('#password').autocomplete=initialized?'current-password':'new-password';
    $('#password').minLength=initialized?1:12;
    $('#login-submit').textContent=initialized?'密码登录':'设置密码并进入';
    $('#login-submit').className=passkey?'button wide':'button primary wide';
    $('#login-form').hidden=false;$(passkey?'#passkey-login':'#password').focus();
  }catch(error){$('#login-description').textContent=error.message;}
}
async function login(usePasskey){
  if(busy)return;setBusy(true);$('#login-error').hidden=true;const current=++attempt;
  try{
    if(usePasskey){
      const optionsJSON=await post('/api/login/passkey/options',{});if(current!==attempt)return;
      let response;
      try{response=await window.SimpleWebAuthnBrowser.startAuthentication({optionsJSON});}
      catch{throw new Error('系统验证未完成。可以重试，或使用密码登录。');}
      if(current!==attempt)return;
      await post('/api/login/passkey/verify',{response});
    }else{
      const body={password:$('#password').value};if(!initialized)body.confirm=$('#confirm').value;
      await post(initialized?'/api/login':'/api/setup',body);
    }
    if(current===attempt)success();
  }catch(error){if(current===attempt){$('#login-error').textContent=error.message;$('#login-error').hidden=false;}}
  finally{if(current===attempt)setBusy(false);}
}
$('#login-form').addEventListener('submit',event=>{event.preventDefault();return login(false);});
$('#passkey-login').addEventListener('click',()=>login(true));
window.addEventListener('pagehide',()=>{attempt++;setBusy(false);window.SimpleWebAuthnBrowser?.WebAuthnAbortService.cancelCeremony();});
load();
