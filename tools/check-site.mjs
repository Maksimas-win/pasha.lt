#!/usr/bin/env node
/**
 * tools/check-site.mjs — проверка готового сайта без браузера и без сети.
 *   node tools/check-site.mjs
 *
 * Проверяет: внутренние ссылки и якоря, взаимность hreflang, canonical, html lang,
 * уникальность title/description, sitemap (нет 404 и лишних страниц),
 * отсутствие следов старой даты (11/12 апреля 2026), незаполненных регионов и вечной «Загрузки».
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = JSON.parse(readFileSync(join(ROOT, 'data/site.json'), 'utf8'));
const errors = [], warnings = [];
const err = (f, m) => errors.push(`${f}: ${m}`);

const IGNORE = new Set(['preview.html']); // старая служебная страница, закрыта в robots.txt
function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n.startsWith('.') || n === 'node_modules' || n === 'tools' || n === 'docs') return [];
    return statSync(p).isDirectory() ? walk(p) : (p.endsWith('.html') ? [relative(ROOT, p)] : []);
  });
}
const files = walk(ROOT).filter((f) => !IGNORE.has(f));
const html = Object.fromEntries(files.map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]));
const fileForUrl = (u) => {
  let p = u.replace(/^https:\/\/pasha\.lt/, '').split('#')[0].split('?')[0];
  if (!p.startsWith('/')) return null;
  if (p.endsWith('/')) p += 'index.html';
  return p.slice(1);
};
const ids = (s) => new Set([...s.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const attr = (s, re) => [...s.matchAll(re)].map((m) => m[1]);

const titles = {}, descs = {};
for (const [f, s] of Object.entries(html)) {
  // Регионы заполнены
  for (const m of s.matchAll(/<!-- @region ([\w-]+) -->\s*<!-- @\/region \1 -->/g)) err(f, `пустой регион «${m[1]}» — запустите node tools/build.mjs`);
  if (/Загрузка расписания/.test(s)) err(f, 'остался блок «Загрузка расписания…»');
  if (/11 апреля|12 апреля|11\/12|balandžio 11|April 11|11 kwietnia|11 квітня|11\. April|2026-04-1[12]/.test(s)) err(f, 'остались даты Пасхи 2026');
  if (/includes\.js/.test(s)) err(f, 'ссылка на удалённый includes.js');
  // lang, title, description, canonical
  const lang = (s.match(/<html lang="([^"]+)"/) || [])[1];
  if (!lang) err(f, 'нет html lang');
  const title = (s.match(/<title>([^<]+)<\/title>/) || [])[1];
  const desc = (s.match(/<meta name="description" content="([^"]+)"/) || [])[1];
  if (!title) err(f, 'нет title'); else (titles[title] ||= []).push(f);
  if (!desc) err(f, 'нет description'); else (descs[desc] ||= []).push(f);
  const canon = (s.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
  if (!canon) err(f, 'нет canonical');
  else if (fileForUrl(canon) !== f) err(f, `canonical указывает на ${canon}`);
  // Ссылки
  for (const href of attr(s, /\shref="([^"]+)"/g)) {
    if (/^(https?:)?\/\//.test(href) && !href.startsWith('https://pasha.lt')) continue;
    if (/^(mailto|tel):/.test(href)) continue;
    let target, hash = href.includes('#') ? href.split('#')[1] : '';
    if (href.startsWith('#')) target = f;
    else if (href.startsWith('/') || href.startsWith('https://pasha.lt')) target = fileForUrl(href);
    else target = relative(ROOT, join(ROOT, dirname(f), href.split('#')[0])) || f;
    if (target.endsWith('/') || target === '') target += 'index.html';
    if (!existsSync(join(ROOT, target))) { err(f, `битая ссылка ${href}`); continue; }
    if (hash && html[target] && !ids(html[target]).has(hash)) err(f, `нет якоря #${hash} на ${target}`);
  }
  for (const src of attr(s, /\ssrc="([^"]+)"/g)) {
    if (/^https?:/.test(src)) continue;
    if (!existsSync(join(ROOT, dirname(f), src))) err(f, `нет файла ${src}`);
  }
  // hreflang: взаимность
  const alts = [...s.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)];
  for (const [, hl, url] of alts) {
    const t = fileForUrl(url);
    if (!t || !existsSync(join(ROOT, t))) { err(f, `hreflang ${hl} → несуществующая ${url}`); continue; }
    if (t !== f && html[t] && !html[t].includes(`href="${canon}"`)) err(f, `hreflang ${hl} → ${url} без обратной ссылки`);
  }
  // id уникальны
  const all = [...s.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = all.filter((x, i) => all.indexOf(x) !== i);
  if (dup.length) err(f, `повторяющиеся id: ${[...new Set(dup)].join(', ')}`);
}
for (const [t, fs] of Object.entries(titles)) if (fs.length > 1) err(fs.join(', '), `одинаковый title «${t}»`);
for (const [d, fs] of Object.entries(descs)) if (fs.length > 1) err(fs.join(', '), 'одинаковый description');

// sitemap
const sm = readFileSync(join(ROOT, 'sitemap.xml'), 'utf8');
const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
for (const u of locs) if (!existsSync(join(ROOT, fileForUrl(u)))) err('sitemap.xml', `нет страницы ${u}`);
for (const u of [...sm.matchAll(/href="([^"]+)"/g)].map((m) => m[1])) if (!existsSync(join(ROOT, fileForUrl(u)))) err('sitemap.xml', `hreflang на несуществующую ${u}`);
for (const f of files) if (!locs.includes('https://pasha.lt/' + f.replace(/index\.html$/, ''))) err('sitemap.xml', `страница ${f} не включена`);
const robots = readFileSync(join(ROOT, 'robots.txt'), 'utf8');
if (!/Sitemap: https:\/\/pasha\.lt\/sitemap\.xml/.test(robots)) err('robots.txt', 'нет ссылки на sitemap');

console.log(`Проверено страниц: ${files.length}, адресов в sitemap: ${locs.length}`);
if (warnings.length) console.log('Предупреждения:\n  ' + warnings.join('\n  '));
if (errors.length) { console.error('Ошибки:\n  ' + errors.join('\n  ')); process.exit(1); }
console.log('Ошибок нет.');
