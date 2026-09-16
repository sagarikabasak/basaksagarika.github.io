import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, sections } from './build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-markdown-test-'));
const routes = ['home','about','research','publications','talks','teaching','service','cv','contact'];
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const destination = name => path.join(workspace, name);
const pagePath = route => route === 'home' ? 'index.html' : `${route}/index.html`;
const baseline = build({destination:destination('baseline')});
const baselineHtml = route => fs.readFileSync(path.join(baseline.destination,pagePath(route)), 'utf8');
const readBuilt = (result,route) => fs.readFileSync(path.join(result.destination,pagePath(route)), 'utf8');
const replaceSection = (source, name, replacement) => source.replace(new RegExp(`(^## ${name}\\n)[\\s\\S]*?(?=^## |$(?![\\s\\S]))`, 'm'), `$1\n${replacement}\n\n`);

for (const route of routes) {
  const file = `content/${route}.md`;
  const changed = replaceSection(read(file), 'Page title', `Edited ${route}: atoms & fields, Raúl’s θ — **test**`);
  assert.notEqual(changed, read(file));
  const result = build({destination:destination(route),overrides:{[file]:changed}});
  assert.match(readBuilt(result,route), new RegExp(`Edited ${route}: atoms &amp; fields, Raúl’s θ — <strong>test</strong>`));
  for (const other of routes.filter(r=>r!==route)) assert.equal(readBuilt(result,other),baselineHtml(other), `Unexpected change in ${other}`);
}

const profile = replaceSection(replaceSection(read('content/site.md'),'Name','Example Researcher'),'Email','researcher@example.org');
const shared = build({destination:destination('shared'),overrides:{'content/site.md':profile}});
for (const route of routes) {
  const html = readBuilt(shared,route);
  assert.match(html,/Example Researcher/);
  assert.match(html,/mailto:researcher@example.org/);
  assert.doesNotMatch(html,/Sagarika Basak|basak\.sagarika@gmail\.com/);
}
const nav = build({destination:destination('nav'),overrides:{'content/navigation.md':read('content/navigation.md').replace('[Research]','[Research areas]')}});
for (const route of routes) assert.equal((readBuilt(nav,route).match(/>Research areas<\/a>/g)||[]).length,2);

const biography = sections(read('content/about.md')).get('Biography');
const narrative = build({destination:destination('paragraph'),overrides:{'content/about.md':replaceSection(read('content/about.md'),'Biography',`${biography}\n\nAn extra paragraph with a [research link](/research/#anyons).`)}});
assert.match(readBuilt(narrative,'about'),/<p>An extra paragraph with a <a href="\.\.\/research\/#anyons">research link<\/a>\.<\/p>/);

const publication = build({destination:destination('publication'),overrides:{'content/publications.md':replaceSection(read('content/publications.md'),'Publication 1 URL','https://doi.org/10.1103/example-test')}});
assert.match(readBuilt(publication,'publications'),/class="bib-entry featured" href="https:\/\/doi.org\/10.1103\/example-test"/);
assert.throws(()=>build({destination:destination('invalid'),overrides:{'content/about.md':read('content/about.md').replace('## Page title','## Renamed accidentally')}}), /keep the "## Page title" heading/);
assert.throws(()=>build({destination:destination('unsafe'),overrides:{'content/publications.md':replaceSection(read('content/publications.md'),'Publication 1 URL','javascript:alert(1)')}}), /must be one plain URL/);

for (const base of ['https://example.github.io/', 'https://example.github.io/research-portfolio/']) {
  for (const route of routes) {
    const current = new URL(route === 'home' ? '' : `${route}/`,base);
    const html = baselineHtml(route);
    assert.equal((html.match(/<h1(?:\s|>)/g)||[]).length,1);
    assert.doesNotMatch(html,/<script|<pre|under review|in preparation|arXiv:.*XXXX/i);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
    assert.equal(new Set(ids).size,ids.length,`${route}: duplicate ids`);
    for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      const href = match[1].replaceAll('&amp;','&');
      const url = new URL(href,current);
      if (url.origin !== current.origin) continue;
      assert.ok(url.pathname.startsWith(new URL(base).pathname),`Escaped project prefix: ${href}`);
      const local = decodeURIComponent(url.pathname.slice(new URL(base).pathname.length));
      const target = path.join(baseline.destination,local.endsWith('/') ? local+'index.html' : local || 'index.html');
      assert.ok(fs.existsSync(target),`${route}: missing ${target}`);
      if (url.hash && target.endsWith('.html')) assert.ok(fs.readFileSync(target,'utf8').includes(`id="${decodeURIComponent(url.hash.slice(1))}"`),`${route}: missing ${url.hash}`);
    }
  }
}
assert.equal((baselineHtml('publications').match(/class="bib-entry/g)||[]).length,5);
assert.equal(fs.readFileSync(path.join(baseline.destination,'files/Sagarika-Basak-CV.pdf')).compare(fs.readFileSync(path.join(root,'public/files/Sagarika-Basak-CV.pdf'))),0);
console.log('PASS: nine isolated page edits, shared profile/navigation, Markdown paragraphs/links, publication URL, invalid-input checks, root/project links, five publications, unchanged PDF.');
console.log(`Temporary test builds: ${workspace}`);
