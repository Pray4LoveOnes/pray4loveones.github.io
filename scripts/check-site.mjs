import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const failures = [];
const required = [
  '404.html',
  'robots.txt',
  'sitemap.xml',
  'site.webmanifest',
  'assets/favicon.svg',
  'assets/og-agentchain.svg',
  'assets/og-agentchain.png',
  'assets/css/agentchain-verifier.css',
  'agentchain/verifier/index.mjs',
  'agentchain/verifier/index.html',
  'agentchain/verifier/README.md',
  'agentchain/verifier/trust-anchors.v1.json',
  'agentchain/verifier/agentchain-proof-bundle.schema.json',
  'sovereign-city/verifier-ui.mjs',
  'scripts/test-agentchain-verifier.mjs',
  'visualization/index.html',
  'visualization/app.js',
  'visualization/style.css'
];

function fail(message) { failures.push(message); }
function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const file = join(dir, name);
    return statSync(file).isDirectory() ? filesUnder(file) : [file];
  });
}

for (const path of required) {
  if (!existsSync(join(root, path))) fail(`Missing required asset: ${path}`);
}

const htmlFiles = filesUnder(root).filter((file) => extname(file) === '.html' && !file.includes(`${join(root, '.git')}/`));
for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  const label = relative(root, file);
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
  for (const id of new Set(ids)) {
    if (ids.filter((candidate) => candidate === id).length > 1) fail(`${label}: duplicate id #${id}`);
  }
  for (const match of html.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)) {
    const reference = match[1];
    if (/^(?:https?:|mailto:|tel:|data:|javascript:)/.test(reference)) continue;
    if (reference.startsWith('#')) {
      if (!ids.includes(reference.slice(1))) fail(`${label}: missing local anchor ${reference}`);
      continue;
    }
    const [path, fragment] = reference.split('#');
    let target = normalize(path.startsWith('/') ? join(root, path.slice(1)) : join(dirname(file), path));
    if (existsSync(target) && statSync(target).isDirectory()) target = join(target, 'index.html');
    if (!existsSync(target)) {
      fail(`${label}: missing reference ${reference}`);
      continue;
    }
    if (fragment && extname(target) === '.html') {
      const targetHtml = readFileSync(target, 'utf8');
      if (!new RegExp(`\\bid=["']${fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`).test(targetHtml)) fail(`${label}: missing target anchor ${reference}`);
    }
  }
}

for (const file of filesUnder(root).filter((candidate) => ['.js', '.mjs'].includes(extname(candidate)))) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*)['"](\.[^'"]+)['"]/g)) {
    const specifier = match[1];
    const target = resolve(dirname(file), specifier);
    if (!existsSync(target) || !statSync(target).isFile()) fail(`${relative(root, file)}: missing module import ${specifier}`);
  }
}

for (const path of [
  'sovereign-city/qualification.json',
  'sovereign-city/runtime.json',
  'site.webmanifest',
  'agentchain/verifier/trust-anchors.v1.json',
  'agentchain/verifier/agentchain-proof-bundle.schema.json'
]) {
  try { JSON.parse(readFileSync(join(root, path), 'utf8')); }
  catch (error) { fail(`${path}: invalid JSON (${error.message})`); }
}
for (const path of ['agentchain/agent-manifest.json', 'agentchain/agent-status.json', 'agentchain/protocol/agentchain-protocol-profile-0.json']) {
  try { JSON.parse(readFileSync(join(root, path), 'utf8')); }
  catch (error) { fail(`${path}: invalid JSON (${error.message})`); }
}

const qualification = JSON.parse(readFileSync(join(root, 'sovereign-city/qualification.json'), 'utf8'));
const runtime = JSON.parse(readFileSync(join(root, 'sovereign-city/runtime.json'), 'utf8'));
if (qualification.truth_boundary?.production_qualified !== 'NO') fail('Qualification must not claim production qualification.');
if (qualification.truth_boundary?.value_execution !== 'DISABLED') fail('Qualification must keep public value execution disabled.');
if (qualification.topology?.product_districts !== 8 || qualification.topology?.runtime_surfaces !== 7) fail('Qualification topology must distinguish 8 product districts from 7 runtime surfaces.');
if (runtime.topology?.product_districts !== 8 || runtime.topology?.runtime_surfaces !== 7) fail('Runtime topology must distinguish 8 product districts from 7 runtime surfaces.');
if (qualification.git?.repository_available === false && qualification.git?.commit !== null) fail('Unavailable source Git repository cannot publish a commit value.');
if (qualification.historical_capture?.snapshot_date !== '2026-10-08' || qualification.historical_capture?.result !== 'PASS' || qualification.historical_capture?.project_origin_date !== false) fail('Qualification must date and scope the historical October 8 PASS without presenting it as project origin.');
if (runtime.historical_capture?.snapshot_date !== '2026-10-08' || runtime.historical_capture?.qualification_result !== 'PASS' || runtime.historical_capture?.project_origin_date !== false) fail('Runtime must distinguish the historical October 8 qualification from project origin.');
if (runtime.current_status?.runtime !== 'NOT_PUBLICLY_DEPLOYED' || runtime.current_status?.production_admission !== 'NOT_QUALIFIED' || runtime.current_status?.value_execution !== 'DISABLED') fail('Runtime must state current deployment and value-execution status separately from historical qualification.');
for (const file of ['agentchain/sdk/index.html', 'agentchain/cli/index.html']) {
  const html = readFileSync(join(root, file), 'utf8');
  if (/\/Users\/[A-Za-z0-9._-]+\//.test(html)) fail(`${file}: owner-local filesystem path must not appear in public documentation.`);
}

const agentManifest = JSON.parse(readFileSync(join(root, 'agentchain/agent-manifest.json'), 'utf8'));
const agentStatus = JSON.parse(readFileSync(join(root, 'agentchain/agent-status.json'), 'utf8'));
const protocolProfile = JSON.parse(readFileSync(join(root, 'agentchain/protocol/agentchain-protocol-profile-0.json'), 'utf8'));
const expectedLineage = ['SoulSync', 'SolaraKin', 'AgentChain'];
for (const [label, lineage] of [
  ['discovery manifest', agentManifest.history?.owner_attributed_lineage],
  ['status manifest', agentStatus.history?.owner_attributed_lineage],
  ['protocol profile', protocolProfile.project_lineage?.owner_attributed_sequence],
]) {
  if (JSON.stringify(lineage) !== JSON.stringify(expectedLineage)) fail(`${label}: preserve the documented 2025 project lineage.`);
}
if (agentManifest.history?.implementation_evidence?.earliest_preserved_solaraKin_record?.date !== '2025-07-11') fail('Discovery manifest must distinguish the recorded SolaraKin implementation date from project authorship attribution.');
if (agentManifest.scale?.architecture_population?.configured_agents_per_shard !== 10000 || agentStatus.scale_context?.architecture_population?.configured_agents_per_shard !== 10000 || protocolProfile.scale_context?.configured_agents_per_shard !== 10000) fail('All machine profiles must preserve the separately documented 10,000-agent-per-shard architecture.');
if (agentManifest.scale?.reported_local_workload?.concurrent_tasks !== 10000 || agentStatus.scale?.reported_local_workload?.concurrent_tasks !== 10000 || protocolProfile.scale_context?.separate_local_task_qualification?.concurrent_tasks !== 10000) fail('All machine profiles must preserve the separate 10,000-task qualification.');
if (agentManifest.scale?.reported_local_workload?.unit !== 'local Go goroutine tasks' || agentManifest.scale?.reported_local_workload?.independent_agent_qualification !== false || agentStatus.scale?.reported_local_workload?.independent_agent_population !== false || protocolProfile.scale_context?.separate_local_task_qualification?.independent_agents !== false) fail('10,000-task results must not be represented as independent-agent qualification.');
if (agentManifest.release?.website_publication !== 'publicly_served' || agentManifest.release?.software_distribution !== 'not_released' || agentManifest.service?.availability !== 'not_deployed') fail('Website publication, software distribution, and hosted service availability must remain distinct.');
if (agentManifest.profiles?.[0]?.status !== 'implemented' || agentManifest.profiles?.[0]?.execution_scope !== 'local' || agentManifest.profiles?.[0]?.consensus_integration !== false) fail('Proof of Agency must distinguish implemented local capability from consensus integration.');
if (agentManifest.profiles?.[1]?.display_coordinate !== '⁰⁰⁹' || agentManifest.profiles?.[1]?.display_coordinate_is_authority !== false || agentManifest.profiles?.[1]?.grants_execution_authority !== false) fail('Sovereign Echo display coordinate must remain presentation-only and grant no authority.');
const publicHistory = readFileSync(join(root, 'agentchain/index.html'), 'utf8') + readFileSync(join(root, 'agentchain/status/index.html'), 'utf8') + readFileSync(join(root, 'agentchain/protocol/index.html'), 'utf8');
if (!publicHistory.includes('SoulSync → SolaraKin → AgentChain') || !publicHistory.includes('not an independent legal authorship determination')) fail('Public pages must preserve the attributed lineage and its authorship evidence boundary.');
if (/LOCAL ALPHA RELEASE CANDIDATE|LOCAL RESEARCH PROTOTYPE|documentation-candidate-only|local-review-candidate|not published/i.test(publicHistory)) fail('Public AgentChain documentation must not be described as unpublished merely because hosted service or software distribution is unavailable.');

const verifierPage = readFileSync(join(root, 'sovereign-city/index.html'), 'utf8');
const workbenchJs = readFileSync(join(root, 'sovereign-city/workbench.js'), 'utf8');
const verifierUi = readFileSync(join(root, 'sovereign-city/verifier-ui.mjs'), 'utf8');
const verifierSdk = readFileSync(join(root, 'agentchain/verifier/index.mjs'), 'utf8');
const trustAnchors = JSON.parse(readFileSync(join(root, 'agentchain/verifier/trust-anchors.v1.json'), 'utf8'));
if (!verifierPage.includes('id="public-proof-verifier"') || !verifierPage.includes('Verify Proof')) fail('Sovereign City must expose the public proof verifier interface.');
if (!verifierPage.includes('id="run-agent-demo" hidden') || !workbenchJs.includes('run.hidden=true') || !workbenchJs.includes('run.hidden=false')) fail('Local execution control must be absent from the public view and revealed only on the owner loopback origin.');
if (!existsSync(join(root, 'visualization/index.html')) || existsSync(join(root, 'navier-stokes/visualization/index.html'))) fail('Visualization must be published from the relocated /visualization/ path only.');
if (/127\.0\.0\.1|localhost|\/api\//i.test(verifierUi + verifierSdk)) fail('Public proof verifier must not call loopback or private workbench APIs.');
if (/\b(fetch|XMLHttpRequest|WebSocket|EventSource)\b|\.subtle\.sign\b/.test(verifierSdk)) fail('Standalone verifier SDK must not perform network calls or sign data.');
if ((verifierUi.match(/\bfetch\(/g) || []).length !== 1 || !verifierUi.includes('../agentchain/verifier/trust-anchors.v1.json')) fail('Verifier page may fetch only the static public trust-anchor file.');
if (trustAnchors.schema !== 'agentchain-trust-anchors/1' || !Array.isArray(trustAnchors.keys)) fail('Public verifier trust anchors must use the versioned trust-anchor schema.');
if (trustAnchors.keys.some((key) => Object.keys(key).some((name) => /private|secret|seed/i.test(name)))) fail('Public trust anchors must never contain private key material.');

if (failures.length) {
  console.error(failures.map((message) => `- ${message}`).join('\n'));
  process.exit(1);
}
console.log(`SITE_CHECKS=PASS html=${htmlFiles.length} required_assets=${required.length}`);
