import { verifyProofBundle } from '../agentchain/verifier/index.mjs';

const form = document.getElementById('proof-verifier-form');
const fileInput = document.getElementById('proof-bundle-file');
const resultBox = document.getElementById('proof-verifier-result');
const trustStatus = document.getElementById('proof-trust-status');
const simpleCopy = document.getElementById('proof-simple-copy');
const technicalCopy = document.getElementById('proof-technical-copy');
const technicalDetails = document.getElementById('proof-input-details');
const inputJson = document.getElementById('proof-input-json');
let anchors = null;
let lastResult = null;

const levels = [
  ['proof-tab-simple', 'proof-panel-simple'],
  ['proof-tab-learn', 'proof-panel-learn'],
  ['proof-tab-technical', 'proof-panel-technical']
];

for (const [tabId, panelId] of levels) {
  const tab = document.getElementById(tabId);
  tab.addEventListener('click', () => selectLevel(tabId));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = levels.findIndex(([id]) => id === tabId);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? levels.length - 1 :
      (current + (event.key === 'ArrowRight' ? 1 : levels.length - 1)) % levels.length;
    const [nextTab] = levels[next];
    selectLevel(nextTab);
    document.getElementById(nextTab).focus();
  });
  document.getElementById(panelId).hidden = tabId !== 'proof-tab-simple';
}
selectLevel('proof-tab-simple');

function selectLevel(activeTab) {
  for (const [tabId, panelId] of levels) {
    const selected = tabId === activeTab;
    document.getElementById(tabId).setAttribute('aria-selected', String(selected));
  document.getElementById(tabId).tabIndex = selected ? 0 : -1;
    document.getElementById(panelId).hidden = !selected;
  }
}

function simpleMessage(status) {
  return {
    Verified: 'The signatures, links, public evaluation, review threshold, and continuation authorization passed under this page’s published trust policy. This does not prove that the contribution is true or settled.',
    Invalid: 'At least one signature, evidence link, public rule result, or authorization check failed.',
    Incomplete: 'Some required evidence or approved public keys are missing, so the bundle cannot be fully checked.',
    Unsupported: 'This bundle uses a format, signature algorithm, or evaluation rule this verifier does not support.'
  }[status] || 'The proof result is unavailable.';
}

function render(report, sourceText) {
  lastResult = report;
  resultBox.className = `proof-result ${report.status.toLowerCase()}`;
  const label = document.createElement('p');
  label.className = 'proof-result-label';
  label.textContent = report.status.toUpperCase();
  const heading = document.createElement('h3');
  heading.textContent = report.summary;
  const summary = document.createElement('p');
  summary.textContent = simpleMessage(report.status);
  const checks = document.createElement('ul');
  checks.className = 'proof-check-list';
  for (const check of report.checks) {
    const item = document.createElement('li');
    item.dataset.result = check.result.toLowerCase();
    const name = document.createElement('strong');
    name.textContent = `${check.result}: ${check.id.replaceAll('-', ' ')}`;
    const detail = document.createElement('span');
    detail.textContent = check.detail;
    item.append(name, detail);
    checks.append(item);
  }
  resultBox.replaceChildren(label, heading, summary, checks);
  simpleCopy.textContent = simpleMessage(report.status);
  technicalCopy.textContent = JSON.stringify(report, null, 2);
  inputJson.textContent = sourceText;
  technicalDetails.hidden = false;
}

async function loadTrustAnchors() {
  try {
    const url = new URL('../agentchain/verifier/trust-anchors.v1.json', import.meta.url);
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    anchors = await response.json();
    const keyCount = Array.isArray(anchors.keys) ? anchors.keys.length : 0;
    trustStatus.textContent = keyCount
      ? `Published policy: ${keyCount} trusted public key(s); ${anchors.policy?.reviewer_threshold ?? '?'} reviewer attestations required.`
      : 'No public identity keys are published yet. Unknown signers will be reported as Incomplete.';
  } catch {
    anchors = null;
    trustStatus.textContent = 'The published trust policy could not be loaded. Results will be Incomplete until it is available.';
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = fileInput.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    render({ status: 'Invalid', summary: 'The selected proof bundle is too large.', checks: [{ id: 'file-size-limit', result: 'FAIL', detail: 'Choose a JSON file no larger than 2 MiB.' }] }, '');
    return;
  }
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'VERIFYING…';
  try {
    const sourceText = await file.text();
    const report = await verifyProofBundle(sourceText, { trustAnchors: anchors });
    render(report, sourceText);
  } catch {
    render({ status: 'Invalid', summary: 'The selected file could not be read.', checks: [{ id: 'file-read', result: 'FAIL', detail: 'Select a valid UTF-8 JSON proof bundle.' }] }, '');
  } finally {
    button.disabled = false;
    button.textContent = 'VERIFY PROOF';
  }
});

loadTrustAnchors();

