import { nextRenewal, summarize, STATUSES, renewalRule } from './timeline.js';

export async function api(path, method='GET', body) {
  let response;
  try {
    response=await fetch(path,{method,headers:method==='GET'?{}:{'Content-Type':'application/json','X-Requested-With':'account-archive'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  }catch{throw new Error('连接失败，请保留输入，确认服务运行后重试。');}
  const result=await response.json();
  if(!response.ok){
    if(response.status===401){const link=document.querySelector('#reauth-link');if(link)link.hidden=false;}
    throw Object.assign(new Error(result.error||'请求失败，请重试。'),{status:response.status});
  }
  return result;
}
export const Archive={
  accounts:[],tags:[],links:[],subscriptions:[],events:[],
  get(id){return this.accounts.find(a=>a.id===id);},
  matching(query='',tags=[],status='all'){
    const q=query.trim().toLocaleLowerCase();
    return this.accounts.filter(a=>(status==='all'||a.status===status)&&tags.every(t=>a.tags.includes(t))&&[a.name,a.identifier,a.type].some(v=>v.toLocaleLowerCase().includes(q)));
  },
  related(id,direction='both'){
    const seen=new Set([id]),queue=[id];
    for(let i=0;i<queue.length;i++)for(const link of this.links){
      const next=link.from===queue[i]&&direction!=='up'?link.to:link.to===queue[i]&&direction!=='down'?link.from:null;
      if(next&&!seen.has(next)){seen.add(next);queue.push(next);}
    }
    return seen;
  },
  renewal(s){return nextRenewal(s.current);},
  updateTime(){
    for(const s of this.subscriptions){
      const summary=summarize(s.events);
      Object.assign(s,summary,{status:STATUSES[summary.current.status],plan:summary.current.plan,cycle:summary.current.renewalCycle,day:summary.current.renewalDay,month:summary.current.renewalMonth,start:summary.startedAt});
    }
  },
};
export async function reload(){
  const data=await api('/api/archive');
  Object.assign(Archive,data);
  Archive.updateTime();
  Archive.events=data.events.concat(data.subscriptions.flatMap(s=>s.events.map(e=>({
    id:e.id,account:s.account,date:e.occurredAt,title:e.action,text:e.notes,kind:'订阅变更',subscription:s.id,version:s.version,
    snapshot:`${s.name} · ${STATUSES[e.status]} · ${e.plan} · ${renewalRule(e)}`,
  }))));
}
