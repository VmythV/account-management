const graphInstances = [];

function graphData(focus, mode='full') {
  let ids, links, omitted=0;
  if(mode==='preview') {
    const incoming=A.links.filter(l=>l.to===focus), outgoing=A.links.filter(l=>l.from===focus);
    links=[...incoming.slice(0,1),...outgoing.slice(0,2)];
    omitted=incoming.length+outgoing.length-links.length;
    ids=new Set([focus,...links.flatMap(l=>[l.from,l.to])]);
  } else {
    ids=focus==='all'?new Set(A.accounts.map(a=>a.id)):relatedIds(focus);
    links=A.links.filter(l=>ids.has(l.from)&&ids.has(l.to));
  }
  return {accounts:A.accounts.filter(a=>ids.has(a.id)),links,omitted};
}

function graphMarkup(focus, mode='full') {
  const {accounts,links,omitted}=graphData(focus,mode), compact=mode==='preview';
  return `<div class="relationship-graph ${compact?'compact':''}" data-account-graph="${esc(focus)}" data-mode="${mode}">
    <div class="relationship-canvas" role="img" aria-label="${compact?'账号关联速览':'账号关联图谱'}：箭头由来源指向目标；下方提供可用键盘访问的账号与关联明细。"></div>
    ${compact?'':`<div class="graph-controls" aria-label="图谱视图控制"><button type="button" data-graph-control="out" aria-label="缩小图谱" title="缩小">−</button><span data-zoom-label>100%</span><button type="button" data-graph-control="in" aria-label="放大图谱" title="放大">＋</button><button type="button" data-graph-control="fit" aria-label="适应图谱大小">适应画布</button></div>`}
    <details class="graph-accessible"><summary>账号与关联明细${omitted?` · 另有 ${omitted} 条关联`:''}</summary><div class="graph-account-links">${accounts.map(a=>`<a href="#account/${a.id}/overview" aria-label="查看 ${esc(a.name)} 账号">${esc(a.name)}</a>`).join('')}</div><ul>${links.map(l=>`<li>${esc(A.get(l.from).name)} <span>→ ${esc(l.type)} →</span> ${esc(A.get(l.to).name)}</li>`).join('')||'<li>独立账号，暂未建立关联。</li>'}</ul></details>
  </div>`;
}

function graphAvatar(a) {
  const colors={gmail:['#fff1ef','#c9655d'],github:['#282c30','#fff'],cursor:['#282d34','#fff'],chatgpt:['#e9f3ed','#34775d'],claude:['#f9eee6','#ba8161'],figma:['#f2ecf9','#9168be'],outlook:['#eaf4fb','#2673aa'],spotify:['#ebf6ec','#408152'],nintendo:['#f9efef','#bd5f64']};
  const [bg,fg]=colors[a.brand]||['#edf1ee','#394d40'];
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${bg}"/><text x="16" y="21" text-anchor="middle" font-family="Arial,sans-serif" font-size="${a.mark?.length>1?11:17}" font-weight="600" fill="${fg}">${esc(a.mark||a.name.slice(0,1))}</text></svg>`;
  return 'data:image/svg+xml;utf8,'+encodeURIComponent(svg);
}

function graphElements(focus,mode='full') {
  const data=graphData(focus,mode);
  return [
    ...data.accounts.map(a=>({data:{id:a.id,label:a.name,avatar:graphAvatar(a)},classes:a.id===focus?'current':''})),
    ...data.links.map((l,i)=>({data:{id:`relation-${i}`,source:l.from,target:l.to,label:l.type}}))
  ];
}

function graphLayout(compact) {
  return {name:'dagre',rankDir:compact?'TB':'LR',nodeSep:compact?24:34,rankSep:compact?54:100,edgeSep:24,fit:false,animate:false,nodeDimensionsIncludeLabels:false,useDagreEdgeControlPoints:true};
}

function destroyGraphs() {
  graphInstances.forEach(({cy,observer})=>{observer.disconnect();cy.destroy();});
  graphInstances.length=0;
}

function mountGraphs() {
  document.querySelectorAll('[data-account-graph]').forEach(root=>{
    const compact=root.dataset.mode==='preview', container=root.querySelector('.relationship-canvas');
    const focus=root.dataset.accountGraph, data=graphData(focus,root.dataset.mode);
    const branching=compact&&data.links.filter(l=>l.from===focus).length>1;
    let cy;
    try {
      cy=cytoscape({container,elements:graphElements(focus,root.dataset.mode),layout:graphLayout(compact),
        minZoom:.15,maxZoom:2,autoungrabify:true,autounselectify:true,boxSelectionEnabled:false,
        userZoomingEnabled:!compact,userPanningEnabled:!compact,
        style:[
          {selector:'node',style:{shape:'round-rectangle',width:branching?112:176,height:compact?46:58,
            'background-color':'#fff','border-width':1.2,'border-color':'#d9e4dc',
            'background-image':'data(avatar)','background-width':compact?24:30,'background-height':compact?24:30,
            'background-position-x':10,'background-position-y':'50%',
            label:'data(label)','font-family':'-apple-system, BlinkMacSystemFont, PingFang SC, sans-serif',
            'font-size':branching?11:13,'font-weight':500,color:'#394c41',
            'text-halign':'center','text-valign':'center','text-margin-x':compact?16:19,
            'text-wrap':'ellipsis','text-max-width':branching?62:118}},
          {selector:'node.current',style:{'background-color':'#eef6f0','border-width':1.8,'border-color':'#7fa58d',color:'#2d6655','font-weight':600}},
          {selector:'edge',style:{width:1.5,'line-color':'#a8bfaf','target-arrow-color':'#8aab96','target-arrow-shape':'triangle','arrow-scale':.8,
            'curve-style':'bezier',label:'data(label)','font-family':'-apple-system, BlinkMacSystemFont, PingFang SC, sans-serif',
            'font-size':compact?9:10,color:'#7b9383','text-background-color':'#fcfdfc','text-background-opacity':1,
            'text-background-padding':4,'text-wrap':'ellipsis','text-max-width':compact?82:120}}
        ]
      });
      const fit=()=>{cy.resize();cy.fit(undefined,compact?16:44);if(cy.zoom()>1)cy.zoom(1);cy.center();};
      const zoomLabel=root.querySelector('[data-zoom-label]');
      if(zoomLabel)cy.on('zoom',()=>{zoomLabel.textContent=`${Math.round(cy.zoom()*100)}%`;});
      cy.on('tap','node',e=>{location.hash=`#account/${e.target.id()}/overview`;});
      cy.on('mouseover','node',()=>{container.style.cursor='pointer';});
      cy.on('mouseout','node',()=>{container.style.cursor='';});
      root.querySelectorAll('[data-graph-control]').forEach(button=>button.addEventListener('click',()=>{
        if(button.dataset.graphControl==='fit')fit();
        else cy.zoom({level:cy.zoom()*(button.dataset.graphControl==='in'?1.25:.8),renderedPosition:{x:cy.width()/2,y:cy.height()/2}});
      }));
      const observer=new ResizeObserver(fit);observer.observe(container);
      graphInstances.push({cy,observer});fit();
    } catch(error) {
      cy?.destroy();container.textContent='图谱暂未加载，请查看下方关联明细。';
      root.querySelector('details').open=true;
      console.error('账号图谱加载失败',error);
    }
  });
}
