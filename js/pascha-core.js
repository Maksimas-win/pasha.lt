/**
 * pascha-core.js — календарная логика и отрисовка изменяемых блоков pasha.lt
 *
 * Один и тот же код работает:
 *   • при сборке (Node: tools/build.mjs) — пишет актуальный HTML в файлы;
 *   • в браузере (js/pascha-runtime.js) — пересчитывает режим по текущей дате.
 * Данные: data/site.json + data/i18n.json (в браузер попадают через js/site-data.js).
 * Без зависимостей. Даты в календаре — объекты {y, m, d} (m: 1–12).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PashaCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY = 86400000;

  /* ── Календарные даты ─────────────────────────────────────── */

  function ymd(y, m, d) { return { y: y, m: m, d: d }; }
  function toUTC(o) { return Date.UTC(o.y, o.m - 1, o.d); }
  function fromUTC(ms) { var t = new Date(ms); return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
  function addDays(o, n) { return fromUTC(toUTC(o) + n * DAY); }
  function iso(o) { return o.y + '-' + pad(o.m) + '-' + pad(o.d); }
  function parseIso(s) { var p = String(s).split('-'); return ymd(+p[0], +p[1], +p[2]); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /**
   * Православная Пасха: юлианская пасхалия (формула Гаусса для юлианского календаря),
   * перевод в григорианский календарь прибавлением 13 дней.
   * Разница 13 дней верна с 1 марта 1900 по 28 февраля 2100, поэтому алгоритм
   * применяется только к 1900–2099; вне диапазона возвращается null.
   */
  function orthodoxPascha(year, overrides) {
    if (overrides && overrides[year]) return parseIso(overrides[year]);
    if (year < 1900 || year > 2099) return null;
    var a = year % 4, b = year % 7, c = year % 19;
    var d = (19 * c + 15) % 30;
    var e = (2 * a + 4 * b - d + 34) % 7;
    var month = Math.floor((d + e + 114) / 31);
    var day = ((d + e + 114) % 31) + 1;
    return addDays(ymd(year, month, day), 13);
  }

  /** Западная Пасха (григорианская пасхалия, алгоритм Мееуса/Джонса/Бутчера). */
  function westernEaster(year) {
    var a = year % 19, b = Math.floor(year / 100), c = year % 100;
    var d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    var g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4), k = c % 4;
    var l = (32 + 2 * e + 2 * i - h - k) % 7;
    var m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31);
    var day = ((h + l - 7 * m + 114) % 31) + 1;
    return ymd(year, month, day);
  }

  /* ── Часовой пояс ─────────────────────────────────────────── */

  var dtfCache = {};
  function partsIn(ms, tz) {
    var f = dtfCache[tz] || (dtfCache[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric'
    }));
    var out = {};
    f.formatToParts(new Date(ms)).forEach(function (p) { if (p.type !== 'literal') out[p.type] = +p.value; });
    if (out.hour === 24) out.hour = 0;
    return out;
  }
  /** Смещение пояса tz от UTC (мс) в момент ms. */
  function offsetAt(ms, tz) {
    var p = partsIn(ms, tz);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
  }
  /** Местное время (дата + "ЧЧ:ММ") в поясе tz → момент UTC (мс). Учитывает переход на летнее/зимнее время. */
  function zonedToUtc(date, time, tz) {
    var t = String(time || '00:00').split(':');
    var local = Date.UTC(date.y, date.m - 1, date.d, +t[0], +t[1]);
    var guess = local - offsetAt(local, tz);
    var second = local - offsetAt(guess, tz);
    return second;
  }
  /** Календарная дата в поясе tz для момента ms. */
  function localDate(ms, tz) { var p = partsIn(ms, tz); return ymd(p.year, p.month, p.day); }

  /* ── Расписание ───────────────────────────────────────────── */

  function getSchedule(site, year, pascha) {
    var entry = (site.schedules && site.schedules[String(year)]) || null;
    var status = entry && entry.status === 'confirmed' ? 'confirmed' : 'pending';
    var res = { year: year, status: status, source: entry ? entry.source || '' : '', groups: [] };
    if (status !== 'confirmed') return res;
    var items = entry.items || (site.scheduleTemplates[entry.template || 'standard'] || {}).items || [];
    var exceptions = entry.exceptions || {};
    var groups = {}, order = [], lastDay = 0;
    items.forEach(function (raw) {
      var it = Object.assign({}, raw, exceptions[raw.type + '@' + raw.group] || {});
      if (it.skip) return;
      if (typeof it.day === 'number') lastDay = it.day;
      var g = groups[it.group];
      if (!g) { g = groups[it.group] = { id: it.group, day: lastDay, date: addDays(pascha, lastDay), items: [] }; order.push(g); }
      var item = { type: it.type, time: it.time || null, until: it.until || null, serviceStart: !!it.serviceStart };
      if (it.time) item.startMs = zonedToUtc(addDays(pascha, lastDay), it.time, site.timezone);
      g.items.push(item);
    });
    res.groups = order;
    return res;
  }

  /* ── Состояние сайта на момент now ────────────────────────── */

  /**
   * Режимы:
   *   'A' — подготовка: от начала периода приглашения до начала службы (или до дня Пасхи);
   *   'B' — пасхальные дни: от начала службы (или 00:00 дня Пасхи) до конца дня Отдания;
   *   'C' — остальное время: просветительская главная и дата следующей Пасхи;
   *   'unsupported' — год вне поддерживаемого диапазона.
   */
  function getState(site, nowMs) {
    var tz = site.timezone, cal = site.calendar;
    var today = localDate(nowMs, tz);
    var year = today.y;
    var info = cycle(site, year);
    if (info && nowMs >= info.otdanieEndMs) { year += 1; info = cycle(site, year); }
    var range = cal.supportedYears;
    if (!info || year < range.from || year > range.to) {
      return { mode: 'unsupported', year: year, nowMs: nowMs };
    }
    var sched = getSchedule(site, year, info.pascha);
    var serviceStartMs = null;
    sched.groups.forEach(function (g) { g.items.forEach(function (i) { if (i.serviceStart) serviceStartMs = i.startMs; }); });
    var countdown = serviceStartMs
      ? { kind: 'service', targetMs: serviceStartMs }
      : { kind: 'feast', targetMs: info.paschaStartMs };
    var mode;
    if (nowMs < info.inviteStartMs) mode = 'C';
    else if (nowMs < countdown.targetMs) mode = 'A';
    else mode = 'B';
    var paschaDayEndMs = zonedToUtc(addDays(info.pascha, 1), '00:00', tz);
    return {
      mode: mode,
      nowMs: nowMs,
      year: year,
      pascha: info.pascha,
      paschaStartMs: info.paschaStartMs,
      otdanie: info.otdanie,
      otdanieEndMs: info.otdanieEndMs,
      inviteStartMs: info.inviteStartMs,
      western: westernEaster(year),
      schedule: sched,
      serviceStartMs: serviceStartMs,
      countdown: mode === 'A' ? countdown : null,
      serviceInProgress: mode === 'B' && nowMs < info.paschaStartMs,
      // Расписание показываем, пока не закончился день Пасхи
      scheduleRelevant: nowMs < paschaDayEndMs
    };
  }

  function cycle(site, year) {
    var cal = site.calendar, tz = site.timezone;
    var p = orthodoxPascha(year, cal.paschaOverrides);
    if (!p) return null;
    var otdanie = addDays(p, cal.otdanieDaysAfter);
    return {
      pascha: p,
      otdanie: otdanie,
      paschaStartMs: zonedToUtc(p, '00:00', tz),
      otdanieEndMs: zonedToUtc(addDays(otdanie, 1), '00:00', tz),
      inviteStartMs: zonedToUtc(addDays(p, -cal.invitationStartDaysBefore), '00:00', tz)
    };
  }

  /* ── Форматирование ───────────────────────────────────────── */

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmt(str, vars) {
    return String(str)
      .replace(/\{(\w+)\}/g, function (m, k) { return vars && k in vars ? vars[k] : m; })
      .replace(/\.\./g, '.'); // «2027 г.» + «.» в конце фразы
  }
  function fmtDate(o, locale, opts) {
    var o2 = Object.assign({ timeZone: 'UTC' }, opts);
    return new Intl.DateTimeFormat(locale, o2).format(new Date(toUTC(o)));
  }
  function dateLong(o, locale) { return fmtDate(o, locale, { day: 'numeric', month: 'long', year: 'numeric' }); }
  function dateWeekday(o, locale) { return fmtDate(o, locale, { weekday: 'long', day: 'numeric', month: 'long' }); }
  function dateWeekdayYear(o, locale) { return fmtDate(o, locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  /* ── Отрисовка регионов ───────────────────────────────────── */
  // ctx = { site, t (строки языка), lang, locale, base ('/ru/'), state }

  function wrap(region, state, inner, tag, attrs) {
    tag = tag || 'div';
    return '<' + tag + ' data-region="' + region + '" data-mode="' + state.mode + '"' + (attrs ? ' ' + attrs : '') + '>' + inner + '</' + tag + '>';
  }

  function serviceInfo(ctx) {
    var s = ctx.state, sched = s.schedule;
    var start = null;
    sched.groups.forEach(function (g) { g.items.forEach(function (i) { if (i.serviceStart) start = { date: g.date, time: i.time }; }); });
    return start;
  }

  function renderHero(ctx) {
    var s = ctx.state, t = ctx.t.status, L = ctx.locale, h = '';
    var westernLine = '';
    if (s.mode !== 'unsupported' && s.mode !== 'B') {
      var same = iso(s.western) === iso(s.pascha);
      westernLine = '<p class="hero-note">' + esc(same
        ? fmt(t.westernSame, { year: s.year })
        : fmt(t.westernDiff, { year: s.year, date: dateLong(s.western, L) })) + ' ' + esc(t.julianNote) + '</p>';
    }
    var ctas = '<div class="hero-cta-wrap">';
    if (s.mode === 'B' && ctx.meaningHref) {
      ctas += '<a href="' + ctx.meaningHref + '" class="btn btn--gold">' + esc(t.ctaMeaning) + '</a>';
    } else {
      ctas += '<a href="' + ctx.scheduleHref + '" class="btn btn--gold">' + esc(t.ctaSchedule) + '</a>';
    }
    ctas += '<a href="#route" class="btn btn--outline">' + esc(t.ctaRoute) + '</a></div>';

    if (s.mode === 'unsupported') {
      h = '<h1 class="hero-title hero-title--feast" id="hero-title">' + t.feastTitle + '</h1>' +
          '<div class="hero-divider" aria-hidden="true"></div>' +
          '<p class="hero-note">' + esc(t.unsupported) + '</p>' + ctas;
      return wrap('hero', s, h);
    }
    if (s.mode === 'B') {
      h = '<p class="hero-eyebrow">' + esc(t.eyebrowPaschal) + '</p>' +
          '<h1 class="hero-title" id="hero-title">' + t.greetingTitle + '</h1>' +
          '<p class="hero-subtitle">' + esc(t.greetingReply) + '</p>' +
          '<div class="hero-divider" aria-hidden="true"></div>' +
          (s.serviceInProgress ? '<p class="hero-service-text">' + esc(t.inProgress) + '</p>' : '') +
          '<p class="hero-note">' + esc(fmt(t.paschalLine, { date: dateLong(s.otdanie, L) })) + '</p>' + ctas;
      return wrap('hero', s, h);
    }
    var eyebrow = s.mode === 'A' ? fmt(t.eyebrowUpcoming, { date: dateLong(s.pascha, L) }) : t.eyebrowNext;
    var info;
    var start = serviceInfo(ctx);
    if (s.mode === 'C') {
      info = '<p class="hero-service-date">' + esc(cap(dateWeekdayYear(s.pascha, L))) + '</p>';
      if (start) info += '<p class="hero-service-text">' + esc(t.serviceLabel) + ': ' + esc(fmt(t.serviceLine, { satDate: dateWeekday(start.date, L), time: start.time })) + '</p>';
      else info += '<p class="hero-service-text">' + esc(t.pendingLabel) + ' ' + esc(t.pendingLine) + '.</p>';
    } else if (start) {
      info = '<p class="hero-service-date">' + esc(t.serviceLabel) + '</p>' +
             '<p class="hero-service-text">' + esc(cap(fmt(t.serviceLine, { satDate: dateWeekday(start.date, L), time: start.time }))) + '</p>';
    } else {
      info = '<p class="hero-service-date">' + esc(t.pendingLabel) + '</p>' +
             '<p class="hero-service-text">' + esc(cap(t.pendingLine)) + '.</p>';
    }
    h = '<p class="hero-eyebrow">' + esc(eyebrow) + '</p>' +
        '<h1 class="hero-title hero-title--feast" id="hero-title">' + t.feastTitle + '</h1>' +
        '<div class="hero-divider" aria-hidden="true"></div>' +
        '<div class="hero-service-info">' + info + '</div>' + westernLine + ctas;
    return wrap('hero', s, h);
  }

  function renderAnnounce(ctx) {
    var s = ctx.state, t = ctx.t.announce, L = ctx.locale, txt = '';
    if (s.mode === 'unsupported') return wrap('announce', s, '', 'div', 'class="announcement-bar" hidden');
    var start = serviceInfo(ctx);
    if (s.mode === 'B') txt = fmt(t.paschal, { date: esc(dateLong(s.otdanie, L)) });
    else if (s.mode === 'A' && start) txt = fmt(t.confirmed, { satDate: esc(dateWeekday(start.date, L)), time: esc(start.time), church: esc(ctx.site.church.names[ctx.lang]) });
    else if (s.mode === 'A') txt = fmt(t.pending, { date: esc(dateLong(s.pascha, L)) });
    else txt = fmt(t.next, { date: esc(dateLong(s.pascha, L)) });
    return wrap('announce', s, txt, 'div', 'class="announcement-bar"');
  }

  function renderCountdown(ctx) {
    var s = ctx.state, t = ctx.t.countdown, L = ctx.locale;
    if (s.mode !== 'A' || !s.countdown) return wrap('countdown', s, '');
    var target, start = serviceInfo(ctx);
    if (s.countdown.kind === 'service' && start) {
      target = fmt(t.targetService, { date: dateWeekdayYear(start.date, L), time: start.time });
    } else {
      target = fmt(t.targetFeast, { date: dateWeekdayYear(s.pascha, L) });
    }
    var unit = function (k) {
      return '<div class="countdown-item"><span class="countdown-item__number" data-countdown="' + k + '">00</span>' +
             '<span class="countdown-item__label">' + esc(t[k]) + '</span></div>';
    };
    var h = '<section class="section" aria-labelledby="countdown-heading"><div class="container">' +
      '<div class="section-header"><span class="section-tag">' + esc(s.countdown.kind === 'service' ? t.tagService : t.tagFeast) + '</span>' +
      '<h2 class="section-title" id="countdown-heading">' + esc(t.title) + '</h2></div>' +
      '<div class="countdown" data-countdown-box data-target="' + s.countdown.targetMs + '" data-kind="' + s.countdown.kind + '" role="timer" aria-label="' + esc(t.aria) + '" hidden>' +
      unit('days') + unit('hours') + unit('minutes') + unit('seconds') + '</div>' +
      '<p class="countdown-target" data-countdown-msg>' + esc(cap(target)) + '</p>' +
      '</div></section>';
    return wrap('countdown', s, h);
  }

  function scheduleCards(ctx) {
    var s = ctx.state, t = ctx.t.schedule, types = ctx.t.types, L = ctx.locale;
    var icons = { food_blessing: '🧺', midnight_office: '🕯️', procession: '✝', matins: '☩', liturgy: '☦', typika: '☀️' };
    var titles = { saturday: t.saturday, night: t.night, sunday: t.sunday };
    var out = '<div class="schedule-grid">';
    s.schedule.groups.forEach(function (g) {
      var main = g.id === 'night';
      var dateLabel = main ? fmt(t.nightDate, { satDate: cap(dateWeekday(g.date, L)), sunDate: dateWeekday(addDays(g.date, 1), L) }) : cap(dateWeekdayYear(g.date, L));
      out += '<div class="schedule-card' + (main ? ' schedule-card--main' : '') + '">' +
        '<div class="schedule-card__header"><p class="schedule-card__date">' + esc(dateLabel) + '</p>' +
        '<h3 class="schedule-card__title">' + esc(titles[g.id] || g.id) + '</h3></div><div class="schedule-card__body">';
      g.items.forEach(function (it, idx) {
        var time = it.time
          ? (it.until ? fmt(t.range, { from: it.time, to: it.until }) : it.time)
          : (idx === 0 ? '' : (g.id === 'night' ? t.then : t.after));
        var ty = types[it.type] || { name: it.type, note: '' };
        out += '<div class="schedule-item"><span class="schedule-item__icon" aria-hidden="true">' + (icons[it.type] || '•') + '</span>' +
          '<span class="schedule-item__time">' + esc(time) + '</span>' +
          '<p class="schedule-item__text"><strong>' + esc(ty.name) + '</strong>' + (ty.note ? ' — ' + esc(ty.note) : '') + '</p></div>';
      });
      out += '</div></div>';
    });
    return out + '</div>';
  }

  function renderSchedule(ctx) {
    var s = ctx.state, t = ctx.t.schedule, site = ctx.site;
    var head = function (title) {
      return '<div class="section-header"><span class="section-tag">' + esc(t.tag) + '</span>' +
        '<h2 class="section-title" id="schedule-heading">' + esc(title) + '</h2>' +
        '<p class="section-lead">' + esc(site.church.names[ctx.lang]) + '</p></div>';
    };
    var contact = '<p class="notice-card__contact">' + fmt(esc(t.contact), {
      phone: '<a href="tel:' + site.church.phoneE164 + '">' + esc(site.church.phone) + '</a>'
    }) + '</p>';
    var more = '<div class="schedule-more"><a href="' + site.church.scheduleUrl + '" target="_blank" rel="noopener" class="btn btn--outline">' +
      esc(ctx.t.ui.fullSchedule) + ' →<span class="visually-hidden"> ' + esc(ctx.t.ui.external) + '</span></a></div>';
    var h;
    if (s.mode === 'unsupported') return wrap('schedule', s, '');
    if (s.mode === 'B' && !s.scheduleRelevant) {
      h = head(t.paschalTitle) + '<div class="notice-card"><p>' + esc(t.paschalText) + '</p></div>' + more;
    } else if (s.schedule.status === 'confirmed') {
      h = head(fmt(t.title, { year: s.year })) + scheduleCards(ctx) +
        '<p class="schedule-status">' + esc(t.confirmedNote) + '</p>' + more;
    } else {
      h = head(fmt(t.title, { year: s.year })) +
        '<div class="notice-card" role="status"><h3 class="notice-card__title">' + esc(t.pendingTitle) + '</h3>' +
        '<p>' + esc(fmt(t.pendingText, { year: s.year })) + '</p>' + contact + '</div>' + more;
    }
    return wrap('schedule', s, h);
  }

  /** Короткая строка об освящении пищи (страница «Почему мы освящаем пищу»). */
  function renderBlessing(ctx) {
    var s = ctx.state, L = ctx.locale, t = ctx.t;
    if (s.mode === 'unsupported') return wrap('blessing', s, '');
    if (s.schedule.status !== 'confirmed' || (s.mode === 'B' && !s.scheduleRelevant)) {
      return wrap('blessing', s, '<p>' + esc(fmt(t.schedule.pendingText, { year: s.year })) + '</p>');
    }
    var lines = [];
    s.schedule.groups.forEach(function (g) {
      var prev = null;
      g.items.forEach(function (it) {
        if (it.type === 'food_blessing') {
          var when = it.time
            ? (it.until ? fmt(t.schedule.range, { from: it.time, to: it.until }) : it.time)
            : (prev ? t.schedule.after + ' — ' + (t.types[prev.type] || {}).name : '');
          lines.push('<li><strong>' + esc(cap(dateWeekdayYear(g.date, L))) + '</strong> — ' + esc(when) + '</li>');
        }
        prev = it;
      });
    });
    return wrap('blessing', s, '<ul class="plain-list">' + lines.join('') + '</ul>');
  }

  function renderRoute(ctx) {
    var c = ctx.site.church, a = c.address, t = ctx.t.route;
    var full = a.street + ', ' + a.locality + ', ' + a.postalCode + ', ' + a.eldership + ', ' + a.municipality + ', ' + a.country;
    var maps = 'https://www.google.com/maps/dir/?api=1&amp;destination=' + c.geo.lat + '%2C' + c.geo.lng;
    return '<section class="section section--violet route" id="route" aria-labelledby="route-heading" data-region="route"><div class="container--narrow">' +
      '<div class="section-header"><span class="section-tag">' + esc(t.tag) + '</span>' +
      '<h2 class="section-title" id="route-heading">' + esc(t.title) + '</h2></div>' +
      '<div class="route-card">' +
      '<p class="route-card__church">' + esc(c.names[ctx.lang]) + '</p>' +
      '<address class="route-card__address" data-address>' + esc(a.street) + '<br>' + esc(a.postalCode + ' ' + a.locality) + '<br>' +
      esc(a.eldership + ', ' + a.municipality) + '<br>' + esc(a.country) + '</address>' +
      '<p class="route-card__place">' + esc(t.place) + '</p>' +
      '<div class="route-card__actions">' +
      '<a class="btn btn--gold" href="' + maps + '" target="_blank" rel="noopener">' + esc(t.directions) + '<span class="visually-hidden"> ' + esc(ctx.t.ui.external) + '</span></a>' +
      '<a class="btn btn--outline" href="tel:' + c.phoneE164 + '">' + esc(t.call) + ': ' + esc(c.phone) + '</a>' +
      '<button type="button" class="btn btn--ghost" data-copy-address="' + esc(full) + '" data-copied="' + esc(t.copied) + '" data-copy-fail="' + esc(t.copyFail) + '" hidden>' + esc(t.copy) + '</button>' +
      '</div><p class="route-card__note">' + esc(t.mapNote) + '</p>' +
      '<p class="route-card__status" data-copy-status role="status" aria-live="polite"></p>' +
      '</div></div></section>';
  }

  return {
    orthodoxPascha: orthodoxPascha, westernEaster: westernEaster,
    addDays: addDays, iso: iso, parseIso: parseIso, toUTC: toUTC,
    zonedToUtc: zonedToUtc, offsetAt: offsetAt, localDate: localDate,
    getSchedule: getSchedule, getState: getState,
    esc: esc, fmt: fmt, dateLong: dateLong, dateWeekday: dateWeekday, dateWeekdayYear: dateWeekdayYear, cap: cap,
    renderHero: renderHero, renderAnnounce: renderAnnounce, renderCountdown: renderCountdown,
    renderSchedule: renderSchedule, renderBlessing: renderBlessing, renderRoute: renderRoute
  };
});
