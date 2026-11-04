const Archive = (() => {
  const now = new Date('2026-11-03T12:00:00+08:00');
  const tags = [
    {name:'个人', color:'#6b9c87'}, {name:'工作', color:'#7899ba'}, {name:'AI 工具', color:'#a195bd'},
    {name:'开发', color:'#c19a6f'}, {name:'娱乐', color:'#bd8f9b'}, {name:'重要账号', color:'#b9a265'}
  ];
  const accounts = [
    {id:'gmail',name:'Gmail',identifier:'demo@example.com',type:'邮箱',mark:'M',brand:'gmail',tags:['个人','重要账号'],created:'2024-03-12',notes:'日常使用的主邮箱，也是 Apple、GitHub 等账号的注册邮箱。',status:'正常'},
    {id:'apple',name:'Apple',identifier:'demo@example.com',type:'平台账号',mark:'●',brand:'apple',tags:['个人','重要账号'],created:'2024-03-15',notes:'用于 Apple 设备与「通过 Apple 登录」。部分网站使用隐藏邮箱地址。',status:'正常'},
    {id:'github',name:'GitHub',identifier:'demo-builds',type:'开发平台',mark:'GH',brand:'github',tags:['工作','开发'],created:'2024-04-02',notes:'个人开发账号，用于代码托管与开发工具授权。',status:'正常'},
    {id:'chatgpt',name:'ChatGPT',identifier:'demo@example.com',type:'AI 服务',mark:'✳',brand:'chatgpt',tags:['工作','AI 工具'],created:'2025-02-05',notes:'用于日常研究、写作和代码协作。',status:'正常'},
    {id:'claude',name:'Claude',identifier:'demo@example.com',type:'AI 服务',mark:'✺',brand:'claude',tags:['工作','AI 工具'],created:'2025-06-08',notes:'用于长文阅读与开发辅助。',status:'正常'},
    {id:'cursor',name:'Cursor',identifier:'demo-builds',type:'开发工具',mark:'↗',brand:'cursor',tags:['工作','开发','AI 工具'],created:'2025-07-18',notes:'通过 GitHub 授权登录。',status:'正常'},
    {id:'figma',name:'Figma',identifier:'demo@example.com',type:'设计工具',mark:'F',brand:'figma',tags:['工作'],created:'2024-06-21',notes:'设计文件与协作空间。',status:'正常'},
    {id:'notion',name:'Notion',identifier:'relay@example.com',type:'效率工具',mark:'N',brand:'notion',tags:['个人','工作'],created:'2024-08-09',notes:'使用 Apple 隐藏邮件地址登录。',status:'正常'},
    {id:'outlook',name:'Outlook',identifier:'backup@example.com',type:'邮箱',mark:'O',brand:'outlook',tags:['个人'],created:'2024-01-10',notes:'备用邮箱，用于娱乐服务注册。',status:'正常'},
    {id:'spotify',name:'Spotify',identifier:'demo-listens',type:'音乐服务',mark:'≋',brand:'spotify',tags:['个人','娱乐'],created:'2025-01-28',notes:'最近暂停了 Premium，保留播放列表。',status:'正常'},
    {id:'medium',name:'Medium',identifier:'@demo-notes',type:'内容社区',mark:'m',brand:'medium',tags:['个人'],created:'2025-03-02',notes:'阅读与写作。',status:'正常'},
    {id:'nintendo',name:'Nintendo',identifier:'demo-plays',type:'游戏平台',mark:'N',brand:'nintendo',tags:['娱乐'],created:'2024-10-12',notes:'旧设备使用的账号，已归档保留关联信息。',status:'已归档'}
  ];
  const links = [
    {from:'gmail',to:'apple',type:'邮箱注册'}, {from:'gmail',to:'github',type:'邮箱注册'},
    {from:'gmail',to:'chatgpt',type:'邮箱注册'}, {from:'gmail',to:'claude',type:'邮箱注册'},
    {from:'gmail',to:'figma',type:'邮箱注册'}, {from:'apple',to:'notion',type:'Apple 登录'},
    {from:'apple',to:'medium',type:'Apple 登录'}, {from:'apple',to:'spotify',type:'Apple 登录'},
    {from:'github',to:'cursor',type:'GitHub 登录'}, {from:'outlook',to:'nintendo',type:'邮箱注册'}
  ];
  const subscriptions = [
    {id:'sub-chatgpt',account:'chatgpt',plan:'Plus',status:'订阅中',cycle:'monthly',day:5,month:1,start:'2025-02-05',duration:636},
    {id:'sub-claude',account:'claude',plan:'Pro',status:'订阅中',cycle:'monthly',day:8,month:1,start:'2025-06-08',duration:513},
    {id:'sub-cursor',account:'cursor',plan:'Pro',status:'订阅中',cycle:'monthly',day:18,month:1,start:'2025-07-18',duration:473},
    {id:'sub-apple',account:'apple',plan:'iCloud+ · 200 GB',status:'订阅中',cycle:'yearly',day:6,month:11,start:'2024-11-06',duration:727},
    {id:'sub-spotify',account:'spotify',plan:'Premium',status:'已暂停',cycle:'monthly',day:28,month:1,start:'2025-01-28',duration:605}
  ];
  const events = [
    {id:'e1',account:'chatgpt',date:'2026-11-02T10:30',title:'确认下次续费日期',text:'Plus 月付，续费日期设为每月 5 日。',kind:'订阅变更',snapshot:'订阅中 · Plus · 每月 5 日'},
    {id:'e2',account:'gmail',date:'2026-11-01T14:20',title:'整理主邮箱的关联账号',text:'核对了 Apple、GitHub、ChatGPT、Claude 和 Figma 的注册邮箱。',kind:'账号记录'},
    {id:'e3',account:'apple',date:'2026-10-30T09:10',title:'通过 Apple 登录 Notion',text:'启用隐藏邮件地址，补充登录关联。',kind:'关联变更'},
    {id:'e4',account:'cursor',date:'2026-10-18T11:00',title:'续费 Pro 订阅',text:'继续使用 Pro，订阅状态保持不变。',kind:'订阅变更',snapshot:'订阅中 · Pro · 每月 18 日'},
    {id:'e5',account:'spotify',date:'2026-09-25T18:40',title:'暂停 Premium',text:'暂时使用免费版本，暂停期间不累计订阅时长。',kind:'订阅变更',snapshot:'已暂停 · Premium · 提醒已暂停'},
    {id:'e6',account:'github',date:'2026-09-12T16:00',title:'关联 Cursor',text:'使用 GitHub 授权登录 Cursor。',kind:'关联变更'},
    {id:'e7',account:'gmail',date:'2024-03-15T10:00',title:'使用邮箱注册 Apple 账号',text:'将 Apple 账号与主邮箱建立注册关联。',kind:'关联变更'},
    {id:'e8',account:'gmail',date:'2024-03-12T09:00',title:'注册 Gmail',text:'建立个人主邮箱，添加「个人」「重要账号」标签。',kind:'账号记录'}
  ];
  const get = id => accounts.find(a=>a.id===id);
  function matching(query='', selectedTags=[], status='all') {
    const q=query.trim().toLocaleLowerCase();
    return accounts.filter(a=>(status==='all'||a.status===status) && selectedTags.every(t=>a.tags.includes(t)) && [a.name,a.identifier,a.type].some(v=>v.toLocaleLowerCase().includes(q)));
  }
  function related(id, direction='both') {
    const seen=new Set([id]), queue=[id];
    for(let i=0;i<queue.length;i++) for(const link of links) {
      const next=link.from===queue[i] && direction!=='up' ? link.to : link.to===queue[i] && direction!=='down' ? link.from : null;
      if(next && !seen.has(next)){seen.add(next);queue.push(next);}
    }
    return seen;
  }
  function renewal(s, today=now) {
    if(!['订阅中','试用中'].includes(s.status)||s.cycle==='none') return null;
    const base=new Date(today.getFullYear(),today.getMonth(),today.getDate());
    const make=(y,m)=>new Date(y,m,Math.min(s.day,new Date(y,m+1,0).getDate()));
    let date=make(base.getFullYear(),s.cycle==='yearly'?s.month-1:base.getMonth());
    if(date<base) date=s.cycle==='yearly'?make(base.getFullYear()+1,s.month-1):make(base.getFullYear(),base.getMonth()+1);
    const days=Math.round((Date.UTC(date.getFullYear(),date.getMonth(),date.getDate())-Date.UTC(base.getFullYear(),base.getMonth(),base.getDate()))/86400000);
    return {date,days};
  }
  function validateLink(from,to,type) {
    if(!get(from)||!get(to)) return '请选择已存在的账号。';
    if(from===to) return '账号不能关联到自身。';
    if(!type.trim()) return '请填写关联方式。';
    if(links.some(l=>l.from===from&&l.to===to&&l.type===type.trim())) return '这条关联已经存在。';
    return '';
  }
  return {now,tags,accounts,links,subscriptions,events,get,matching,related,renewal,validateLink};
})();
if(typeof module!=='undefined') module.exports=Archive;
