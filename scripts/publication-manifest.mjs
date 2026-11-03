import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const coreRoot = process.env.AGENTCHAIN_PRIVATE_CORE_ROOT
  ? resolve(process.env.AGENTCHAIN_PRIVATE_CORE_ROOT)
  : resolve(root, '..', 'agent-city-e2e', 'agent-city-e2e');
const manifestPath = join(root, 'PUBLICATION_MANIFEST.json');
const checksumPath = join(root, 'PUBLICATION_MANIFEST.sha256');
const reviewPath = join(root, 'PUBLICATION_SECURITY_REVIEW.json');
const generatedLocalOnly = new Map([
  ['PUBLICATION_MANIFEST.json', 'Local review output; not part of the website artifact.'],
  ['PUBLICATION_MANIFEST.sha256', 'Local review output; not part of the website artifact.'],
  ['PUBLICATION_SECURITY_REVIEW.json', 'Local review output; not part of the website artifact.'],
]);
const forbiddenExt = new Set(['.pem', '.key', '.seed', '.db', '.sqlite', '.tar', '.gz', '.zip', '.go', '.rs']);
const implementationExt = new Set(['.go', '.rs', '.sol', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.sh', '.c', '.h', '.cpp', '.hpp']);
const skipCoreDirs = new Set(['.git', '.toolchains', '.agentchain', '.cache', 'node_modules', 'var', 'evidence', 'releases', 'out', 'bin']);
const secretPatterns = [
  ['private_key_block', /-----BEGIN (?:OPENSSH|RSA|EC|ED25519)? ?PRIVATE KEY-----/i],
  ['aws_access_key', /AKIA[0-9A-Z]{16}/],
  ['github_token', /gh[pousr]_[A-Za-z0-9]{20,}/],
  ['private_key_assignment', /PRIVATE_KEY\s*[:=]\s*["']?[A-Za-z0-9+/=_-]{24,}/i],
  ['api_key_assignment', /API_KEY\s*[:=]\s*["']?[A-Za-z0-9+/=_-]{24,}/i],
  ['password_or_token_assignment', /(?:PASSWORD|TOKEN)\s*[:=]\s*["']?[A-Za-z0-9+/=_-]{24,}/i],
];
const findings = [];
const excludedDirectories = ['.git (GitHub Pages deployment metadata, not an artifact)'];
const siteFiles = [];

function walk(dir, base, skip, output, collector = findings) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(base, full).split(sep).join('/');
    if (entry.isSymbolicLink()) {
      collector.push('SYMLINK_BLOCKED:' + rel);
      continue;
    }
    if (entry.isDirectory()) {
      if (skip.has(entry.name)) continue;
      walk(full, base, skip, output, collector);
    } else if (entry.isFile()) {
      output.push({ path: rel, full, size: lstatSync(full).size });
    } else {
      collector.push('NON_REGULAR_ARTIFACT_BLOCKED:' + rel);
    }
  }
  return output;
}

if (!existsSync(coreRoot)) findings.push('PRIVATE_CORE_ROOT_UNAVAILABLE');
walk(root, root, new Set(['.git']), siteFiles);
for (let i = siteFiles.length - 1; i >= 0; i--) {
  if (generatedLocalOnly.has(siteFiles[i].path)) siteFiles.splice(i, 1);
}
const coreHashes = new Set();
let coreSourceFiles = 0;
if (existsSync(coreRoot)) {
  const coreFiles = walk(coreRoot, coreRoot, skipCoreDirs, [], []);
  for (const file of coreFiles) {
    if (!implementationExt.has(extname(file.path).toLowerCase())) continue;
    coreHashes.add(createHash('sha256').update(readFileSync(file.full)).digest('hex'));
    coreSourceFiles++;
  }
}

const privateCoreMatches = [];
let secretFindings = 0;
for (const file of siteFiles) {
  const ext = extname(file.path).toLowerCase();
  if (forbiddenExt.has(ext)) findings.push('FORBIDDEN_FILE_TYPE:' + file.path);
  if (/(?:session-audit|private-evidence|production-key|host-inventory|validator-credentials)/i.test(file.path)) {
    findings.push('FORBIDDEN_PRIVATE_PATH:' + file.path);
  }
  const bytes = readFileSync(file.full);
  if (implementationExt.has(ext)) {
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (coreHashes.has(digest)) privateCoreMatches.push(file.path);
  }
  if (!bytes.includes(0)) {
    const text = bytes.toString('utf8');
    for (const [category, pattern] of secretPatterns) {
      if (pattern.test(text)) {
        findings.push('SECRET_PATTERN:' + file.path + ':' + category);
        secretFindings++;
      }
    }
  }
}

for (const path of privateCoreMatches) findings.push('PRIVATE_CORE_SOURCE_HASH_MATCH:' + path);
const htmlFiles = siteFiles.filter(file => extname(file.path).toLowerCase() === '.html');
let externalRuntimeAssets = 0;
let externalRuntimeRequests = 0;
for (const file of htmlFiles) {
  const html = readFileSync(file.full, 'utf8');
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["'](https?:[^"']+)["'][^>]*>/gi)) {
    if (/<script/i.test(match[0]) || /stylesheet/i.test(match[0])) externalRuntimeAssets++;
  }
}
for (const file of siteFiles) {
  const ext = extname(file.path).toLowerCase();
  if (!['.js', '.mjs', '.cjs', '.css'].includes(ext)) continue;
  const bytes = readFileSync(file.full);
  if (bytes.includes(0)) continue;
  const source = bytes.toString('utf8');
  if (['.js', '.mjs', '.cjs'].includes(ext) && /\b(?:fetch|WebSocket|EventSource|XMLHttpRequest)\s*\(\s*["']https?:/i.test(source)) externalRuntimeRequests++;
  if (ext === '.css' && /@import\s+(?:url\()?["']?https?:|url\(\s*["']?https?:/i.test(source)) externalRuntimeRequests++;
}
if (externalRuntimeAssets) findings.push('EXTERNAL_SCRIPT_OR_STYLESHEET:' + externalRuntimeAssets);
if (externalRuntimeRequests) findings.push('EXTERNAL_RUNTIME_REQUEST:' + externalRuntimeRequests);

const hasForbiddenPrivateSource = siteFiles.some(file => ['.go', '.rs'].includes(extname(file.path).toLowerCase()));
const privateCoreIncluded = hasForbiddenPrivateSource || privateCoreMatches.length > 0;
const checks = [
  { id: 'no_private_core_source', result: privateCoreIncluded ? 'FAIL' : 'PASS', source_files_compared: coreSourceFiles, exact_matches: privateCoreMatches.length },
  { id: 'no_secret_material_patterns', result: secretFindings ? 'FAIL' : 'PASS', matches: secretFindings },
  { id: 'no_external_runtime_assets', result: externalRuntimeAssets ? 'FAIL' : 'PASS', matches: externalRuntimeAssets },
  { id: 'no_external_runtime_requests', result: externalRuntimeRequests ? 'FAIL' : 'PASS', matches: externalRuntimeRequests },
  { id: 'no_private_evidence_or_credentials', result: findings.some(item => /PRIVATE_PATH|FORBIDDEN_FILE_TYPE/.test(item)) ? 'FAIL' : 'PASS' },
  { id: 'deployment_tree_symlinks_blocked', result: findings.some(item => item.startsWith('SYMLINK_BLOCKED:')) ? 'FAIL' : 'PASS' },
  { id: 'local_audit_outputs_documented', result: 'PASS' },
];
const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const isTracked = path => {
  try { execFileSync('git', ['-C', root, 'ls-files', '--error-unmatch', '--', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); return true; }
  catch { return false; }
};
const review = {
  schema: 'agentchain-publication-security-review/2',
  generated_at: new Date().toISOString(),
  scope: 'actual local Pray4Love worktree; no publication performed',
  external_network_used: false,
  remote_repository_accessed: false,
  settlement_enabled: false,
  private_core_source_files_compared: coreSourceFiles,
  private_core_included: privateCoreIncluded,
  files_scanned: siteFiles.length,
  html_files: htmlFiles.length,
  excluded_deployment_metadata: excludedDirectories,
  excluded_local_audit_outputs: [...generatedLocalOnly.entries()].map(([path, reason]) => ({ path, reason })),
  checks,
  findings,
  publication_authorized: false,
};
if (findings.length) {
  writeFileSync(reviewPath, JSON.stringify({ ...review, result: 'BLOCKED' }, null, 2) + '\n', { mode: 0o600 });
  console.error('PUBLICATION_AUDIT=BLOCKED findings=' + findings.length);
  for (const finding of findings) console.error(finding);
  process.exit(1);
}

const rows = siteFiles.map(file => ({
  path: file.path,
  sha256: createHash('sha256').update(readFileSync(file.full)).digest('hex'),
  size_bytes: file.size,
  repository_state: isTracked(file.path) ? 'TRACKED_WORKTREE_FILE' : 'UNTRACKED_LOCAL_FILE',
  distribution: 'REVIEW_BEFORE_PUBLICATION',
})).sort((a, b) => a.path.localeCompare(b.path));
const manifest = {
  schema: 'agentchain-publication-manifest/2',
  generated_at: new Date().toISOString(),
  candidate_root: root,
  source_git_branch: git(['branch', '--show-current']),
  source_worktree_dirty: Boolean(git(['status', '--porcelain'])),
  publication_authorized: false,
  private_core_included: privateCoreIncluded,
  files: rows,
};
const body = JSON.stringify(manifest, null, 2) + '\n';
writeFileSync(manifestPath, body, { mode: 0o600 });
writeFileSync(checksumPath, createHash('sha256').update(body).digest('hex') + '  PUBLICATION_MANIFEST.json\n', { mode: 0o600 });
writeFileSync(reviewPath, JSON.stringify({ ...review, result: 'PASS' }, null, 2) + '\n', { mode: 0o600 });
console.log('PUBLICATION_AUDIT=PASS files=' + rows.length + ' html=' + htmlFiles.length + ' private_core_included=' + privateCoreIncluded + ' exact_core_hash_matches=0 external_runtime_assets=0 external_runtime_requests=0');
