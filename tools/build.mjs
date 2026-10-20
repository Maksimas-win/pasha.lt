#!/usr/bin/env node
/**
 * tools/build.mjs — сборка pasha.lt из единого источника данных.
 *
 *   node tools/build.mjs                 — собрать по текущей дате
 *   node tools/build.mjs --now 2027-04-30T12:00:00+03:00   — собрать «как будто» на эту дату (проверка)
 *   node tools/build.mjs --check         — ничего не записывать, только показать, какие файлы изменились бы
 *
 * Что делает:
 *   • заполняет в HTML блоки между <!-- @region имя --> и <!-- @/region имя -->;
 *   • целиком генерирует главные страницы lt/en/pl/ukr/de, корневую index.html, sitemap.xml;
 *   • пишет js/data/site-data.<язык>.js — данные для пересчёта режима в браузере.
 * Зависимостей нет (Node 18+).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { scriptJSON } from './lib/script-json.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const C = require(join(ROOT, 'js/pascha-core.js'));

const args = process.argv.slice(2);
const argVal = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const NOW = argVal('--now') ? Date.parse(argVal('--now')) : Date.now();
const CHECK = args.includes('--check');
const OUT = argVal('--out') ? resolve(process.cwd(), argVal('--out')) : ROOT;
if (Number.isNaN(NOW)) { console.error('Неверная дата в --now'); process.exit(1); }

const site = JSON.parse(readFileSync(join(ROOT, 'data/site.json'), 'utf8'));
const parishSnapshot = join(ROOT, 'data/parish-schedule.json');
if (existsSync(parishSnapshot)) site.parishSchedule = JSON.parse(readFileSync(parishSnapshot, 'utf8'));
const i18n = JSON.parse(readFileSync(join(ROOT, 'data/i18n.json'), 'utf8'));
const LANGS = Object.keys(site.languages).filter((k) => !k.startsWith('_'));
const PAGES = Object.fromEntries(Object.entries(site.pages).filter(([k]) => !k.startsWith('_')));
const state = C.getState(site, NOW);
const { esc, fmt } = C;
const changed = [];

/* ── утилиты ─────────────────────────────────────────────── */

/** Метка версии файла (по содержимому): браузер сразу берёт новую версию стилей и скриптов. */
const verCache = {};
function ver(path) {
  if (!(path in verCache)) {
    const full = join(OUT, path);
    const src = existsSync(full) ? full : join(ROOT, path);
    verCache[path] = createHash('sha1').update(readFileSync(src)).digest('hex').slice(0, 8);
  }
  return verCache[path];
}
const asset = (rel, path) => `${rel}${path}?v=${ver(path)}`;

const urlOf = (file) => '/' + file.replace(/index\.html$/, '');
const absUrl = (file) => site.siteUrl + urlOf(file);
const relRoot = (file) => '../'.repeat(file.split('/').length - 1);

function pageOf(file) {
  for (const [id, p] of Object.entries(PAGES)) for (const l of LANGS) if (p[l] === file) return { id, lang: l };
  return null;
}
function ctxFor(lang, extra = {}) {
  return { site, lang, t: i18n[lang], locale: site.languages[lang].locale, state, scheduleHref: '#schedule', meaningHref: null, ...extra };
}
function write(file, content) {
  if (file.endsWith('.html')) {
    // Один и тот же HTML работает в корне pasha.lt и в папке проекта GitHub Pages.
    // Абсолютные canonical/hreflang и внешние ссылки сохраняют свой адрес.
    const prefix = relRoot(file);
    content = content.replace(/(\s(?:href|src|data-(?:meaning|schedule)-href))="\/(?!\/)([^"]*)"/g,
      (_, attr, target) => `${attr}="${prefix + target || './'}"`);
  }
  const path = join(OUT, file);
  const old = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (old === content) return;
  changed.push(file);
  if (CHECK) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}
function replaceRegions(html, regions, file) {
  return html.replace(/(<!-- @region ([\w-]+) -->)[\s\S]*?(<!-- @\/region \2 -->)/g, (m, open, name, close) => {
    if (!(name in regions)) throw new Error(`${file}: неизвестный регион «${name}»`);
    return `${open}\n${regions[name]}\n${close}`;
  });
}

/* ── head ────────────────────────────────────────────────── */

function headBlock(file, lang, id, title, description, opts = {}) {
  const L = site.languages[lang];
  const page = PAGES[id];
  const rel = relRoot(file);
  let h = `<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#1a0a0e">
<link rel="canonical" href="${absUrl(file)}">`;
  const langsHere = page ? LANGS.filter((l) => page[l]) : [];
  if (langsHere.length > 1) {
    for (const l of langsHere) h += `\n<link rel="alternate" hreflang="${site.languages[l].hreflang}" href="${absUrl(page[l])}">`;
    if (id === 'home') h += `\n<link rel="alternate" hreflang="x-default" href="${site.siteUrl}/">`;
  }
  h += `
<meta property="og:type" content="website">
<meta property="og:site_name" content="pasha.lt">
<meta property="og:url" content="${absUrl(file)}">
<meta property="og:title" content="${esc(opts.ogTitle || title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${site.siteUrl}/images/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(i18n[lang].meta.ogImageAlt)}">
<meta property="og:locale" content="${L.og}">`;
  for (const l of langsHere) if (l !== lang) h += `\n<meta property="og:locale:alternate" content="${site.languages[l].og}">`;
  h += `
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${rel}images/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="${rel}manifest.json">
<link rel="preload" href="${rel}fonts/spectral-light.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${rel}fonts/manrope-var.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${asset(rel, 'css/style.css')}">
<script>document.documentElement.classList.add('js')</script>`;
  if (opts.jsonld) h += `\n<script type="application/ld+json">\n${scriptJSON(opts.jsonld)}\n</script>`;
  return h;
}

function churchLd(lang) {
  const c = site.church, a = c.address;
  return {
    '@type': 'Church',
    '@id': `${site.siteUrl}/#church`,
    name: c.names[lang],
    url: c.website,
    telephone: c.phoneE164,
    address: { '@type': 'PostalAddress', streetAddress: a.street, addressLocality: a.locality, postalCode: a.postalCode, addressRegion: a.municipality, addressCountry: a.countryCode },
    geo: { '@type': 'GeoCoordinates', latitude: c.geo.lat, longitude: c.geo.lng }
  };
}
/** Только явно опубликованное или утверждённое начало службы. Время окончания не выдумывается. */
function eventsLd(lang) {
  if (state.mode === 'unsupported' || !['confirmed', 'published'].includes(state.schedule.status) || !state.serviceStartMs || state.serviceStartMs <= NOW) return [];
  const t = i18n[lang];
  const publishedNight = (state.schedule.events || []).find(event => event.kind === 'paschal-night');
  const off = C.offsetAt(state.serviceStartMs, site.timezone) / 60000;
  const local = new Date(state.serviceStartMs + off * 60000).toISOString().slice(0, 16);
  const sign = off >= 0 ? '+' : '-';
  const tzStr = `${sign}${String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')}:${String(Math.abs(off) % 60).padStart(2, '0')}`;
  return [{
    '@type': 'Event',
    name: publishedNight ? publishedNight.title[lang] : `${t.status.serviceLabel} ${state.year}`,
    startDate: `${local}:00${tzStr}`,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: { '@id': `${site.siteUrl}/#church` },
    organizer: { '@id': `${site.siteUrl}/#church` },
    description: publishedNight ? publishedNight.title[lang] : ['midnight_office', 'procession', 'matins', 'liturgy'].map((k) => t.types[k].name).join(', ')
  }];
}

/* ── шапка и подвал ──────────────────────────────────────── */

/** Восьмиконечный крест — знак сайта (линии, без заливки). */
const CROSS = '<svg class="mark" viewBox="0 0 24 32" aria-hidden="true" focusable="false"><path d="M12 1.5v29M8.5 5.5h7M4.5 11h15M7.5 22.5l9-3"/></svg>';
const ICON = {
  calendar: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  pin: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>',
  phone: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 3.5l2.6 3.6-1.7 2.3a12 12 0 0 0 7.1 7.1l2.3-1.7 3.6 2.6-1.5 2.6c-.4.6-1 .9-1.7.9C9.8 20.9 3.1 14.2 3.1 6.7c0-.7.3-1.3.9-1.7z"/></svg>',
  share: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/></svg>',
  globe: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.5 3.5 5.3 3.5 8.5s-1.1 6-3.5 8.5c-2.4-2.5-3.5-5.3-3.5-8.5s1.1-6 3.5-8.5z"/></svg>',
  play: '<svg class="icon icon--play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  pause: '<svg class="icon icon--pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5.5v13M15.5 5.5v13"/></svg>'
};

function langSwitch(file, lang, id, cls, long = false) {
  const t = i18n[lang];
  const page = PAGES[id] || {};
  return LANGS.map((l) => {
    const L = site.languages[l];
    if (l === lang) return `<a href="${urlOf(file)}" lang="${L.hreflang}" class="${cls}active" aria-current="page">${long ? L.label : L.short}</a>`;
    if (page[l]) return `<a href="${urlOf(page[l])}" lang="${L.hreflang}" hreflang="${L.hreflang}"${cls ? ` class="${cls.trim()}"` : ''} title="${esc(L.label)}">${long ? L.label : L.short}</a>`;
    return `<a href="${urlOf(PAGES.home[l])}" lang="${L.hreflang}" hreflang="${L.hreflang}" class="${cls}lang-fallback" aria-label="${esc(fmt(t.ui.notTranslatedAria, { label: L.label }))}" title="${esc(fmt(t.ui.notTranslatedAria, { label: L.label }))}">${long ? L.label : L.short}</a>`;
  }).join('\n        ');
}

function navItems(lang, mobile) {
  const t = i18n[lang];
  if (lang === 'ru') {
    return (mobile ? t.mobileNav : t.nav).map((n) => ({ href: urlOf(PAGES[n.page].ru), label: n.label, page: n.page }));
  }
  const home = urlOf(PAGES.home[lang]);
  return [
    { href: home, label: t.ui.home, page: 'home' },
    { href: home + '#schedule', label: t.ui.schedule },
    { href: home + '#route', label: t.ui.route },
    { href: '/ru/', label: t.ui.ruMaterials, hreflang: 'ru' }
  ];
}

function header(file, lang, id) {
  const t = i18n[lang];
  const ctx = ctxFor(lang);
  const items = navItems(lang, false), mItems = navItems(lang, true);
  const cur = urlOf(file);
  const a = (n, extra = '') => `<a href="${n.href}"${n.hreflang ? ` hreflang="${n.hreflang}" lang="${n.hreflang}"` : ''}${n.href === cur ? ' class="active" aria-current="page"' : ''}${extra}>${esc(n.label)}</a>`;
  const fallbackNote = (PAGES[id] && LANGS.some((l) => !PAGES[id][l])) ? `\n  <p class="lang-note">${esc(t.ui.notTranslatedNote)}</p>` : '';
  return `<a href="#main-content" class="skip-nav">${esc(t.ui.skip)}</a>
${C.renderAnnounce(ctx)}
<nav aria-label="${esc(t.ui.mainNav)}">
  <div class="nav-inner">
    <a href="${urlOf(PAGES.home[lang])}" class="nav-logo" aria-label="${esc(t.ui.homeAria)}">
      ${CROSS}
      <span class="nav-logo__text">${esc(t.meta.brand.split(' · ')[0])}<span class="nav-logo__sub">pasha.lt</span></span>
    </a>
    <ul class="nav-links">
      ${items.map((n) => `<li>${a(n)}</li>`).join('\n      ')}
    </ul>
    <div class="nav-right">
      <details class="lang-menu">
        <summary aria-label="${esc(t.ui.langNav)}">${ICON.globe}<span>${site.languages[lang].short}</span></summary>
        <div class="lang-menu__list" role="group" aria-label="${esc(t.ui.langNav)}">
        ${langSwitch(file, lang, id, '', true)}
        </div>
      </details>
      <button type="button" class="hamburger" aria-label="${esc(t.ui.menuOpen)}" aria-expanded="false" aria-controls="mobile-menu">
        <span></span><span></span><span></span>
      </button>
    </div>
  </div>
</nav>
<div class="mobile-menu" id="mobile-menu">
  <nav aria-label="${esc(t.ui.mobileNav)}">
    ${mItems.map((n) => a(n)).join('\n    ')}
  </nav>
  <div class="mobile-lang" role="group" aria-label="${esc(t.ui.langNav)}">
    ${langSwitch(file, lang, id, 'btn btn--ghost ')}
  </div>${fallbackNote}
  <a href="${site.church.website}" target="_blank" rel="noopener" class="btn btn--outline">${esc(t.ui.churchSite)}<span class="visually-hidden"> ${esc(t.ui.external)}</span></a>
</div>`;
}

function footer(file, lang, id) {
  const t = i18n[lang], c = site.church, a = c.address;
  const year = new Date(NOW).getUTCFullYear();
  const pages = lang === 'ru' ? i18n.ru.mobileNav.filter((n) => n.page !== 'home').map((n) => ({ href: urlOf(PAGES[n.page].ru), label: n.label })) : navItems(lang, false);
  return `<div class="footer-inner">
  <div class="footer-grid">
    <div>
      <p class="footer-brand">${CROSS}<span class="footer-brand__name">${esc(t.meta.brand)}</span></p>
      <p class="footer-desc">${esc(t.footer.desc)}</p>
      <a href="${c.website}" target="_blank" rel="noopener" class="footer-hram-link">${esc(t.ui.churchSite)}<span class="visually-hidden"> ${esc(t.ui.external)}</span></a>
    </div>
    <div>
      <h2 class="footer-col-title">${esc(t.footer.pagesTitle)}</h2>
      <ul class="footer-links">
        ${pages.map((n) => `<li><a href="${n.href}"${n.hreflang ? ` hreflang="${n.hreflang}"` : ''}>${esc(n.label)}</a></li>`).join('\n        ')}
      </ul>
    </div>
    <div>
      <h2 class="footer-col-title">${esc(t.footer.churchTitle)}</h2>
      <address class="footer-address">${esc(c.names[lang])}<br>${esc(a.street)}, ${esc(a.postalCode)} ${esc(a.locality)}<br>${esc(a.municipality)}, ${esc(a.country)}<br><a href="tel:${c.phoneE164}">${esc(c.phone)}</a></address>
      <ul class="footer-links">
        <li><a href="${c.website}" target="_blank" rel="noopener">bukiski-hram.net<span class="visually-hidden"> ${esc(t.ui.external)}</span></a></li>
        <li><a href="${c.scheduleUrls?.[lang] || c.scheduleUrl}" target="_blank" rel="noopener">${esc(t.ui.fullSchedule)}<span class="visually-hidden"> ${esc(t.ui.external)}</span></a></li>
      </ul>
    </div>
  </div>
  <div class="footer-bottom">
    <p class="footer-bottom__copy">${esc(fmt(t.footer.copyright, { year, church: c.names[lang] }))}</p>
    <div class="footer-bottom__langs" role="group" aria-label="${esc(t.ui.langNav)}">
      ${LANGS.map((l) => { const L = site.languages[l]; const target = (PAGES[id] && PAGES[id][l]) || PAGES.home[l]; const fb = !(PAGES[id] && PAGES[id][l]); return `<a href="${urlOf(target)}" lang="${L.hreflang}"${l === lang ? ' class="active" aria-current="page"' : (fb ? ` class="lang-fallback" aria-label="${esc(fmt(t.ui.notTranslatedAria, { label: L.label }))}"` : '')}>${L.label}</a>`; }).join('\n      ')}
    </div>${(PAGES[id] && LANGS.some((l) => !PAGES[id][l])) ? `\n    <p class="lang-note lang-note--footer">${esc(t.ui.notTranslatedNote)}</p>` : ''}
  </div>
</div>
<button type="button" class="scroll-top" aria-label="${esc(t.ui.toTop)}" title="${esc(t.ui.toTop)}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg></button>
${quickbar(file, lang)}
<p class="visually-hidden" data-live-status role="status" aria-live="polite"></p>`;
}

/** Нижняя панель быстрых действий на телефоне. */
function quickbar(file, lang) {
  const t = i18n[lang], home = urlOf(PAGES.home[lang]);
  const hasRoute = readFileSync(join(ROOT, file), 'utf8').includes('@region route') || (PAGES.home[lang] === file);
  const sched = lang === 'ru' ? (file === PAGES.raspisanie.ru ? '#schedule' : urlOf(PAGES.raspisanie.ru) + '#schedule') : home + '#schedule';
  return `<nav class="quickbar" aria-label="${esc(t.ui.quickNav)}">
  <a href="${sched}">${ICON.calendar}<span>${esc(t.ui.schedule)}</span></a>
  <a href="${hasRoute ? '#route' : home + '#route'}">${ICON.pin}<span>${esc(t.ui.route)}</span></a>
  <a href="tel:${site.church.phoneE164}">${ICON.phone}<span>${esc(t.ui.call)}</span></a>
</nav>`;
}

/** Пасхальное приветствие на разных языках (статично; смена — в pascha-runtime.js). */
function greetings(lang) {
  const t = i18n[lang].greet, all = site.greetings.items;
  // Первым показываем приветствие на языке страницы
  const start = Math.max(0, all.findIndex((g) => g.lang === site.languages[lang].hreflang));
  const items = all.slice(start).concat(all.slice(0, start));
  return `<section class="section greet" aria-labelledby="greet-heading" data-greetings>
  <div class="container greet__inner">
    <div class="greet__head">
      <h2 class="section-title" id="greet-heading">${esc(t.title)}</h2>
      <p class="section-lead">${esc(t.lead)}</p>
    </div>
    <div class="greet__stage" aria-live="polite">
      ${items.map((g, i) => `<p class="greet__item" lang="${g.lang}"${g.dir ? ` dir="${g.dir}"` : ''}><span class="greet__g">${esc(g.g)}</span><span class="greet__r">${esc(g.r)}</span></p>`).join('\n      ')}
    </div>
    <div class="greet__controls">
      <button type="button" class="greet__toggle" data-greet-toggle data-label-pause="${esc(t.pause)}" data-label-play="${esc(t.play)}" aria-label="${esc(t.pause)}" hidden>${ICON.pause}${ICON.play}</button>
      <div class="greet__chips" role="group" aria-label="${esc(t.choose)}">
        ${items.map((g, i) => `<button type="button" class="chip" data-greet-index="${i}" lang="${g.lang}" aria-pressed="${i === 0}">${esc(g.name)}</button>`).join('\n        ')}
      </div>
    </div>
  </div>
</section>`;
}

/** Список статей с временем чтения (русская главная). */
function articles(lang) {
  const t = i18n[lang];
  if (!t.articles) return '';
  const ids = ['smysl-pashi', 'put-hrista', 'yavleniya', 'osvyashchenie', 'prorochestva', 'traditsii', 'vpervye'];
  const list = ids.filter((id) => PAGES[id] && PAGES[id][lang]).map((id, i) => {
    const m = t.pages[id];
    const min = readMinutes(PAGES[id][lang]);
    return `<li class="read${i === 0 ? ' read--lead' : ''}"><a href="${urlOf(PAGES[id][lang])}"><span class="read__title">${esc(m.ogTitle)}</span><span class="read__desc">${esc(m.description)}</span><span class="read__meta">${esc(fmt(t.ui.readTime, { n: min }))}</span></a></li>`;
  });
  return `<div class="section-head"><h2 class="section-title" id="articles-heading">${esc(t.articles.title)}</h2><p class="section-lead">${esc(t.articles.lead)}</p></div>
<ul class="reads">
  ${list.join('\n  ')}
</ul>`;
}

/** Время чтения: слова в <main>, без блоков сборки и скриптов, 180 слов в минуту. */
function readMinutes(file) {
  const html = readFileSync(join(ROOT, file), 'utf8');
  const main = (html.split('<main')[1] || '').split('</main>')[0]
    .replace(/<!-- @region ([\w-]+) -->[\s\S]*?<!-- @\/region \1 -->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ');
  const words = main.split(/\s+/).filter((w) => /[\p{L}\d]/u.test(w)).length;
  return Math.max(1, Math.round(words / 180));
}

/** Строка под заголовком статьи: время чтения и «Поделиться». */
function articleMeta(file, lang) {
  const t = i18n[lang];
  return `<p class="page-meta"><span>${esc(fmt(t.ui.readTime, { n: readMinutes(file) }))}</span><button type="button" class="link-btn" data-share data-copied="${esc(t.ui.linkCopied)}" hidden>${ICON.share}${esc(t.ui.share)}</button></p>`;
}

function scripts(file, lang) {
  const rel = relRoot(file);
  return ['js/data/site-data.' + lang + '.js', 'js/pascha-core.js', 'js/pascha-runtime.js', 'js/navigation.js', 'js/animations.js']
    .map((s) => `<script src="${asset(rel, s)}" defer></script>`).join('\n');
}

/* ── страницы ────────────────────────────────────────────── */

function buildRegionPage(file) {
  const { id, lang } = pageOf(file);
  const t = i18n[lang];
  const ctx = ctxFor(lang, { meaningHref: urlOf(PAGES['smysl-pashi'].ru) });
  const isHome = id === 'home';
  const meta = isHome ? { title: t.meta.homeTitle, description: t.meta.homeDescription, ogTitle: t.meta.homeOgTitle } : (t.pages || {})[id];
  if (!meta) throw new Error(`Нет title/description для ${file} в data/i18n.json (${lang}.pages.${id})`);
  const jsonld = (isHome || id === 'raspisanie') ? { '@context': 'https://schema.org', '@graph': [churchLd(lang), ...eventsLd(lang)] } : null;
  const regions = {
    head: headBlock(file, lang, id, meta.title, meta.description, { ogTitle: meta.ogTitle, jsonld }),
    header: header(file, lang, id),
    footer: footer(file, lang, id),
    scripts: scripts(file, lang),
    hero: C.renderHero(ctx),
    countdown: C.renderCountdown(ctx),
    schedule: C.renderSchedule(ctx),
    blessing: C.renderBlessing(ctx),
    route: C.renderRoute(ctx),
    cycle: C.renderCycle(ctx),
    greetings: greetings(lang),
    articles: articles(lang),
    meta: articleMeta(file, lang)
  };
  const html = readFileSync(join(ROOT, file), 'utf8');
  write(file, replaceRegions(html, regions, file));
}

function bodyAttrs(lang, extra = '') {
  return `data-lang="${lang}" data-schedule-href="#schedule"${extra}`;
}

function buildLangHome(lang) {
  const file = PAGES.home[lang];
  const t = i18n[lang], h = t.home;
  const ctx = ctxFor(lang);
  const cards = h.cards ? `
<section class="section" aria-labelledby="cards-heading">
  <div class="container">
    <div class="section-head">
      <h2 class="section-title" id="cards-heading">${esc(h.cardsTitle)}</h2>
    </div>
    <ul class="facts">
      ${h.cards.map((c) => `<li class="fact"><h3 class="fact__title">${esc(c.title)}</h3><p>${esc(c.text)}</p></li>`).join('\n      ')}
    </ul>
  </div>
</section>` : '';
  const html = `<!DOCTYPE html>
<!-- Файл генерируется командой: node tools/build.mjs. Тексты — в data/i18n.json, даты и расписание — в data/site.json. -->
<html lang="${site.languages[lang].hreflang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${headBlock(file, lang, 'home', t.meta.homeTitle, t.meta.homeDescription, { ogTitle: t.meta.homeOgTitle, jsonld: { '@context': 'https://schema.org', '@graph': [churchLd(lang), ...eventsLd(lang)] } })}
</head>
<body ${bodyAttrs(lang)}>
<header id="site-header">
${header(file, lang, 'home')}
</header>
<main id="main-content">
<section class="hero" aria-labelledby="hero-title">
  <div class="container">
    ${C.renderHero(ctx)}
  </div>
</section>
${greetings(lang)}
<section class="section section--band" id="schedule" aria-labelledby="schedule-heading">
  <div class="container">
    ${C.renderSchedule(ctx)}
  </div>
</section>
${C.renderCycle(ctx)}
<section class="section" aria-labelledby="troparion-heading">
  <div class="container">
    <figure class="pull">
      <blockquote class="pull__text">${h.troparion}</blockquote>
      <figcaption class="pull__source" id="troparion-heading">${esc(h.troparionTag)}</figcaption>
    </figure>
  </div>
</section>${cards}
${C.renderRoute(ctx)}
<section class="section closing" aria-labelledby="closing-heading">
  <div class="container closing__inner">
    <h2 class="closing__title" id="closing-heading">${esc(h.closingTitle)}</h2>
    <p class="closing__text">${esc(h.closingText)}</p>
    <div class="closing__actions">
      <a href="${site.church.website}" target="_blank" rel="noopener" class="btn btn--gold">${esc(t.ui.churchSite)}<span class="visually-hidden"> ${esc(t.ui.external)}</span></a>
      <a href="/ru/" class="btn btn--outline" hreflang="ru" lang="ru">${esc(h.ruLink)}</a>
    </div>
  </div>
</section>
</main>
<footer id="site-footer">
${footer(file, lang, 'home')}
</footer>
${scripts(file, lang)}
</body>
</html>
`;
  write(file, html);
}

function buildRoot() {
  const file = 'index.html';
  const t = i18n.ru;
  const items = LANGS.map((l) => {
    const L = site.languages[l], s = i18n[l];
    const p = state.mode === 'unsupported' ? '' : `<span class="lang-card__date">${esc(s.status.eyebrowUpcoming.split(' · ')[0])}: ${esc(C.dateLong(state.pascha, L.locale))}</span>`;
    return `<li><a class="lang-card" href="${urlOf(PAGES.home[l])}" lang="${L.hreflang}" hreflang="${L.hreflang}"><span class="lang-card__label">${esc(L.label)}</span><span class="lang-card__intro">${esc(s.root ? s.root.intro : s.meta.homeOgTitle)}</span>${p}</a></li>`;
  }).join('\n      ');
  const html = `<!DOCTYPE html>
<!-- Файл генерируется командой: node tools/build.mjs -->
<html lang="mul">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>pasha.lt — Православная Пасха · Stačiatikių Velykos · Orthodox Easter</title>
<meta name="description" content="Православная Пасха в храме Рождества Христова в Букишкисе. Stačiatikių Velykos Bukiškyje. Orthodox Easter in Bukiškis, Lithuania. Выберите язык · Pasirinkite kalbą · Choose a language.">
<meta name="theme-color" content="#1a0a0e">
<link rel="canonical" href="${site.siteUrl}/">
${LANGS.map((l) => `<link rel="alternate" hreflang="${site.languages[l].hreflang}" href="${absUrl(PAGES.home[l])}">`).join('\n')}
<link rel="alternate" hreflang="x-default" href="${site.siteUrl}/">
<meta property="og:type" content="website">
<meta property="og:url" content="${site.siteUrl}/">
<meta property="og:title" content="pasha.lt — Православная Пасха · Stačiatikių Velykos">
<meta property="og:description" content="Храм Рождества Христова в Букишкисе · Bukiškio Kristaus Gimimo stačiatikių bažnyčia">
<meta property="og:image" content="${site.siteUrl}/images/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="images/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${asset('', 'css/style.css')}">
</head>
<body class="root-page">
<main id="main-content" class="root-choose">
  <div class="root-choose__cross" aria-hidden="true">☩</div>
  <h1 class="root-choose__title">pasha.lt</h1>
  <p class="root-choose__lead" lang="ru">${esc(t.root.choose)} · <span lang="lt">Pasirinkite kalbą</span> · <span lang="en">Choose a language</span></p>
  <nav aria-label="Языки · Kalbos · Languages">
    <ul class="lang-cards">
      ${items}
    </ul>
  </nav>
</main>
</body>
</html>
`;
  write(file, html);
}

function buildSitemap() {
  let x = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Генерируется командой node tools/build.mjs. lastmod — из data/site.json (pages.*.lastmod). -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>${site.siteUrl}/</loc>
    <lastmod>${PAGES.home.lastmod}</lastmod>
  </url>`;
  for (const [id, p] of Object.entries(PAGES)) {
    const langs = LANGS.filter((l) => p[l]);
    for (const l of langs) {
      x += `\n  <url>\n    <loc>${absUrl(p[l])}</loc>\n    <lastmod>${p.lastmod}</lastmod>`;
      if (langs.length > 1) {
        for (const l2 of langs) x += `\n    <xhtml:link rel="alternate" hreflang="${site.languages[l2].hreflang}" href="${absUrl(p[l2])}"/>`;
        if (id === 'home') x += `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${site.siteUrl}/"/>`;
      }
      x += `\n  </url>`;
    }
  }
  x += '\n</urlset>\n';
  write('sitemap.xml', x);
}

function buildData() {
  const pick = { timezone: site.timezone, calendar: site.calendar, church: site.church, scheduleTemplates: site.scheduleTemplates, schedules: site.schedules, parishSchedule: site.parishSchedule, languages: site.languages };
  for (const l of LANGS) {
    const t = i18n[l];
    const strings = { status: t.status, announce: t.announce, countdown: t.countdown, schedule: t.schedule, types: t.types, route: t.route, ui: t.ui, cycle: t.cycle };
    write(`js/data/site-data.${l}.js`, `/* Генерируется командой node tools/build.mjs из data/site.json и data/i18n.json. Не редактировать вручную. */\nwindow.PASHA_DATA = ${JSON.stringify({ site: pick, lang: l, t: strings })};\n`);
  }
}

/* ── запуск ──────────────────────────────────────────────── */

// Сначала данные для браузера: их метки версий нужны страницам
buildData();
for (const [id, p] of Object.entries(PAGES)) {
  for (const l of LANGS) {
    if (!p[l]) continue;
    if (id === 'home' && l !== 'ru') buildLangHome(l);
    else buildRegionPage(p[l]);
  }
}
buildRoot();
buildSitemap();

const when = new Date(NOW).toISOString();
console.log(`pasha.lt: сборка на ${when}; режим ${state.mode}${state.pascha ? `, Пасха ${C.iso(state.pascha)}, расписание: ${state.schedule.status}` : ''}`);
console.log(changed.length ? `${CHECK ? 'Изменились бы' : 'Обновлены'}: ${changed.join(', ')}` : 'Изменений нет.');
