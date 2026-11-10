import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openStore } from './lib/store.mjs';
import { HttpError, fields } from './lib/validation.mjs';
import { readAuth, createAuth, verifyPassword } from './lib/auth.mjs';
import QRCode from 'qrcode';
import { createPasskeys } from './lib/passkeys.mjs';

const root=dirname(fileURLToPath(import.meta.url));
const loopback = host => ['127.0.0.1','::1','::ffff:127.0.0.1','localhost'].includes(host);
const sessionLifetime=7*24*60*60*1000;
function readJson(request) {
  if(request.headers['content-type']?.split(';')[0].trim()!=='application/json')throw new HttpError(415,'请求必须使用 JSON 格式。');
  return new Promise((resolveBody,reject)=>{
    let size=0;const chunks=[];
    request.on('data',chunk=>{
      size+=chunk.length;
      if(size>65536){chunks.length=0;reject(new HttpError(413,'内容过长，请缩短后重试。'));}
      else chunks.push(chunk);
    });
    request.on('end',()=>{
      if(size>65536)return;
      try {const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!body||typeof body!=='object'||Array.isArray(body))throw new Error();resolveBody(body);}
      catch{reject(new HttpError(400,'请求内容不是有效的 JSON 对象。'));}
    });
    request.on('error',reject);
    request.on('aborted',()=>reject(new HttpError(400,'请求已中断。')));
  });
}

export function createApp({databasePath,authPath,keyPath,origin='',allowSetup=false}) {
  if(origin && (new URL(origin).origin!==origin || !origin.startsWith('https://')))throw new Error('APP_ORIGIN 必须是完整 HTTPS 来源地址，不包含路径或末尾斜杠。');
  let auth=readAuth(authPath);
  if(!auth && (!allowSetup||origin))throw new Error('请先以本机模式启动并设置访问密码，再启用服务器部署配置。');
  const store=openStore(databasePath,{keyPath});
  const sessions=new Map();
  const enrollments=new Map();
  const sessionActive=token=>(sessions.get(token)||0)>Date.now();
  const passkeys=createPasskeys(store.vault,sessionActive);
  let attempts=0,attemptUntil=0,hashing=0;
  const cookie=(token,age)=>`archive_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${origin?'; Secure':''}`;
  const assets=new Map();
  assets.set('/vendor/simplewebauthn.min.js',{body:readFileSync(resolve(root,'node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js')),type:'text/javascript; charset=utf-8',public:false});
  for(const name of ['index.html','login.html','styles.css','login.js','app.js','ui.js','data.js','forms.js','graphs.js','timeline.js','selects.js','vendor/cytoscape.min.js','vendor/cytoscape-dagre.js','vendor/tom-select.complete.min.js','vendor/tom-select.css']){
    const type=name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8';
    assets.set('/'+name,{body:readFileSync(resolve(root,'public',name)),type,public:['login.html','login.js','styles.css'].includes(name)});
  }
  const server=createServer(async(request,response)=>{
    response.setHeader('Cache-Control','no-store');
    response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('X-Frame-Options','DENY');
    response.setHeader('Referrer-Policy','no-referrer');
    response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if(origin)response.setHeader('Strict-Transport-Security','max-age=31536000');
    const send=(status,body)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});response.end(JSON.stringify(body));};
    const redirect=path=>{response.writeHead(303,{Location:path});response.end();};
    try {
      const port=server.address()?.port;
      const allowedHosts=origin?[new URL(origin).host]:[`127.0.0.1:${port}`,`localhost:${port}`,`[::1]:${port}`];
      if(!allowedHosts.includes(request.headers.host)||(!origin&&!loopback(request.socket.remoteAddress)))throw new HttpError(403,'请求地址不受信任，请使用配置的访问地址。');
      const expectedOrigin=origin||`http://${request.headers.host}`;
      const path=new URL(request.url,expectedOrigin).pathname,method=request.method;
      const token=request.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('archive_session='))?.slice(16);
      const now=Date.now();
      for(const [key,expires] of sessions)if(expires<=now){sessions.delete(key);enrollments.delete(key);passkeys.cancel(key);}
      for(const [key,pending] of enrollments)if(pending.expires<=now)enrollments.delete(key);
      const authenticated=sessions.has(token);
      if(!['GET','HEAD'].includes(method)){
        if(request.headers['x-requested-with']!=='account-archive'||request.headers.origin!==expectedOrigin||request.headers['sec-fetch-site']==='cross-site')throw new HttpError(403,'请求来源校验失败，请重新打开页面。');
      }
      if(path==='/api/session'&&method==='GET')return send(200,{initialized:!!auth,authenticated});
      if((path==='/api/login'||path==='/api/setup')&&method==='POST'){
        if(now>=attemptUntil){attempts=0;attemptUntil=now+15*60_000;}
        if(attempts>=10||hashing>=2){response.setHeader('Retry-After',Math.ceil((attemptUntil-now)/1000));throw new HttpError(429,'尝试过于频繁，请稍后重试。');}
        const input=await readJson(request);fields(input,path==='/api/setup'?['password','confirm']:['password']);
        attempts++;hashing++;
        try{
          if(path==='/api/setup'){
            if(auth)throw new HttpError(409,'访问密码已经设置，请直接登录。');
            if(!allowSetup||origin||!loopback(request.socket.remoteAddress))throw new HttpError(403,'只能在本机初始化访问密码。');
            if(input.password!==input.confirm)throw new HttpError(400,'两次输入的密码不一致。');
            auth=await createAuth(authPath,input.password);
          }else if(!auth||!await verifyPassword(auth,input.password))throw new HttpError(401,'密码不正确。');
        }finally{hashing--;}
        attempts=0;if(token){sessions.delete(token);enrollments.delete(token);passkeys.cancel(token);}
        if(sessions.size>=30){const oldest=sessions.keys().next().value;sessions.delete(oldest);enrollments.delete(oldest);passkeys.cancel(oldest);}
        const session=randomBytes(32).toString('hex');sessions.set(session,Date.now()+sessionLifetime);
        response.setHeader('Set-Cookie',cookie(session,sessionLifetime/1000));return send(200,{ok:true});
      }
      if(path.startsWith('/api/')){
        if(!authenticated)throw new HttpError(401,'登录已过期，请重新登录后重试。');
        if(path==='/api/logout'&&method==='POST'){sessions.delete(token);enrollments.delete(token);passkeys.cancel(token);response.setHeader('Set-Cookie',cookie('',0));return send(200,{ok:true});}
        if(path==='/api/archive'&&method==='GET')return send(200,store.archive());
        if(path==='/api/security/totp/enrollment'&&method==='POST'||path==='/api/security/passkey/registration/options'&&method==='POST'||path==='/api/security/passkey'&&method==='DELETE'){
          const input=await readJson(request),isPasskey=path.includes('/passkey');fields(input,isPasskey?['password','code']:['password']);store.vault.checkRate();
          if(hashing>=2)throw new HttpError(429,'验证请求过于频繁，请稍后重试。');
          hashing++;
          try { if(!await verifyPassword(auth,input.password))store.vault.fail('管理工具访问密码不正确。'); }
          finally { hashing--; }
          if(!sessionActive(token))throw new HttpError(401,'登录已过期，请重新登录。');
          if(isPasskey){
            store.vault.verifyTotp(input.code);
            if(method==='DELETE'){store.vault.removePasskey();passkeys.cancel(token);return send(200,{ok:true});}
            return send(200,await passkeys.registrationOptions(token,expectedOrigin));
          }
          const pending={...store.vault.beginEnrollment(),expires:Date.now()+10*60_000};
          enrollments.set(token,pending);
          return send(200,{secret:pending.secret,qr:await QRCode.toDataURL(pending.uri,{width:256,margin:4}),expires:pending.expires});
        }
        if(path==='/api/security/totp/confirm'&&method==='POST'){
          const input=await readJson(request);fields(input,['code']);
          const pending=enrollments.get(token);
          if(!pending||pending.expires<=Date.now())throw new HttpError(400,'绑定已过期，请重新开始。');
          store.vault.confirmEnrollment(pending,input.code);enrollments.clear();
          return send(200,{ok:true});
        }
        if(path==='/api/security/totp/enrollment'&&method==='DELETE'){
          fields(await readJson(request),[]);enrollments.delete(token);return send(200,{ok:true});
        }
        if(path==='/api/security/passkey/challenge'&&method==='DELETE'){
          fields(await readJson(request),[]);passkeys.cancel(token);return send(200,{ok:true});
        }
        if(path==='/api/security/passkey/registration/verify'&&method==='POST'){
          const input=await readJson(request);fields(input,['response']);await passkeys.register(token,expectedOrigin,input.response);return send(200,{ok:true});
        }
        const passkeyReveal=path.match(/^\/api\/accounts\/([a-f\d-]{36})\/password\/passkey\/(options|verify)$/);
        if(passkeyReveal&&method==='POST'){
          const input=await readJson(request),[,account,action]=passkeyReveal;
          fields(input,action==='options'?[]:['response']);
          return send(200,action==='options'?await passkeys.authenticationOptions(token,expectedOrigin,account):{password:await passkeys.reveal(token,expectedOrigin,account,input.response)});
        }
        const reveal=path.match(/^\/api\/accounts\/([a-f\d-]{36})\/password$/);
        if(reveal&&method==='POST'){
          const input=await readJson(request);fields(input,['code']);
          return send(200,{password:store.vault.reveal(reveal[1],input.code)});
        }
        const match=path.match(/^\/api\/(accounts|tags|relations|events|subscriptions)(?:\/([a-f\d-]{36}))?(?:\/events(?:\/([a-f\d-]{36}))?)?$/);
        if(!match)throw new HttpError(404,'接口不存在。');
        if(!['POST','PUT','PATCH','DELETE'].includes(method))throw new HttpError(405,'不支持此请求方式。');
        const [,resource,id,eventId]=match,subevent=path.split('/').length>=5;
        const input=await readJson(request);let result;
        if(resource==='subscriptions'&&subevent&&id){
          if(method==='POST'&&!eventId)result=store.saveSubscriptionEvent(id,input);
          else if(method==='PUT'&&eventId)result=store.saveSubscriptionEvent(id,input,eventId);
          else throw new HttpError(405,'不支持此请求方式。');
        }else if(subevent)throw new HttpError(404,'接口不存在。');
        else if(resource==='accounts'&&((method==='POST'&&!id)||(method==='PUT'&&id)))result=store.saveAccount(input,id);
        else if(resource==='accounts'&&method==='DELETE'&&id)store.deleteAccount(id,input);
        else if(resource==='tags'&&((method==='POST'&&!id)||(method==='PUT'&&id)))result=store.saveTag(input,id);
        else if(resource==='tags'&&method==='DELETE'&&id)store.deleteTag(id,input);
        else if(resource==='relations'&&((method==='POST'&&!id)||(method==='PUT'&&id)))result=store.saveRelation(input,id);
        else if(resource==='relations'&&method==='DELETE'&&id)store.deleteRelation(id,input);
        else if(resource==='events'&&((method==='POST'&&!id)||(method==='PUT'&&id)))result=store.saveEvent(input,id);
        else if(resource==='subscriptions'&&method==='POST'&&!id)result=store.createSubscription(input);
        else if(resource==='subscriptions'&&method==='PATCH'&&id)store.renameSubscription(id,input);
        else throw new HttpError(405,'不支持此请求方式。');
        return send(method==='POST'?201:200,{id:result,ok:true});
      }
      if(!['GET','HEAD'].includes(method))throw new HttpError(405,'不支持此请求方式。');
      const asset=assets.get(path==='/'?'/index.html':path==='/login'?'/login.html':path);
      if(!asset)throw new HttpError(404,'页面不存在。');
      if(!asset.public&&!authenticated)return redirect('/login');
      response.writeHead(200,{'Content-Type':asset.type});response.end(method==='HEAD'?undefined:asset.body);
    }catch(error){
      if(!(error instanceof HttpError))console.error('Request failed:',error.code||error.name);
      if(!response.headersSent)send(error instanceof HttpError?error.status:500,{error:error instanceof HttpError?error.message:'保存或读取失败，请保留输入并重试。'});
      else response.end();
    }
  });
  server.requestTimeout=15_000;server.headersTimeout=10_000;
  server.on('close',()=>store.close());
  return server;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    process.umask(0o077);
    const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||3001),origin=process.env.APP_ORIGIN||'';
    if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT 必须为 1–65535。');
    if(!loopback(host)&&!origin)throw new Error('非本机监听必须配置 APP_ORIGIN。');
    const server=createApp({databasePath:resolve(root,process.env.DATABASE_PATH||'data/accounts.sqlite'),authPath:resolve(root,process.env.AUTH_PATH||'data/access.json'),keyPath:resolve(root,process.env.VAULT_KEY_PATH||'data/vault.key'),origin,allowSetup:loopback(host)&&!origin});
    server.on('error',error=>{console.error(`启动失败：${error.message}`);process.exitCode=1;server.close();});
    server.listen(port,host,()=>console.log(`归屿已启动：${origin||`http://${host.includes(':')?'['+host+']':host}:${port}`}（首次访问请设置管理密码）`));
    for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close();server.closeIdleConnections();});
  }catch(error){console.error(`启动失败：${error.message}`);process.exitCode=1;}
}
