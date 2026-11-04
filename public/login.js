const $=s=>document.querySelector(s);
let initialized=true;
const reauth=new URLSearchParams(location.search).has('reauth');
function success(){if(reauth){$('#login-form').hidden=true;$('#login-success').hidden=false;$('#login-description').textContent='身份验证成功。';}else location.replace('/');}
async function load(){
  try{
    const response=await fetch('/api/session');if(!response.ok)throw new Error('连接失败，请刷新页面重试。');
    const session=await response.json();initialized=session.initialized;
    if(session.authenticated)return success();
    $('#login-title').textContent=initialized?'访问我的档案':'设置访问密码';
    $('#login-description').textContent=initialized?'输入访问密码，继续整理你的账号与关联。':'首次使用，请在本机设置 12–256 位访问密码。之后使用此密码登录。';
    $('#confirm-field').hidden=initialized;$('#confirm').required=!initialized;
    $('#password').autocomplete=initialized?'current-password':'new-password';
    $('#password').minLength=initialized?1:12;
    $('#login-submit').textContent=initialized?'进入档案':'设置密码并进入';$('#login-form').hidden=false;$('#password').focus();
  }catch(error){$('#login-description').textContent=error.message;}
}
$('#login-form').addEventListener('submit',async event=>{
  event.preventDefault();$('#login-submit').disabled=true;$('#login-error').hidden=true;
  try{
    const body={password:$('#password').value};if(!initialized)body.confirm=$('#confirm').value;
    const response=await fetch(initialized?'/api/login':'/api/setup',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'account-archive'},body:JSON.stringify(body)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'登录失败，请重试。');
    $('#password').value='';$('#confirm').value='';success();
  }catch(error){$('#login-error').textContent=error.message;$('#login-error').hidden=false;}
  finally{$('#login-submit').disabled=false;}
});
load();
