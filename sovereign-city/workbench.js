(() => {
  const status=document.getElementById('local-service-status');
  const detail=document.getElementById('local-service-detail');
  const dot=document.getElementById('local-status-dot');
  const run=document.getElementById('run-agent-demo');
  const result=document.getElementById('workflow-result');
  const lineage=document.getElementById('echo-lineage');
  const lineageCount=document.getElementById('lineage-count');
  const isOwnerLoopback=location.protocol==='http:'&&location.hostname==='127.0.0.1'&&location.port==='8789';
  const esc=(value)=>String(value??'UNKNOWN');
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
  if(!isOwnerLoopback){
    status.textContent='LOCAL WORKBENCH OFFLINE · PUBLIC VIEW IS STATIC';
    detail.textContent='This page makes no localhost requests when served from GitHub Pages or another host. Start the owner-controlled loopback workbench on 127.0.0.1:8789 to enable the local workflow.';
    dot.classList.add('offline');
    run.disabled=true;
    return;
  }
  async function json(url,options={}){
    const response=await fetch(url,{cache:'no-store',credentials:'same-origin',...options});
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(body.error||`Local service HTTP ${response.status}`);
    return body;
  }
  function renderLineage(entries){
    lineage.replaceChildren();
    lineageCount.textContent=entries.length?`${entries.length} APPEND-ONLY RECORDS · LOCAL VERIFIED`:'NO LOCAL RECORDS';
    if(!entries.length){lineage.append(el('p','empty-lineage','No Echo records exist in the local ledger yet.'));window.AgentChainCity?.setEchoEntries([]);return;}
    const byEcho=new Map(entries.map(e=>[(e.record||{}).echo_id,e]));
    for(const entry of entries){
      const r=entry.record||{};const evidence=entry.evidence||{};const card=el('article','echo-record');
      const head=el('div','echo-record-head');head.append(el('span','echo-generation',`GEN ${String(r.generation??'?').padStart(2,'0')}`),el('span','echo-state',esc(r.execution_state)));card.append(head);
      const title=el('h3','',`⁰⁰⁹ · ${esc(r.echo_id).slice(0,16)}`);card.append(title);
      const actor=el('p','echo-actor',`Agent ${esc(r.agent_id).slice(0,18)} · sequence ${esc(r.agent_sequence)} · ${evidence.contributions?.length||0} signed contribution(s)`);card.append(actor);
      const refs=el('dl','echo-refs');
      for(const [label,value] of [['PARENT',r.parent_echo_id||'ORIGIN'],['ORIGIN EVENT',r.origin_event_hash],['EVIDENCE ROOT',r.evidence_commitment],['EVALUATION',r.evaluation_result_hash]]){const row=el('div','');row.append(el('dt','',label),el('dd','',esc(value).slice(0,28)));refs.append(row);}card.append(refs);
      const inspect=el('button','echo-inspect','INSPECT IN CITY ↗');inspect.type='button';inspect.addEventListener('click',()=>window.AgentChainCity?.select(`echo:${r.echo_id}`));card.append(inspect);
      if(r.parent_echo_id&&!byEcho.has(r.parent_echo_id)){card.classList.add('orphan');card.append(el('p','echo-warning','Parent record is absent from this returned ledger view.'))}
      lineage.append(card);
    }
    window.AgentChainCityPendingEchoEntries=entries;window.AgentChainCity?.setEchoEntries(entries);
  }
  function renderResult(data){
    result.replaceChildren();result.hidden=false;
    result.append(el('p','eyebrow','LOCAL PROOF OF AGENCY · VERIFIED ECHO CONTINUATION'));
    result.append(el('h3','',`${data.partial_score} → ${data.combined_score} deterministic coverage points`));
    result.append(el('p','workflow-summary',`${data.agent_count} distinct ephemeral signing identities in one local process; ${data.reviewer_count} independent reviewer identity. No independent model sessions were run.`));
    const facts=el('div','workflow-facts');
    for(const [label,value] of [['ROOT RESULT',data.entries?.[0]?.record?.evaluation_result_hash],['DESCENDANT ECHO',data.entries?.[1]?.record?.echo_id],['EXECUTION STATE',data.entries?.[1]?.record?.execution_state],['SETTLEMENT',data.settlement],['KEY LIFETIME',data.keys]]){const item=el('div','');item.append(el('span','',label),el('strong','',esc(value).slice(0,30)));facts.append(item);}result.append(facts);
  }
  async function connect(){
    status.textContent='CONNECTING TO LOOPBACK WORKBENCH…';dot.classList.add('connecting');
    try{
      await json('/api/session');
      const health=await json('/api/health');
      if(health.status!=='LOCAL_ONLY'||health.value_execution!=='DISABLED'||health.network!=='NOT_CONNECTED')throw new Error('local service safety declaration mismatch');
      const graph=await json('/api/echo/lineage');
      renderLineage(graph.entries||[]);
      status.textContent='LOCAL WORKBENCH CONNECTED · LOOPBACK ONLY';
      detail.textContent='Authenticated same-origin API. Proof of Agency and Echo records are verified locally; no validator, network, production signer, or settlement path is enabled.';
      dot.classList.remove('offline','connecting');dot.classList.add('online');run.disabled=false;
      run.addEventListener('click',runWorkflow,{once:false});
    }catch(error){
      status.textContent='LOCAL WORKBENCH UNAVAILABLE';detail.textContent=`${error.message}. Start the local service command shown in the release instructions.`;
      dot.classList.remove('connecting');dot.classList.add('offline');run.disabled=true;
    }
  }
  async function runWorkflow(){
    if(run.disabled)return;run.disabled=true;run.textContent='VERIFYING LOCAL AGENT WORK…';
    try{
      const data=await json('/api/echo/demo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workflow:'collective-discovery'})});
      renderResult(data);
      const graph=await json('/api/echo/lineage');renderLineage(graph.entries||[]);
      status.textContent='WORKFLOW VERIFIED · LOCAL LEDGER PERSISTED';
    }catch(error){status.textContent='LOCAL WORKFLOW REJECTED';detail.textContent=`${error.message}. No evidence was recorded as verified.`;}
    finally{run.disabled=false;run.textContent='RUN ANOTHER LOCAL COLLECTIVE →';}
  }
  connect();
})();
