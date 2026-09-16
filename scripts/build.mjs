import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from '../vendor/marked.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROUTES = ['home', 'about', 'research', 'publications', 'talks', 'teaching', 'service', 'cv', 'contact'];
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

// Content is repository-owned, but HTML is deliberately disabled in the editor
// files so an accidental tag cannot break the layout. No browser JS is emitted.
const md = new Marked({ gfm: false, breaks: false, renderer: {
  html({ text }) { return escape(text); },
  link({ href, title, tokens }) {
    if (!/^(https?:\/\/|mailto:|#|\/|\.\.?\/)/i.test(href)) throw new Error(`Unsupported link: ${href}`);
    return `<a href="${escape(href)}"${title ? ` title="${escape(title)}"` : ''}>${this.parser.parseInline(tokens)}</a>`;
  },
}});

export function sections(source, filename = 'Markdown') {
  const result = new Map();
  const matches = [...source.replaceAll('\r\n', '\n').matchAll(/^## (.+)$/gm)];
  const normalized = source.replaceAll('\r\n', '\n');
  for (let i = 0; i < matches.length; i++) {
    const name = matches[i][1].trim();
    if (result.has(name)) throw new Error(`${filename}: duplicate heading "${name}"`);
    result.set(name, normalized.slice(matches[i].index + matches[i][0].length, matches[i + 1]?.index ?? normalized.length).trim());
  }
  return result;
}

function required(values, name, file) {
  if (!values.has(name) || !values.get(name).trim()) throw new Error(`${file}: keep the "## ${name}" heading and give it some text.`);
  return values.get(name);
}

export function build({ destination = path.join(ROOT, 'dist'), overrides = {} } = {}) {
  const get = relative => overrides[relative] ?? read(relative);
  const profile = sections(get('content/site.md'), 'content/site.md');
  const profileValue = name => required(profile, name, 'content/site.md');
  if (!/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(profileValue('Email'))) throw new Error('content/site.md: enter a plain email address.');
  for (const field of ['Scholar URL', 'ORCID URL']) {
    if (!/^https:\/\//.test(profileValue(field))) throw new Error(`content/site.md: ${field} must be an https URL.`);
  }
  if (!/^\/files\/[A-Za-z0-9._-]+\.pdf$/.test(profileValue('CV file'))) throw new Error('content/site.md: CV file must be /files/your-file.pdf.');
  const nav = [...get('content/navigation.md').matchAll(/^- \[([^\]]+)\]\((\/[^)]*)\)\s*$/gm)].map(m => ({label:m[1], href:m[2]}));
  if (nav.length !== 8 || new Set(nav.map(n => n.href)).size !== 8) throw new Error('content/navigation.md must contain eight unique page links.');
  for (const entry of nav) if (!ROUTES.slice(1).some(route => entry.href === `/${route}/`)) throw new Error(`Unknown navigation destination: ${entry.href}`);
  const generated = new Map();
  for (const route of ROUTES) {
    const file = `content/${route}.md`;
    const values = sections(get(file), file);
    const used = new Set();
    const resolveProfile = text => text.replace(/\{\{profile:([^}]+)\}\}/g, (_, name) => profileValue(name));
    const value = name => { used.add(name); return resolveProfile(required(values, name, file)); };
    const links = (entries, utility = false) => entries.map(({label, href}) => {
      const active = href === `/${route}/`;
      const classes = [active ? 'active' : '', utility && href === '/contact/' ? 'contact-utility' : ''].filter(Boolean).join(' ');
      return `<a href="${escape(href)}"${active ? ' aria-current="page"' : ''}${classes ? ` class="${classes}"` : ''}>${escape(label)}</a>`;
    }).join('');
    const mainNav = nav.filter(n => !['/cv/','/contact/'].includes(n.href));
    const utilityNav = nav.filter(n => ['/cv/','/contact/'].includes(n.href));
    const fragments = {
      header: get('templates/header.html'), footer: get('templates/footer.html'), page: get(`templates/pages/${route}.html`),
    };
    let html = get('templates/layout.html').replace(/\{\{include:(header|footer|page)\}\}/g, (_, name) => fragments[name]);
    html = html.replace(/\{\{nav:(primary|utilities|mobile)\}\}/g, (_, name) => name === 'primary' ? links(mainNav) : name === 'utilities' ? links(utilityNav, true) : links(nav));
    html = html.replace('{{main:class}}', route === 'home' ? '' : ' class="dedicated-page"');
    html = html.replace(/\{\{meta:(title|description)\}\}/g, (_, name) => escape(value(name === 'title' ? 'Browser title' : 'Search description')));
    html = html.replace(/\{\{(inline|block|url):([^}]+)\}\}/g, (_, mode, name) => {
      const input = value(name);
      if (mode === 'url') {
        if (!/^(https?:\/\/|mailto:|\/|#)/.test(input) || /[\s<>"']/.test(input)) throw new Error(`${file}: ${name} must be one plain URL.`);
        return escape(input);
      }
      return mode === 'block' ? md.parse(input).trim() : md.parseInline(input);
    });
    html = html.replace(/\{\{profile:([^}]+)\}\}/g, (_, name) => escape(profileValue(name)));
    // All site-local references are page-relative, so no username/repository
    // configuration is needed for account sites, project sites, or custom domains.
    const prefix = route === 'home' ? './' : '../';
    html = html.replace(/\b(href|src)="\/(?!\/)([^"]*)"/g, (_, attr, url) => `${attr}="${prefix}${url}"`);
    if (/\{\{(?:include|inline|block|url|meta|nav|profile|main):/.test(html)) throw new Error(`Unresolved template field in ${route}`);
    for (const name of values.keys()) if (!used.has(name)) throw new Error(`${file}: unknown heading "## ${name}"; edit an existing field, or extend the template for a new section.`);
    if ((html.match(/<h1(?:\s|>)/g) ?? []).length !== 1) throw new Error(`${file}: page must have one main heading.`);
    generated.set(route === 'home' ? 'index.html' : `${route}/index.html`, html);
  }
  // Do not delete caller-owned files or the repository; only overwrite the
  // known build files. The deployment job uses a fresh checkout each time.
  fs.mkdirSync(destination, { recursive: true });
  for (const [relative, html] of generated) {
    const target = path.join(destination, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, html);
  }
  fs.cpSync(path.join(ROOT, 'public'), destination, { recursive: true });
  fs.writeFileSync(path.join(destination, '.nojekyll'), '');
  return { destination, pages: generated.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = build(); console.log(`Built ${result.pages} pages in ${result.destination}`); }
  catch (error) { console.error(`Build stopped: ${error.message}`); process.exitCode = 1; }
}
