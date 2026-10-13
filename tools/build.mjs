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
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const C = require(join(ROOT, 'js/pascha-core.js'));

const args = process.argv.slice(2);
const argVal = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const NOW = argVal('--now') ? Date.parse(argVal('--now')) : Date.now();
const CHECK = args.includes('--check');
const OUT = argVal('--out') ? join(process.cwd(), argVal('--out')) : ROOT;
if (Number.isNaN(NOW)) { console.error('Неверная дата в --now'); process.exit(1); }

const site = JSON.parse(readFileSync(join(ROOT, 'data/site.json'), 'utf8'));
const i18n = JSON.parse(readFileSync(join(ROOT, 'data/i18n.json'), 'utf8'));
const LANGS = Object.keys(site.languages).filter((k) => !k.startsWith('_'));
const PAGES = Object.fromEntries(Object.entries(site.pages).filter(([k]) => !k.startsWith('_')));
const state = C.getState(site, NOW);
const { esc, fmt } = C;
const changed = [];

/* ── утилиты ─────────────────────────────────────────────── */

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
<link rel="stylesheet" href="${rel}css/style.css">
<script>document.documentElement.classList.add('js')</script>`;
  if (opts.jsonld) h += `\n<script type="application/ld+json">\n${JSON.stringify(opts.jsonld, null, 2)}\n</script>`;
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
/** Событие — только при утверждённом расписании и только если оно ещё впереди на момент сборки. Время окончания не указывается: оно не утверждено. */
function eventsLd(lang) {
  if (state.mode === 'unsupported' || state.schedule.status !== 'confirmed' || !state.serviceStartMs || state.serviceStartMs <= NOW) return [];
  const t = i18n[lang];
  const off = C.offsetAt(state.serviceStartMs, site.timezone) / 60000;
  const local = new Date(state.serviceStartMs + off * 60000).toISOString().slice(0, 16);
  const sign = off >= 0 ? '+' : '-';
  const tzStr = `${sign}${String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')}:${String(Math.abs(off) % 60).padStart(2, '0')}`;
  return [{
    '@type': 'Event',
    name: `${t.status.serviceLabel} ${state.year}`,
    startDate: `${local}:00${tzStr}`,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: { '@id': `${site.siteUrl}/#church` },
    organizer: { '@id': `${site.siteUrl}/#church` },
    description: ['midnight_office', 'procession', 'matins', 'liturgy'].map((k) => t.types[k].name).join(', ')
  }];
}

/* ── шапка и подвал ──────────────────────────────────────── */

function langSwitch(file, lang, id, cls) {
  const t = i18n[lang];
  const page = PAGES[id] || {};
  return LANGS.map((l) => {
    const L = site.languages[l];
    if (l === lang) return `<a href="${urlOf(file)}" lang="${L.hreflang}" class="${cls}active" aria-current="page">${L.short}</a>`;
    if (page[l]) return `<a href="${urlOf(page[l])}" lang="${L.hreflang}" hreflang="${L.hreflang}"${cls ? ` class="${cls.trim()}"` : ''} title="${esc(L.label)}">${L.short}</a>`;
    return `<a href="${urlOf(PAGES.home[l])}" lang="${L.hreflang}" hreflang="${L.hreflang}" class="${cls}lang-fallback" aria-label="${esc(fmt(t.ui.notTranslatedAria, { label: L.label }))}" title="${esc(fmt(t.ui.notTranslatedAria, { label: L.label }))}">${L.short}</a>`;
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
      <span class="nav-logo__cross" aria-hidden="true">☩</span>
      <span class="nav-logo__text">${esc(t.meta.brand.split(' · ')[0])}<span class="nav-logo__sub">pasha.lt</span></span>
    </a>
    <ul class="nav-links">
      ${items.map((n) => `<li>${a(n)}</li>`).join('\n      ')}
    </ul>
    <div class="nav-right">
      <div class="lang-switcher" role="group" aria-label="${esc(t.ui.langNav)}">
        ${langSwitch(file, lang, id, '')}
      </div>
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
  <a href="${site.church.website}" target="_blank" rel="noopener" class="btn btn--outline">⛪ ${esc(t.ui.churchSite)}<span class="visually-hidden"> ${esc(t.ui.external)}</span></a>
</div>`;
}

function footer(file, lang, id) {
  const t = i18n[lang], c = site.church, a = c.address;
  const year = new Date(NOW).getUTCFullYear();
  const pages = lang === 'ru' ? i18n.ru.mobileNav.filter((n) => n.page !== 'home').map((n) => ({ href: urlOf(PAGES[n.page].ru), label: n.label })) : navItems(lang, false);
  return `<div class="footer-inner">
  <div class="footer-grid">
    <div>
      <p class="footer-brand"><span class="footer-brand__cross" aria-hidden="true">☩</span> <span class="footer-brand__name">${esc(t.meta.brand)}</span></p>
      <p class="footer-desc">${esc(t.footer.desc)}</p>
      <a href="${c.website}" target="_blank" rel="noopener" class="footer-hram-link"><span aria-hidden="true">⛪</span> ${esc(t.ui.churchSite)}<span class="visually-hidden"> ${esc(t.ui.external)}</span></a>
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
        <li><a href="${c.scheduleUrl}" target="_blank" rel="noopener">${esc(t.ui.fullSchedule)}<span class="visually-hidden"> ${esc(t.ui.external)}</span></a></li>
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
<button type="button" class="scroll-top" aria-label="${esc(t.ui.toTop)}" title="${esc(t.ui.toTop)}">↑</button>`;
}

function scripts(file, lang) {
  const rel = relRoot(file);
  return ['js/data/site-data.' + lang + '.js', 'js/pascha-core.js', 'js/pascha-runtime.js', 'js/navigation.js', 'js/animations.js']
    .map((s) => `<script src="${rel}${s}" defer></script>`).join('\n');
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
    route: C.renderRoute(ctx)
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
    <div class="section-header">
      <span class="section-tag">${esc(h.cardsTag)}</span>
      <h2 class="section-title" id="cards-heading">${esc(h.cardsTitle)}</h2>
    </div>
    <div class="pages-grid">
      ${h.cards.map((c) => `<div class="glass-card"><div class="glass-card__body"><span class="glass-card__icon" aria-hidden="true">${c.icon}</span><h3 class="glass-card__title">${esc(c.title)}</h3><p class="glass-card__text">${esc(c.text)}</p></div></div>`).join('\n      ')}
    </div>
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
  <div class="hero-content">
    <div class="hero-cross-wrap" aria-hidden="true">
      <div class="hero-cross-halo"></div>
      <div class="hero-cross"><svg viewBox="0 0 60 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><rect x="24" y="0" width="12" height="80" rx="3"/><rect x="0" y="18" width="60" height="12" rx="3"/></svg></div>
    </div>
    ${C.renderHero(ctx)}
  </div>
</section>
${C.renderCountdown(ctx)}
<section class="section section--violet" id="schedule" aria-labelledby="schedule-heading">
  <div class="container">
    ${C.renderSchedule(ctx)}
  </div>
</section>
<section class="section" aria-label="${esc(h.troparionTag)}">
  <div class="container--narrow">
    <figure class="silent-word">
      <div class="silent-word__icon" aria-hidden="true">🕯️</div>
      <blockquote class="silent-word__text">${h.troparion}</blockquote>
      <figcaption class="silent-word__verse">— ${esc(h.troparionTag)}</figcaption>
    </figure>
  </div>
</section>${cards}
${C.renderRoute(ctx)}
<section class="section cta-final" aria-labelledby="closing-heading">
  <div class="container--narrow cta-final__inner">
    <h2 class="cta-final__title" id="closing-heading">${esc(h.closingTitle)}</h2>
    <p class="cta-final__text">${esc(h.closingText)}</p>
    <div class="cta-final__actions">
      <a href="${site.church.website}" target="_blank" rel="noopener" class="btn btn--gold">⛪ ${esc(t.ui.churchSite)}<span class="visually-hidden"> ${esc(t.ui.external)}</span></a>
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
<link rel="stylesheet" href="css/style.css">
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
  const pick = { timezone: site.timezone, calendar: site.calendar, church: site.church, scheduleTemplates: site.scheduleTemplates, schedules: site.schedules, languages: site.languages };
  for (const l of LANGS) {
    const t = i18n[l];
    const strings = { status: t.status, announce: t.announce, countdown: t.countdown, schedule: t.schedule, types: t.types, route: t.route, ui: t.ui };
    write(`js/data/site-data.${l}.js`, `/* Генерируется командой node tools/build.mjs из data/site.json и data/i18n.json. Не редактировать вручную. */\nwindow.PASHA_DATA = ${JSON.stringify({ site: pick, lang: l, t: strings })};\n`);
  }
}

/* ── запуск ──────────────────────────────────────────────── */

for (const [id, p] of Object.entries(PAGES)) {
  for (const l of LANGS) {
    if (!p[l]) continue;
    if (id === 'home' && l !== 'ru') buildLangHome(l);
    else buildRegionPage(p[l]);
  }
}
buildRoot();
buildSitemap();
buildData();

const when = new Date(NOW).toISOString();
console.log(`pasha.lt: сборка на ${when}; режим ${state.mode}${state.pascha ? `, Пасха ${C.iso(state.pascha)}, расписание: ${state.schedule.status}` : ''}`);
console.log(changed.length ? `${CHECK ? 'Изменились бы' : 'Обновлены'}: ${changed.join(', ')}` : 'Изменений нет.');
