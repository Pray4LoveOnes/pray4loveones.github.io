const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const appPath = process.argv[2] || path.join(repo, 'sovereign-city/app.js');
const modelPath = process.argv[3] || path.join(repo, 'sovereign-city/model.json');
const snapshotPath = process.argv[4] || path.join(repo, 'sovereign-city/runtime.json');
class El {
  constructor(tag='div') { this.tagName=tag;this.children=[];this.attrs={};this.listeners={};this.dataset={};this.style={};this.hidden=false;this.textContent='';this.parentNode=null;this.className=''; }
  append(...items) { for(const item of items){this.children.push(item);item.parentNode=this;} }
  appendChild(item) { this.append(item);return item; }
  removeChild(item) { this.children.splice(this.children.indexOf(item),1);item.parentNode=null;return item; }
  get firstChild() { return this.children[0]||null; }
  setAttribute(k,v) { this.attrs[k]=String(v);if(k==='data-mode')this.dataset.mode=String(v); }
  getAttribute(k) { return this.attrs[k]??null; }
  addEventListener(k,fn) { this.listeners[k]=fn; }
  scrollIntoView() {}
}
const ids=['city-render','city-stage','entity-kind','entity-title','entity-description','entity-id','entity-type','entity-links','model-caption','stage-count','render-error','surface-list','district-list','captured','metrics'];
const els=Object.fromEntries(ids.map(id=>[id,new El(id==='city-render'?'svg':'div')]));
const buttons=['SOVEREIGN','STATE_SPACE','POINT_CLOUD','TOPOLOGY','FIELD','MINIMAL'].map(mode=>{const b=new El('button');b.dataset.mode=mode;b.attrs['data-mode']=mode;return b;});
const doc={getElementById:id=>els[id],createElementNS:(_ns,tag)=>new El(tag),createElement:tag=>new El(tag),querySelectorAll:s=>s==='[data-mode]'?buttons:[],querySelector:s=>{const id=s.match(/data-catalog-id="([^"]+)/)?.[1];return [...els['surface-list'].children,...els['district-list'].children].find(x=>x.dataset.catalogId===id)||null;}};
const sandbox={document:doc,console,Map,Set,Math,Array,String,Object,Number,Error,CSS:{escape:x=>x},fetch:async url=>({ok:true,json:async()=>url.includes('model.json')?JSON.parse(fs.readFileSync(modelPath,'utf8')):JSON.parse(fs.readFileSync(snapshotPath,'utf8'))}),window:{},setTimeout,clearTimeout};
vm.runInNewContext(fs.readFileSync(appPath,'utf8'),sandbox);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const flat=nodes=>nodes.flatMap(n=>[n,...flat(n.children)]);
(async()=>{
  await wait(0);
  assert.equal(els['surface-list'].children.length,7);
  assert.equal(els['district-list'].children.length,8);
  assert.equal(els.metrics.children.length,8);
  const baseSignatures=new Map();
  for(const button of buttons){
    button.listeners.click();
    assert.equal(button.attrs['aria-pressed'],'true',`active mode ${button.dataset.mode}`);
    baseSignatures.set(button.dataset.mode,els['city-render'].children.map(n=>`${n.tagName}:${n.attrs.class||''}:${n.attrs.d||''}:${n.attrs.points||''}`).join('|'));
    assert.equal(els['city-render'].children.filter(n=>n.attrs.class?.includes('entity-node')).length,15);
    assert.equal(flat(els['city-render'].children).filter(n=>n.attrs.class==='model-link').length,20);
  }
  assert.equal(new Set(baseSignatures.values()).size,6,'six base projections are distinct');
  const district=els['district-list'].children[0];district.listeners.click();
  assert.equal(els['entity-title'].textContent,'The Kin');
  assert.equal(els['entity-kind'].textContent,'Product district');
  assert.match(els['entity-links'].textContent,/connected entities/);
  const sampleEcho={record:{echo_id:'a'.repeat(64),agent_id:'agent-a',origin_event_hash:'b'.repeat(64),origin_contribution_hash:'c'.repeat(64),evaluation_result_hash:'d'.repeat(64),evidence_commitment:'e'.repeat(64),generation:0,agent_sequence:1,execution_state:'EVALUATED_LOCAL',authorized_continuers:[]},evidence:{evaluation:{total_score:3},contributions:[{identity_id:'agent-a',challenge_id:'demo',evidence_hash:'f'.repeat(64)}],reviews:[{reviewer_id:'agent-r',approve:true}],commitments:[{commitment_id:'commit-1',acceptor_id:'agent-a'}]}};
  const echoEntries=process.env.AGENTCHAIN_ECHO_LINEAGE_JSON?JSON.parse(process.env.AGENTCHAIN_ECHO_LINEAGE_JSON):[sampleEcho];
  assert.ok(echoEntries.length>0,'Echo lineage fixture required');
  const echoIds=echoEntries.map(entry=>entry.record.echo_id);
  sandbox.window.AgentChainCity.setEchoEntries(echoEntries);
  const withEcho=new Map();
  for(const button of buttons){
    button.listeners.click();
    const rendered=flat(els['city-render'].children);
    withEcho.set(button.dataset.mode,els['city-render'].children.map(n=>`${n.tagName}:${n.attrs.class||''}:${n.attrs.d||''}:${n.attrs.points||''}`).join('|'));
    const entityIds=rendered.filter(n=>n.attrs.class?.includes('entity-node')).map(n=>n.attrs['data-id']);
    for(const echoId of echoIds)assert.ok(entityIds.includes(`echo:${echoId}`),`${button.dataset.mode} projects Echo ${echoId}`);
    assert.ok(entityIds.length>15,`${button.dataset.mode} includes Echo evidence nodes`);
    assert.ok(rendered.filter(n=>n.attrs.class==='model-link').length>20,`${button.dataset.mode} includes evidence links`);
  }
  assert.equal(new Set(withEcho.values()).size,6,'Echo lineage appears in six distinct projections');
  const echoNode=flat(els['city-render'].children).find(n=>n.attrs['data-id']===`echo:${echoIds[0]}`);
  assert.ok(echoNode?.listeners.keydown,'Echo nodes support keyboard inspection');
  echoNode.listeners.keydown({key:'Enter',preventDefault(){}});
  assert.equal(els['entity-kind'].textContent,'Sovereign Echo');
  assert.match(els['entity-description'].textContent,/not execution authority or settlement finality/);
  assert.equal(els['render-error'].hidden,true);
  console.log(`SOVEREIGN_CITY_TESTS=PASS modes=6 distinct_projections=6 districts=8 surfaces=7 base_links=20 echo_records=${echoIds.length} lineage_projections=6 keyboard_inspection=PASS snapshot_metrics=8`);
})().catch(error=>{console.error(error);process.exit(1);});
