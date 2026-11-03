(() => {
  const svg = document.getElementById('city-render');
  const stage = document.getElementById('city-stage');
  const inspector = {
    kind: document.getElementById('entity-kind'), title: document.getElementById('entity-title'),
    description: document.getElementById('entity-description'), id: document.getElementById('entity-id'),
    type: document.getElementById('entity-type'), links: document.getElementById('entity-links')
  };
  const NS = 'http://www.w3.org/2000/svg';
  const modes = ['SOVEREIGN', 'STATE_SPACE', 'POINT_CLOUD', 'TOPOLOGY', 'FIELD', 'MINIMAL'];
  const captions = {
    SOVEREIGN: 'Spatial city projection. Select a district, runtime surface, or relationship to inspect the model.',
    STATE_SPACE: 'Layered state-space projection. Runtime surfaces and product domains occupy separate bands.',
    POINT_CLOUD: 'Deterministic point-cloud projection. Node position encodes model grouping, not observed activity.',
    TOPOLOGY: 'Dependency topology. Edges show declared architecture relationships in the canonical model.',
    FIELD: 'Influence-field projection. Contours are generated from model geometry, not live telemetry.',
    MINIMAL: 'Reduced semantic projection. Focus on the model entities and their documented connections.'
  };
  const entityById = new Map();
  let model;
  let selected = 'sovereign-city';
  let activeMode = 'SOVEREIGN';
  let echoEntries = [];
  let echoEntities = [];
  let echoDynamicLinks = [];

  const el = (name, attrs = {}, text) => {
    const node = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (text != null) node.textContent = text;
    return node;
  };
  const hash01 = (text) => {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967295;
  };
  const baseEntities = () => [...model.districts.map(x => ({ ...x, kind: 'Product district', type: 'product district' })), ...model.surfaces.map(x => ({ ...x, group: 'surface', kind: 'Runtime surface', type: 'runtime surface' }))];
  const allEntities = () => [...baseEntities(), ...echoEntities];
  const allLinks = () => [...model.links, ...echoDynamicLinks];
  function rebuildEchoModel() {
    echoEntities=[]; echoDynamicLinks=[]; entityById.clear();
    for (const item of baseEntities()) entityById.set(item.id,item);
    entityById.set('sovereign-city',{id:'sovereign-city',name:'Sovereign City',role:'One architecture model connects the AgentChain product districts to their runtime surfaces.',type:'architecture root'});
    const add=(id,name,role,group,entryId)=>{if(!entityById.has(id)){const entity={id,name,role,kind:group==='echo'?'Sovereign Echo':group==='agent'?'Agent identity':'Evidence artifact',type:group.replaceAll('-',' '),group,entryId};entityById.set(id,entity);echoEntities.push(entity);}return id;};
    for(const entry of echoEntries){
      const r=entry.record||entry.Record||{};const ev=entry.evidence||entry.Evidence||{};if(!r.echo_id)continue;
      const echo=add(`echo:${r.echo_id}`,`⁰⁰⁹ Echo · ${r.echo_id.slice(0,10)}`,`Generation ${r.generation}; ${r.execution_state}. Signed by ${r.agent_id}. This is a local provenance record, not execution authority or settlement finality.`,'echo',r.echo_id);
      const agent=add(`agent:${r.agent_id}`,`Agent · ${r.agent_id.slice(0,14)}`,'Identity taken from signed Proof of Agency evidence.','agent',r.echo_id);
      const event=add(`event:${r.origin_event_hash}`,`Origin event · ${r.origin_event_hash.slice(0,10)}`,'Signed agent state event committed to the evaluated evidence.','origin-event',r.echo_id);
      const evidence=add(`evidence:${r.evidence_commitment}`,`Evidence · ${r.evidence_commitment.slice(0,10)}`,'Canonical commitment to challenge, work commitments, contributions, deterministic result, and review attestations.','evidence',r.echo_id);
      const evaluationData=ev.evaluation||ev.Evaluation||{};const evaluation=add(`evaluation:${r.evaluation_result_hash}`,`Result · ${r.evaluation_result_hash.slice(0,10)}`,`Deterministic Proof of Agency result ${evaluationData.total_score??'unknown'} points; independently reviewed.`,'evaluation',r.echo_id);
      echoDynamicLinks.push([event,echo],[agent,echo],[evidence,echo],[evaluation,evidence]);
      for(const c of (ev.contributions||ev.Contributions||[])){const cid=`contribution:${r.echo_id}:${c.identity_id}`;const contribution=add(cid,`Contribution · ${String(c.identity_id||'').slice(0,12)}`,`Signed contribution to challenge ${c.challenge_id}; evidence hash ${String(c.evidence_hash||'').slice(0,12)}.`,'contribution',r.echo_id);const contributor=add(`agent:${c.identity_id}`,`Agent · ${String(c.identity_id||'').slice(0,14)}`,'Identity attributed by the signed Proof of Agency contribution.','agent',r.echo_id);echoDynamicLinks.push([contributor,contribution],[contribution,evidence]);}
      for(const review of (ev.reviews||ev.Reviews||[])){const reviewer=add(`agent:${review.reviewer_id}`,`Reviewer · ${String(review.reviewer_id||'').slice(0,12)}`,`Signed independent review decision: ${review.approve?'APPROVE':'REJECT'}.`,'reviewer',r.echo_id);echoDynamicLinks.push([reviewer,evaluation]);}
      for(const c of (ev.commitments||ev.Commitments||[])){const commitment=add(`commitment:${c.commitment_id}`,`Obligation · ${String(c.commitment_id||'').slice(0,10)}`,'Bilateral signed, budget-capped objective commitment. Acceptance is not settlement.','commitment',r.echo_id);const acceptor=add(`agent:${c.acceptor_id}`,`Agent · ${String(c.acceptor_id||'').slice(0,14)}`,'Participant named in a bilateral work commitment.','agent',r.echo_id);echoDynamicLinks.push([acceptor,commitment],[commitment,evidence]);}
      if(r.parent_echo_id)echoDynamicLinks.push([`echo:${r.parent_echo_id}`,echo]);
    }
  }
  const escapeId = (id) => id.replace(/[^a-zA-Z0-9_-]/g, '-');
  function positions(mode) {
    const entities = allEntities();
    const district = model.districts;
    const surface = model.surfaces;
    const out = new Map();
    if (mode === 'SOVEREIGN') {
      const coords = [[300,160],[500,130],[700,160],[780,300],[700,440],[500,470],[300,440],[220,300]];
      district.forEach((e,i) => out.set(e.id, {x:coords[i][0], y:coords[i][1]}));
      surface.forEach((e,i) => out.set(e.id, {x:300+i*66, y:310+(i%2)*25}));
    } else if (mode === 'STATE_SPACE') {
      district.forEach((e,i) => out.set(e.id, {x:230+i*78, y:180+(i%2)*42}));
      surface.forEach((e,i) => out.set(e.id, {x:210+i*96, y:400-(i%2)*28}));
    } else if (mode === 'POINT_CLOUD') {
      entities.forEach((e,i) => {
        const angle = hash01(e.id+'a') * Math.PI * 2;
        const radius = 55 + hash01(e.id+'r') * 190;
        out.set(e.id, {x:500+Math.cos(angle)*radius, y:310+Math.sin(angle)*radius*.72});
      });
    } else if (mode === 'TOPOLOGY') {
      const center = {x:500,y:310};
      surface.forEach((e,i) => { const a=-Math.PI/2+i*2*Math.PI/surface.length; out.set(e.id,{x:center.x+Math.cos(a)*240,y:center.y+Math.sin(a)*210}); });
      district.forEach((e,i) => { const a=-Math.PI/2+i*2*Math.PI/district.length; out.set(e.id,{x:center.x+Math.cos(a)*92,y:center.y+Math.sin(a)*74}); });
    } else if (mode === 'FIELD') {
      district.forEach((e,i) => out.set(e.id,{x:255+(i%4)*165,y:190+Math.floor(i/4)*250}));
      surface.forEach((e,i) => out.set(e.id,{x:190+i*103,y:310+(i%2)*20}));
    } else {
      district.forEach((e,i) => out.set(e.id,{x:170+(i%4)*215,y:175+Math.floor(i/4)*300}));
      surface.forEach((e,i) => out.set(e.id,{x:140+i*120,y:310}));
    }
    const extras=entities.filter(e=>!out.has(e.id));
    const lanes={'echo':515,'origin-event':455,'agent':365,'reviewer':205,'evidence':275,'evaluation':225,'contribution':330,'commitment':410};
    extras.forEach((e,i)=>{const a=hash01(e.id+'-a')*Math.PI*2,r=42+hash01(e.id+'-r')*120;let p;if(mode==='STATE_SPACE'){const same=extras.filter(x=>x.group===e.group);const ix=same.indexOf(e);p={x:110+(ix+1)*780/(same.length+1),y:lanes[e.group]||300};}else if(mode==='TOPOLOGY'){const ring=({echo:135,evidence:205,evaluation:265,agent:330,reviewer:390,contribution:450,commitment:490,'origin-event':220})[e.group]||260;p={x:500+Math.cos(a)*ring,y:310+Math.sin(a)*ring*.62};}else if(mode==='FIELD'){p={x:95+(i%8)*116,y:155+Math.floor(i/8)*112};}else if(mode==='MINIMAL'){p={x:65+(i%10)*96,y:548-Math.floor(i/10)*70};}else if(mode==='SOVEREIGN'){p={x:500+Math.cos(a)*r,y:495+Math.sin(a)*r*.42};}else{p={x:500+Math.cos(a)*r,y:310+Math.sin(a)*r*.72};}out.set(e.id,p);});
    return out;
  }
  function clearSvg() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.append(el('title',{id:'svg-title'},`${activeMode.replace('_',' ')} Sovereign City projection`));
    svg.append(el('desc',{id:'svg-desc'},captions[activeMode]));
    const defs = el('defs');
    const grad = el('linearGradient',{id:'district-gradient',x1:'0',x2:'1',y1:'0',y2:'1'});
    grad.append(el('stop',{offset:'0%','stop-color':'#142d42'}),el('stop',{offset:'100%','stop-color':'#0a1825'}));
    const filter = el('filter',{id:'glow',x:'-50%',y:'-50%',width:'200%',height:'200%'});
    filter.append(el('feGaussianBlur',{stdDeviation:'5',result:'blur'}));
    const merge = el('feMerge'); merge.append(el('feMergeNode',{in:'blur'}),el('feMergeNode',{in:'SourceGraphic'})); filter.append(merge);
    defs.append(grad,filter); svg.append(defs);
    svg.append(el('rect',{class:'svg-backdrop',x:0,y:0,width:1000,height:620,rx:8}));
  }
  function drawBackground(mode, pos) {
    if (mode === 'SOVEREIGN') {
      svg.append(el('path',{class:'city-grid',d:'M90 310 L500 70 L910 310 L500 550 Z'}));
      svg.append(el('path',{class:'city-grid city-grid-inner',d:'M150 310 L500 105 L850 310 L500 515 Z'}));
      for(let i=0;i<9;i++) svg.append(el('path',{class:'city-grid',d:`M${155+i*86} 275 L${500+i*0} ${75+i*0} M${155+i*86} 345 L${500+i*0} 545`}));
    } else if (mode === 'STATE_SPACE') {
      svg.append(el('rect',{class:'band band-top',x:55,y:105,width:890,height:185,rx:4}));
      svg.append(el('rect',{class:'band band-bottom',x:55,y:330,width:890,height:185,rx:4}));
      svg.append(el('text',{class:'band-label',x:75,y:130},'PRODUCT DISTRICTS / DOMAIN STATE'));
      svg.append(el('text',{class:'band-label',x:75,y:355},'RUNTIME SURFACES / EXECUTION LAYER'));
    } else if (mode === 'FIELD') {
      for (const [i,e] of model.districts.entries()) {
        const p=pos.get(e.id), color=i%2?'#54d9c4':'#5dcfff';
        svg.append(el('circle',{class:'field-halo',cx:p.x,cy:p.y,r:100,fill:color,opacity:'.055'}));
        svg.append(el('circle',{class:'field-ring',cx:p.x,cy:p.y,r:70,stroke:color,opacity:'.17'}));
      }
      for(let r=0;r<4;r++) svg.append(el('ellipse',{class:'field-contour',cx:500,cy:310,rx:140+r*90,ry:75+r*45}));
    } else if (mode === 'MINIMAL') {
      svg.append(el('line',{class:'minimal-axis',x1:80,y1:310,x2:920,y2:310}));
    } else if (mode === 'TOPOLOGY') {
      svg.append(el('circle',{class:'topology-orbit',cx:500,cy:310,r:240}));
      svg.append(el('circle',{class:'topology-orbit inner',cx:500,cy:310,r:95}));
    } else if (mode === 'POINT_CLOUD') {
      for(let i=0;i<150;i++) {
        const x=70+hash01(`dust-x-${i}`)*860, y=54+hash01(`dust-y-${i}`)*512;
        svg.append(el('circle',{class:'cloud-dust',cx:x,cy:y,r:1+hash01(`dust-r-${i}`)*1.4,opacity:.13+hash01(`dust-o-${i}`)*.22}));
      }
    }
  }
  function drawLinks(pos, mode) {
    const g=el('g',{class:`links links-${mode.toLowerCase()}`});
    for (const [a,b] of allLinks()) {
      const p=pos.get(a), q=pos.get(b);
      if (!p || !q) continue;
      let path;
      if(mode==='SOVEREIGN') {const mid=(p.x+q.x)/2; path=`M${p.x} ${p.y} Q${mid} ${((p.y+q.y)/2)-26} ${q.x} ${q.y}`;}
      else if(mode==='FIELD') {path=`M${p.x} ${p.y} C${(p.x+q.x)/2} ${p.y-50} ${(p.x+q.x)/2} ${q.y+50} ${q.x} ${q.y}`;}
      else path=`M${p.x} ${p.y} L${q.x} ${q.y}`;
      const edge=el('path',{class:'model-link',d:path,'data-from':a,'data-to':b,tabindex:'0','aria-label':`${entityById.get(a).name} connects to ${entityById.get(b).name}`});
      edge.addEventListener('click',()=>select(a));
      edge.addEventListener('keydown',(e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select(a);}});
      g.append(edge);
    }
    svg.append(g);
  }
  function nodeShape(entity,p,mode) {
    const district=entity.kind==='Product district';
    const dynamic=Boolean(entity.group)&&entity.group!=='surface';
    const selectedNow=selected===entity.id;
    const group=el('g',{class:`entity-node ${dynamic?'node-echo':district?'node-district':'node-surface'} ${dynamic?`node-${entity.group}`:''} ${selectedNow?'is-selected':''}`,'data-id':entity.id,tabindex:'0',role:'button','aria-label':`${entity.kind}: ${entity.name}. ${entity.role}`});
    if(dynamic && mode==='SOVEREIGN') {
      const rr=entity.group==='echo'?17:entity.group==='agent'?12:8;
      group.append(el('circle',{class:`echo-point echo-point-${entity.group}`,cx:p.x,cy:p.y,r:rr}));
      group.append(el('text',{class:'echo-label',x:p.x+rr+5,y:p.y+3},entity.name));
    } else if(district && mode==='SOVEREIGN') {
      const w=145,h=58,dx=20,dy=19,x=p.x-w/2,y=p.y-h/2;
      group.append(el('polygon',{class:'building-side',points:`${x+w/2},${y+h} ${x+w/2+dx},${y+h-dy} ${x+w/2+dx},${y+h+dy} ${x+w/2},${y+h+2*dy}`}));
      group.append(el('polygon',{class:'building-side building-left',points:`${x},${y+h/2} ${x+w/2},${y+h} ${x+w/2},${y+h+2*dy} ${x},${y+h+dy}`}));
      group.append(el('polygon',{class:'building-top',points:`${x},${y+h/2} ${x+w/2},${y} ${x+w},${y+h/2} ${x+w/2},${y+h}`}));
      group.append(el('text',{class:'node-label building-label',x:p.x,y:p.y+4,'text-anchor':'middle'},entity.name));
    } else if (mode==='POINT_CLOUD') {
      group.append(el('circle',{class:'cloud-halo',cx:p.x,cy:p.y,r:district?14:9}));
      group.append(el('circle',{class:'cloud-point',cx:p.x,cy:p.y,r:district?5.5:3.5}));
      group.append(el('text',{class:'cloud-label',x:p.x+12,y:p.y-8},entity.name));
    } else if (mode==='MINIMAL') {
      group.append(el('circle',{class:'minimal-node',cx:p.x,cy:p.y,r:district?7:5}));
      group.append(el('text',{class:'minimal-label',x:p.x,y:p.y+(district?30:25),'text-anchor':'middle'},entity.name));
    } else {
      const rx=dynamic?39:district?74:52,ry=dynamic?15:district?32:22;
      group.append(el('rect',{class:`node-box ${dynamic?'echo-box':''}`,x:p.x-rx,y:p.y-ry,width:rx*2,height:ry*2,rx:dynamic?7:district?8:20}));
      group.append(el('circle',{class:'node-pin',cx:p.x-rx+12,cy:p.y-ry+12,r:3}));
      group.append(el('text',{class:`node-label ${dynamic?'echo-node-label':''}`,x:p.x,y:p.y+4,'text-anchor':'middle'},entity.name));
      if(mode==='STATE_SPACE'&&!dynamic) group.append(el('text',{class:'node-kind',x:p.x,y:p.y+20,'text-anchor':'middle'},district?'PRODUCT DOMAIN':'RUNTIME SURFACE'));
    }
    group.addEventListener('click',()=>select(entity.id));
    group.addEventListener('keydown',(e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select(entity.id);} });
    return group;
  }
  function render(mode=activeMode) {
    if (!modes.includes(mode)) return;
    activeMode=mode; stage.dataset.mode=mode; rebuildEchoModel();
    document.getElementById('model-caption').textContent=captions[mode] + (echoEntries.length ? ` ${echoEntries.length} persisted Echo record(s) are projected.` : '');
    for(const button of document.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed',String(button.dataset.mode===mode));
    clearSvg();
    const pos=positions(mode);
    drawBackground(mode,pos); drawLinks(pos,mode);
    const nodes=allEntities().map(e=>nodeShape(e,pos.get(e.id),mode));
    for(const node of nodes) svg.append(node);
    if(mode==='SOVEREIGN') svg.append(el('text',{class:'city-label',x:500,y:570,'text-anchor':'middle'},'SOVEREIGN CITY / PRODUCT DOMAIN PLANE'));
    if(mode==='FIELD') svg.append(el('text',{class:'city-label',x:500,y:575,'text-anchor':'middle'},'MODEL RELATION FIELD · NO LIVE TELEMETRY'));
    if(mode==='TOPOLOGY') svg.append(el('text',{class:'city-label',x:500,y:590,'text-anchor':'middle'},'DECLARED ARCHITECTURE LINKS'));
    updateStageCount();
  }
  function select(id) {
    const entity=entityById.get(id);
    if(!entity) return;
    selected=id;
    const linked=new Set(allLinks().flatMap(([a,b])=>a===id?[b]:b===id?[a]:[]));
    if(id==='sovereign-city') linked.clear();
    inspector.kind.textContent=entity.kind || 'CITY MODEL';
    inspector.title.textContent=entity.name;
    inspector.description.textContent=entity.role || 'Root of the Sovereign City architecture projection.';
    inspector.id.textContent=entity.id;
    inspector.type.textContent=entity.type || 'architecture root';
    inspector.links.textContent=id==='sovereign-city'?`${allEntities().length} entities · ${allLinks().length} model and evidence links`:`${linked.size} connected entities · ${linked.size? [...linked].map(x=>entityById.get(x).name).join(', '):'no declared links'}`;
    render(activeMode);
    if(id!=='sovereign-city') document.querySelector(`[data-catalog-id="${CSS.escape(id)}"]`)?.scrollIntoView({block:'nearest',behavior:'smooth'});
  }
  function updateStageCount(){document.getElementById('stage-count').textContent=`${allEntities().length} ENTITIES · ${allLinks().length} LINKS`;}
  function populateCatalog(){
    const surfaceList=document.getElementById('surface-list'), districtList=document.getElementById('district-list');
    for(const [items,target] of [[model.surfaces,surfaceList],[model.districts,districtList]]) items.forEach((item,index)=>{
      const button=document.createElement('button');button.type='button';button.className='entity-row';button.dataset.catalogId=item.id;
      const num=document.createElement('span');num.className='entity-number';num.textContent=String(index+1).padStart(2,'0');
      const body=document.createElement('span');body.className='entity-copy';const title=document.createElement('strong');title.textContent=item.name;const role=document.createElement('small');role.textContent=item.role;body.append(title,role);
      const arrow=document.createElement('span');arrow.className='entity-arrow';arrow.textContent='↗';button.append(num,body,arrow);button.addEventListener('click',()=>select(item.id));target.append(button);
    });
  }
  function renderSnapshot(snapshot={}){
    const c=document.getElementById('captured'),m=document.getElementById('metrics');
    const historical=snapshot.historical_capture||{},current=snapshot.current_status||{},topology=snapshot.topology||{};
    const date=historical.snapshot_date||'UNKNOWN';
    c.textContent=`Historical local capture: ${date} · capture date only, not AgentChain's beginning`;
    const values=[['Historical qualification',historical.qualification_result||'UNKNOWN'],['Capture date',date],['Product districts',topology.product_districts],['Runtime surfaces',topology.runtime_surfaces],['Current runtime',current.runtime||'NOT_PUBLICLY_DEPLOYED'],['Public testnet',current.public_testnet||'NOT_DEPLOYED'],['Production admission',current.production_admission||'NOT_QUALIFIED'],['Value execution',current.value_execution||'DISABLED']];
    for(const [label,value] of values){const card=document.createElement('article');card.className='metric';const name=document.createElement('span');name.textContent=label;const result=document.createElement('strong');result.textContent=String(value??'UNKNOWN');card.append(name,result);m.append(card);}
  }
  async function init(){
    try {
      const response=await fetch('./model.json',{cache:'no-store'});if(!response.ok)throw new Error(`model HTTP ${response.status}`);
      model=await response.json();
      if(model.schema!=='agentchain-sovereign-city-model/1'||model.districts.length!==8||model.surfaces.length!==7||!Array.isArray(model.links))throw new Error('canonical model validation failed');
      for(const entity of allEntities()){if(entityById.has(entity.id))throw new Error(`duplicate model id ${entity.id}`);entityById.set(entity.id,entity);}
      entityById.set('sovereign-city',{id:'sovereign-city',name:'Sovereign City',role:'One architecture model connects the AgentChain product districts to their runtime surfaces.',type:'architecture root'});
      populateCatalog();document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>render(b.dataset.mode)));
      render('SOVEREIGN');document.getElementById('render-error').hidden=true;
      try {const snap=await fetch('./runtime.json',{cache:'no-store'});if(!snap.ok)throw new Error(`snapshot HTTP ${snap.status}`);renderSnapshot(await snap.json());}catch(error){document.getElementById('captured').textContent='Historical snapshot unavailable; model view remains active.';console.warn('Sovereign City snapshot unavailable:',error);}
      window.AgentChainCity={setEchoEntries(entries){echoEntries=Array.isArray(entries)?entries:[];render(activeMode);},select};if(Array.isArray(window.AgentChainCityPendingEchoEntries))window.AgentChainCity.setEchoEntries(window.AgentChainCityPendingEchoEntries);
    } catch(error) {
      console.error('Sovereign City model initialization failed:',error);
      document.getElementById('render-error').hidden=false;
      document.getElementById('captured').textContent='Snapshot unavailable.';
    }
  }
  init();
})();
