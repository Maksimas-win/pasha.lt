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

  function getSchedule(site, year, pascha, nowMs) {
    var entry = (site.schedules && site.schedules[String(year)]) || null;
    var status = entry && entry.status === 'confirmed' ? 'confirmed' : 'pending';
    var res = { year: year, status: status, source: entry ? entry.source || '' : '', groups: [] };
    // Published calendar entries are independent of the manually approved template.
    // In particular, a night service does not confirm last year's food-blessing hours.
    var snapshot = site.parishSchedule;
    var events = snapshot && Array.isArray(snapshot.events) ? snapshot.events.filter(function (event) {
      return event.feastDate === iso(pascha) || event.date === iso(pascha);
    }) : [];
    if (events.length) {
      var updated = Date.parse(snapshot.sourceUpdatedAt);
      var now = typeof nowMs === 'number' ? nowMs : Date.now();
      var stale = !isFinite(updated) || now - updated > 48 * 3600000 || updated > now + 300000;
      res.status = stale ? 'stale' : 'published';
      res.source = snapshot.sourceURL;
      res.sourceUpdatedAt = snapshot.sourceUpdatedAt;
      res.events = stale ? [] : events.slice().sort(function (a, b) { return Date.parse(a.start) - Date.parse(b.start); });
      return res;
    }
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
    var sched = getSchedule(site, year, info.pascha, nowMs);
    var serviceStartMs = null;
    sched.groups.forEach(function (g) { g.items.forEach(function (i) { if (i.serviceStart) serviceStartMs = i.startMs; }); });
    var publishedNight = (sched.events || []).find(function (event) { return event.kind === 'paschal-night'; });
    if (publishedNight) serviceStartMs = Date.parse(publishedNight.start);
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
  // ctx = { site, t (строки языка), lang, locale, state, scheduleHref, meaningHref }

  function wrap(region, state, inner, tag, attrs) {
    tag = tag || 'div';
    return '<' + tag + ' data-region="' + region + '" data-mode="' + state.mode + '"' + (attrs ? ' ' + attrs : '') + '>' + inner + '</' + tag + '>';
  }

  function serviceInfo(ctx) {
    var s = ctx.state, start = null;
    if (!s.schedule) return null;
    var publishedNight = (s.schedule.events || []).find(function (event) { return event.kind === 'paschal-night'; });
    if (publishedNight) return { date: parseIso(publishedNight.date), time: publishedNight.startTime, ms: Date.parse(publishedNight.start) };
    s.schedule.groups.forEach(function (g) { g.items.forEach(function (i) { if (i.serviceStart) start = { date: g.date, time: i.time, ms: i.startMs }; }); });
    return start;
  }

  function parishScheduleURL(ctx) {
    return (ctx.site.church.scheduleUrls || {})[ctx.lang] || ctx.site.church.scheduleUrl;
  }

  function sourceStamp(ctx) {
    var stamp = ctx.state.schedule.sourceUpdatedAt;
    if (!stamp || !isFinite(Date.parse(stamp))) return '';
    var label = new Intl.DateTimeFormat(ctx.locale, {
      timeZone: ctx.site.timezone, day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }).format(new Date(stamp));
    return '<p class="schedule-status">' + esc(ctx.t.schedule.updatedLabel) + ' <time datetime="' + esc(stamp) + '">' + esc(label) + '</time></p>';
  }

  function publishedSchedule(ctx) {
    var t = ctx.t.schedule;
    var upcoming = (ctx.state.schedule.events || []).filter(function (event) { return Date.parse(event.start) >= ctx.state.nowMs; });
    if (!upcoming.length) return '<div class="notice"><p>' + esc(t.publishedEnded) + '</p></div>';
    return '<p class="section-lead">' + esc(t.publishedIntro) + '</p><ol class="days">' + upcoming.map(function (event) {
      var title = event.title[ctx.lang];
      var note = event.note && event.note[ctx.lang];
      return '<li class="day"><div class="day__head"><h3 class="day__title">' + esc(cap(dateWeekdayYear(parseIso(event.date), ctx.locale))) + '</h3></div>' +
        '<ol class="day__items"><li class="slot"><time class="slot__time" datetime="' + esc(event.start) + '">' + esc(event.startTime) + '</time>' +
        '<p class="slot__text"><strong>' + esc(title) + '</strong>' + (note ? '<span>' + esc(note) + '</span>' : '') + '</p></li></ol></li>';
    }).join('') + '</ol><p class="schedule-status">' + esc(t.publishedNote) + '</p>';
  }

  /** День и месяц отдельно, в нужном падеже: {day: '2', month: 'мая'}. */
  function dayMonth(o, locale) {
    var parts = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', day: 'numeric', month: 'long' }).formatToParts(new Date(toUTC(o)));
    var out = { day: '', month: '' };
    parts.forEach(function (p) { if (p.type === 'day') out.day = p.value; if (p.type === 'month') out.month = p.value; });
    return out;
  }
  function weekday(o, locale) { return fmtDate(o, locale, { weekday: 'long' }); }
  function ymdCompact(o) { return o.y + pad(o.m) + pad(o.d); }
  function utcCompact(ms) { return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }

  function countdownInner(ctx, compact) {
    var s = ctx.state, t = ctx.t.countdown, L = ctx.locale, start = serviceInfo(ctx);
    var target = (s.countdown.kind === 'service' && start)
      ? fmt(t.targetService, { date: dateWeekdayYear(start.date, L), time: start.time })
      : fmt(t.targetFeast, { date: dateWeekdayYear(s.pascha, L) });
    var units = compact ? ['days', 'hours', 'minutes'] : ['days', 'hours', 'minutes', 'seconds'];
    return '<p class="countdown__label">' + esc(s.countdown.kind === 'service' ? t.tagService : t.tagFeast) + '</p>' +
      '<div class="countdown" data-countdown-box data-target="' + s.countdown.targetMs + '" data-kind="' + s.countdown.kind + '" role="timer" aria-label="' + esc(t.aria) + '" hidden>' +
      units.map(function (k) {
        return '<div class="countdown__unit"><span class="countdown__num" data-countdown="' + k + '">00</span><span class="countdown__cap">' + esc(t[k]) + '</span></div>';
      }).join('') + '</div>' +
      '<p class="countdown__target" data-countdown-msg>' + esc(cap(target)) + '</p>';
  }

  function icsButton(ctx) {
    var s = ctx.state, t = ctx.t.status, c = ctx.site.church, a = c.address, start = serviceInfo(ctx);
    var loc = c.names[ctx.lang] + ', ' + a.street + ', ' + a.locality + ', ' + a.country;
    var attrs = start && start.ms > s.nowMs
      ? 'data-ics-start="' + utcCompact(start.ms) + '" data-ics-title="' + esc(t.icsService + ' ' + s.year) + '"'
      : 'data-ics-date="' + ymdCompact(s.pascha) + '" data-ics-title="' + esc(t.icsFeast + ' ' + s.year) + '"';
    return '<button type="button" class="btn btn--ghost" ' + attrs + ' data-ics-location="' + esc(loc) + '" data-ics-file="pascha-' + s.year + '.ics" hidden>' +
      '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M12 13v4M10 15h4"/></svg>' + esc(t.addCal) + '</button>';
  }

  function renderHero(ctx) {
    var s = ctx.state, t = ctx.t.status, L = ctx.locale;
    var ctas = function (primaryHref, primaryLabel) {
      return '<div class="hero__actions"><a href="' + primaryHref + '" class="btn btn--gold">' + esc(primaryLabel) + '</a>' +
        '<a href="#route" class="btn btn--outline">' + esc(t.ctaRoute) + '</a></div>';
    };
    if (s.mode === 'unsupported') {
      return wrap('hero', s, '<div class="hero__text"><h1 class="hero__title" id="hero-title">' + t.feastTitle + '</h1>' +
        '<p class="hero__lead">' + esc(t.unsupported) + '</p>' + ctas(ctx.scheduleHref, t.ctaSchedule) + '</div>', 'div', 'class="hero__grid"');
    }
    var text, panel, start = serviceInfo(ctx);
    var dm = dayMonth(s.pascha, L);
    if (s.mode === 'B') {
      var om = dayMonth(s.otdanie, L);
      text = '<p class="hero__kicker">' + esc(t.eyebrowPaschal) + '</p>' +
        '<h1 class="hero__title hero__title--greeting" id="hero-title">' + t.greetingTitle + '</h1>' +
        '<p class="hero__reply">' + esc(t.greetingReply) + '</p>' +
        '<p class="hero__lead">' + esc(fmt(t.paschalLine, { date: dateLong(s.otdanie, L) })) + '</p>' +
        ctas(ctx.meaningHref || ctx.scheduleHref, ctx.meaningHref ? t.ctaMeaning : t.ctaSchedule);
      panel = '<p class="panel__label">' + esc(t.panelPaschal) + '</p>' +
        '<p class="panel__date"><span class="panel__day">' + esc(fmt(t.panelUntil, { date: om.day })) + '</span> <span class="panel__month">' + esc(om.month) + '</span></p>' +
        '<p class="panel__sub">' + esc(t.panelOtdanie + ', ' + weekday(s.otdanie, L)) + '</p>' +
        (s.serviceInProgress ? '<p class="panel__status panel__status--live">' + esc(t.inProgress) + '</p>' : '');
    } else {
      text = '<p class="hero__kicker">' + esc(fmt(t.kicker, { year: s.year })) + '</p>' +
        '<h1 class="hero__title" id="hero-title">' + t.feastTitle + '</h1>' +
        '<p class="hero__lead">' + esc(t.lead) + '</p>' + ctas(ctx.scheduleHref, t.ctaSchedule);
      var status = start
        ? '<p class="panel__status"><strong>' + esc(t.serviceLabel) + '</strong><br>' + esc(cap(fmt(t.serviceLine, { satDate: dateWeekday(start.date, L), time: start.time }))) + '</p>'
        : s.schedule.status === 'published' ? '<p class="panel__status"><strong>' + esc(t.pendingLabel) + '</strong> ' + esc(t.publishedLine) + '</p>'
        : s.schedule.status === 'stale' ? '<p class="panel__status"><strong>' + esc(ctx.t.schedule.staleTitle) + '</strong> ' + esc(ctx.t.schedule.staleText) + '</p>'
        : '<p class="panel__status"><strong>' + esc(t.pendingLabel) + '</strong> ' + esc(t.pendingLine) + '.</p>';
      var same = iso(s.western) === iso(s.pascha);
      var western = same ? fmt(t.westernSame, { year: s.year }) : fmt(t.westernDiff, { date: dateLong(s.western, L) });
      panel = '<p class="panel__label">' + esc(s.mode === 'A' ? t.panelThis : t.panelNext) + '</p>' +
        '<p class="panel__date"><time datetime="' + iso(s.pascha) + '"><span class="panel__day">' + esc(dm.day) + '</span> <span class="panel__month">' + esc(dm.month) + '</span></time></p>' +
        '<p class="panel__sub">' + esc(cap(weekday(s.pascha, L)) + ', ' + s.year) + '</p>' +
        (s.mode === 'A' && s.countdown ? '<div class="panel__countdown">' + countdownInner(ctx, false) + '</div>' : '') +
        status +
        '<details class="panel__more"><summary>' + esc(western) + '</summary><p>' + esc(t.julianNote) + '</p></details>' +
        '<div class="panel__actions">' + icsButton(ctx) + '</div>';
    }
    return wrap('hero', s, '<div class="hero__text">' + text + '</div><aside class="hero__panel" aria-label="' + esc(t.panelAria) + '">' + panel + '</aside>', 'div', 'class="hero__grid"');
  }

  function renderAnnounce(ctx) {
    var s = ctx.state, t = ctx.t.announce, L = ctx.locale, txt = '';
    if (s.mode === 'unsupported') return wrap('announce', s, '', 'div', 'class="announcement-bar" hidden');
    var start = serviceInfo(ctx);
    if (s.mode === 'B') txt = fmt(t.paschal, { date: esc(dateLong(s.otdanie, L)) });
    else if (s.mode === 'A' && start) txt = fmt(t.confirmed, { satDate: esc(dateWeekday(start.date, L)), time: esc(start.time), church: esc(ctx.site.church.names[ctx.lang]) });
    else if (s.mode === 'A') txt = fmt(t.pending, { date: esc(dateLong(s.pascha, L)) });
    else txt = fmt(t.next, { date: esc(dateLong(s.pascha, L)) });
    return wrap('announce', s, '<p>' + txt + '</p>', 'div', 'class="announcement-bar"');
  }

  /** Отдельный блок отсчёта (страница расписания). */
  function renderCountdown(ctx) {
    var s = ctx.state;
    if (s.mode !== 'A' || !s.countdown) return wrap('countdown', s, '');
    return wrap('countdown', s, '<section class="section section--tight" aria-label="' + esc(ctx.t.countdown.aria) + '"><div class="container"><div class="countdown-block">' + countdownInner(ctx, false) + '</div></div></section>');
  }

  /** Пасхальный круг: переходящие дни текущего цикла (до Троицы включительно). */
  function getCycle(site, nowMs) {
    var tz = site.timezone, cal = site.calendar;
    var today = localDate(nowMs, tz);
    var y = today.y;
    var last = (cal.cycle || []).reduce(function (m, c) { return Math.max(m, c.offset); }, 0);
    var p = orthodoxPascha(y, cal.paschaOverrides);
    if (p && toUTC(today) > toUTC(addDays(p, last))) { y += 1; p = orthodoxPascha(y, cal.paschaOverrides); }
    if (!p || y < cal.supportedYears.from || y > cal.supportedYears.to) return null;
    var nextFound = false;
    var items = (cal.cycle || []).map(function (c) {
      var d = addDays(p, c.offset), diff = toUTC(d) - toUTC(today);
      var st = diff < 0 ? 'past' : diff === 0 ? 'today' : (nextFound ? 'future' : 'next');
      if (st === 'next' || st === 'today') nextFound = true;
      return { id: c.id, date: d, status: st };
    });
    return { year: y, items: items };
  }

  function renderCycle(ctx) {
    var s = ctx.state, t = ctx.t.cycle, L = ctx.locale;
    var cy = getCycle(ctx.site, s.nowMs);
    if (!cy || !t) return wrap('cycle', s, '');
    var li = cy.items.map(function (it) {
      var dm = dayMonth(it.date, L);
      var badge = it.status === 'today' ? t.today : it.status === 'next' ? t.next : '';
      return '<li class="cycle__item is-' + it.status + (it.id === 'pascha' ? ' is-pascha' : '') + '"' + (it.status === 'today' ? ' aria-current="date"' : '') + '>' +
        '<time class="cycle__date" datetime="' + iso(it.date) + '"><span class="cycle__day">' + esc(dm.day) + '</span><span class="cycle__month">' + esc(dm.month) + '</span></time>' +
        '<span class="cycle__name">' + esc(t.feasts[it.id] || it.id) + '</span>' +
        (badge ? '<span class="cycle__badge">' + esc(badge) + '</span>' : '') + '</li>';
    }).join('');
    return wrap('cycle', s, '<div class="container"><div class="section-head"><h2 class="section-title" id="cycle-heading">' + esc(fmt(t.title, { year: cy.year })) + '</h2>' +
      '<p class="section-lead">' + esc(t.lead) + '</p></div><ol class="cycle__track">' + li + '</ol></div>', 'section', 'class="section cycle" aria-labelledby="cycle-heading"');
  }

  function scheduleDays(ctx) {
    var s = ctx.state, t = ctx.t.schedule, types = ctx.t.types, L = ctx.locale;
    var titles = { saturday: t.saturday, night: t.night, sunday: t.sunday };
    var out = '<ol class="days">';
    s.schedule.groups.forEach(function (g) {
      var main = g.id === 'night';
      var dateLabel = main ? fmt(t.nightDate, { satDate: cap(dateWeekday(g.date, L)), sunDate: dateWeekday(addDays(g.date, 1), L) }) : cap(dateWeekdayYear(g.date, L));
      out += '<li class="day' + (main ? ' day--main' : '') + '"><div class="day__head"><h3 class="day__title">' + esc(titles[g.id] || g.id) + '</h3>' +
        '<p class="day__date">' + esc(dateLabel) + '</p></div><ol class="day__items">';
      g.items.forEach(function (it, idx) {
        var time = it.time
          ? (it.until ? fmt(t.range, { from: it.time, to: it.until }) : it.time)
          : (idx === 0 ? '' : (g.id === 'night' ? t.then : t.after));
        var ty = types[it.type] || { name: it.type, note: '' };
        out += '<li class="slot' + (it.time ? '' : ' slot--then') + '"><span class="slot__time">' + esc(time) + '</span>' +
          '<p class="slot__text"><strong>' + esc(ty.name) + '</strong>' + (ty.note ? '<span>' + esc(ty.note) + '</span>' : '') + '</p></li>';
      });
      out += '</ol></li>';
    });
    return out + '</ol>';
  }

  function renderSchedule(ctx) {
    var s = ctx.state, t = ctx.t.schedule, site = ctx.site;
    var head = function (title) {
      return '<div class="section-head"><h2 class="section-title" id="schedule-heading">' + esc(title) + '</h2>' +
        '<p class="section-lead">' + esc(site.church.names[ctx.lang]) + '</p></div>';
    };
    var contact = '<p class="notice__contact">' + fmt(esc(t.contact), {
      phone: '<a href="tel:' + site.church.phoneE164 + '">' + esc(site.church.phone) + '</a>'
    }) + '</p>';
    var more = '<p class="schedule-more"><a href="' + esc(parishScheduleURL(ctx)) + '" target="_blank" rel="noopener" class="link-arrow">' +
      esc(ctx.t.ui.fullSchedule) + '<span class="visually-hidden"> ' + esc(ctx.t.ui.external) + '</span></a></p>';
    var h;
    if (s.mode === 'unsupported') return wrap('schedule', s, '');
    if (s.mode === 'B' && !s.scheduleRelevant) {
      h = head(t.paschalTitle) + '<div class="notice"><p>' + esc(t.paschalText) + '</p></div>' + more;
    } else if (s.schedule.status === 'published') {
      h = head(fmt(t.title, { year: s.year })) + publishedSchedule(ctx) + sourceStamp(ctx) + more;
    } else if (s.schedule.status === 'stale') {
      h = head(fmt(t.title, { year: s.year })) + '<div class="notice" role="status"><h3 class="notice__title">' + esc(t.staleTitle) + '</h3><p>' + esc(t.staleText) + '</p>' + contact + '</div>' + sourceStamp(ctx) + more;
    } else if (s.schedule.status === 'confirmed') {
      h = head(fmt(t.title, { year: s.year })) + scheduleDays(ctx) +
        '<p class="schedule-status"><svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' + esc(t.confirmedNote) + '</p>' + more;
    } else {
      h = head(fmt(t.title, { year: s.year })) +
        '<div class="notice" role="status"><h3 class="notice__title">' + esc(t.pendingTitle) + '</h3>' +
        '<p>' + esc(fmt(t.pendingText, { year: s.year })) + '</p>' + contact + '</div>' + more;
    }
    return wrap('schedule', s, h);
  }

  /** Короткая строка об освящении пищи (страница «Почему мы освящаем пищу»). */
  function renderBlessing(ctx) {
    var s = ctx.state, L = ctx.locale, t = ctx.t;
    if (s.mode === 'unsupported') return wrap('blessing', s, '');
    var parishLink = '<p><a href="' + esc(parishScheduleURL(ctx)) + '">' + esc(t.ui.fullSchedule) + '</a></p>';
    if (s.schedule.status === 'published' || s.schedule.status === 'stale') {
      return wrap('blessing', s, '<p>' + esc(t.schedule.blessingText) + '</p>' + parishLink);
    }
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
    return wrap('blessing', s, lines.length ? '<ul class="plain-list">' + lines.join('') + '</ul>' : '<p>' + esc(t.schedule.blessingText) + '</p>' + parishLink);
  }

  function renderRoute(ctx) {
    var c = ctx.site.church, a = c.address, t = ctx.t.route, ui = ctx.t.ui;
    var full = a.street + ', ' + a.locality + ', ' + a.postalCode + ', ' + a.eldership + ', ' + a.municipality + ', ' + a.country;
    var maps = 'https://www.google.com/maps/dir/?api=1&amp;destination=' + c.geo.lat + '%2C' + c.geo.lng;
    return '<section class="section route" id="route" aria-labelledby="route-heading" data-region="route"><div class="container"><div class="route__grid">' +
      '<div class="route__intro"><h2 class="section-title" id="route-heading">' + esc(t.tag) + '</h2>' +
      (t.lead ? '<p class="section-lead">' + esc(t.lead) + '</p>' : '') + '</div>' +
      '<div class="route-card">' +
      '<p class="route-card__church">' + esc(c.names[ctx.lang]) + '</p>' +
      '<address class="route-card__address" data-address>' + esc(a.street) + '<br>' + esc(a.postalCode + ' ' + a.locality) + '<br>' +
      esc(a.eldership + ', ' + a.municipality) + '<br>' + esc(a.country) + '</address>' +
      '<p class="route-card__place">' + esc(t.place) + '</p>' +
      '<div class="route-card__actions">' +
      '<a class="btn btn--gold" href="' + maps + '" target="_blank" rel="noopener"><svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>' + esc(t.directions) + '<span class="visually-hidden"> ' + esc(ui.external) + '</span></a>' +
      '<a class="btn btn--outline" href="tel:' + c.phoneE164 + '"><svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M6.6 3.5l2.6 3.6-1.7 2.3a12 12 0 0 0 7.1 7.1l2.3-1.7 3.6 2.6-1.5 2.6c-.4.6-1 .9-1.7.9C9.8 20.9 3.1 14.2 3.1 6.7c0-.7.3-1.3.9-1.7z"/></svg>' + esc(c.phone) + '</a>' +
      '<button type="button" class="btn btn--ghost" data-copy-address="' + esc(full) + '" data-copied="' + esc(t.copied) + '" data-copy-fail="' + esc(t.copyFail) + '" hidden><svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/></svg>' + esc(t.copy) + '</button>' +
      '</div><p class="route-card__note">' + esc(t.mapNote) + '</p>' +
      '<p class="route-card__status" data-copy-status role="status" aria-live="polite"></p>' +
      '</div></div></div></section>';
  }

  return {
    orthodoxPascha: orthodoxPascha, westernEaster: westernEaster,
    addDays: addDays, iso: iso, parseIso: parseIso, toUTC: toUTC,
    zonedToUtc: zonedToUtc, offsetAt: offsetAt, localDate: localDate,
    getSchedule: getSchedule, getState: getState,
    esc: esc, fmt: fmt, dateLong: dateLong, dateWeekday: dateWeekday, dateWeekdayYear: dateWeekdayYear, cap: cap,
    renderHero: renderHero, renderAnnounce: renderAnnounce, renderCountdown: renderCountdown,
    renderSchedule: renderSchedule, renderBlessing: renderBlessing, renderRoute: renderRoute,
    renderCycle: renderCycle, getCycle: getCycle, dayMonth: dayMonth
  };
});
