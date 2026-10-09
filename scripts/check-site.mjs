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
  'assets/og-agentchain.png'
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
    let target = normalize(join(dirname(file), path));
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

for (const path of ['sovereign-city/qualification.json', 'sovereign-city/runtime.json', 'site.webmanifest']) {
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

if (failures.length) {
  console.error(failures.map((message) => `- ${message}`).join('\n'));
  process.exit(1);
}
console.log(`SITE_CHECKS=PASS html=${htmlFiles.length} required_assets=${required.length}`);
