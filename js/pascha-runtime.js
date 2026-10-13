/**
 * pascha-runtime.js — актуализация страницы в браузере.
 *
 * HTML уже содержит блоки, собранные tools/build.mjs на дату сборки. Здесь те же функции
 * из pascha-core.js пересчитывают режим на текущий момент (на случай, если сайт давно
 * не пересобирали), запускают обратный отсчёт и кнопку «Скопировать адрес».
 *
 * Для проверки можно открыть страницу с параметром ?date=2027-05-01T23:29:50+03:00 —
 * время пойдёт от указанного момента. На рабочий сайт параметр не влияет без явного указания.
 */
(function () {
  'use strict';
  var D = window.PASHA_DATA, C = window.PashaCore;
  if (!D || !C) return;

  /* ── «Сейчас» с возможностью подмены для проверки ── */
  var offset = 0;
  try {
    var q = new URLSearchParams(window.location.search).get('date');
    if (q) q = q.replace(' ', '+'); // «+» в адресе без кодирования превращается в пробел
    if (q && !isNaN(Date.parse(q))) offset = Date.parse(q) - Date.now();
  } catch (e) { /* старые браузеры: без подмены */ }
  function now() { return Date.now() + offset; }

  var body = document.body;
  function ctx(state) {
    return {
      site: D.site, lang: D.lang, t: D.t, locale: D.site.languages[D.lang].locale, state: state,
      scheduleHref: body.getAttribute('data-schedule-href') || '#schedule',
      meaningHref: body.getAttribute('data-meaning-href') || null
    };
  }

  var renderers = {
    hero: C.renderHero, announce: C.renderAnnounce, countdown: C.renderCountdown,
    schedule: C.renderSchedule, blessing: C.renderBlessing, cycle: C.renderCycle
  };
  var lastKey = null, timer = null;

  /** Ключ состояния: при его смене блоки перерисовываются. */
  function keyOf(s) {
    return [s.mode, s.year, s.schedule ? s.schedule.status : '', s.serviceInProgress, s.scheduleRelevant,
      C.iso(C.localDate(s.nowMs, D.site.timezone))].join('|');
  }

  function refresh() {
    var state = C.getState(D.site, now());
    var key = keyOf(state);
    if (key !== lastKey) {
      var c = ctx(state);
      Object.keys(renderers).forEach(function (name) {
        var nodes = document.querySelectorAll('[data-region="' + name + '"]');
        if (!nodes.length) return;
        var html = renderers[name](c);
        for (var i = 0; i < nodes.length; i++) {
          if (nodes[i].outerHTML !== html) nodes[i].outerHTML = html;
        }
      });
      lastKey = key;
      startCountdown();
      revealEnhanced();
    }
    return state;
  }

  /* ── Обратный отсчёт ── */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function startCountdown() {
    if (timer) { clearInterval(timer); timer = null; }
    var box = document.querySelector('[data-countdown-box]');
    if (!box) return;
    var target = +box.getAttribute('data-target');
    var cells = {};
    ['days', 'hours', 'minutes', 'seconds'].forEach(function (k) { cells[k] = box.querySelector('[data-countdown="' + k + '"]'); });
    function tick() {
      var diff = Math.max(0, target - now());
      if (diff === 0) {
        clearInterval(timer); timer = null;
        refresh(); // смена режима: отсчёт исчезает, появляется пасхальное приветствие
        return;
      }
      var s = Math.floor(diff / 1000);
      var v = { days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60 };
      Object.keys(cells).forEach(function (k) { if (cells[k]) cells[k].textContent = pad(v[k]); });
    }
    box.hidden = false;
    // Обновление цифр каждую секунду не озвучивается программами экранного доступа
    box.setAttribute('aria-live', 'off');
    tick();
    if (target > now()) timer = setInterval(tick, 1000);
  }

  /* ── Кнопки, работающие только с JavaScript: показать и обработать (делегирование) ── */
  function revealEnhanced() {
    var sel = '[data-copy-address],[data-ics-title]' + (navigator.share || (navigator.clipboard && window.isSecureContext) ? ',[data-share]' : '');
    Array.prototype.forEach.call(document.querySelectorAll(sel), function (el) { el.hidden = false; });
  }
  function status(btn, text) {
    var box = btn.closest('.route-card') || btn.closest('[data-status-scope]') || btn.parentNode;
    var out = box.querySelector('[data-copy-status]') || document.querySelector('[data-live-status]');
    if (out) { out.textContent = ''; setTimeout(function () { out.textContent = text; }, 30); }
  }
  function copyText(text, cb) {
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { cb(true); }, function () { cb(fallback(text)); });
    else cb(fallback(text));
  }
  function icsEscape(v) { return String(v).replace(/[\\;,]/g, function (c) { return '\\' + c; }); }
  function downloadIcs(btn) {
    var now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//pasha.lt//pascha//RU', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
      'UID:' + (btn.getAttribute('data-ics-start') || btn.getAttribute('data-ics-date')) + '@pasha.lt', 'DTSTAMP:' + now];
    if (btn.getAttribute('data-ics-start')) lines.push('DTSTART:' + btn.getAttribute('data-ics-start'));
    else lines.push('DTSTART;VALUE=DATE:' + btn.getAttribute('data-ics-date'));
    lines.push('SUMMARY:' + icsEscape(btn.getAttribute('data-ics-title')), 'LOCATION:' + icsEscape(btn.getAttribute('data-ics-location')),
      'URL:' + location.origin + location.pathname, 'END:VEVENT', 'END:VCALENDAR');
    var blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = btn.getAttribute('data-ics-file') || 'pascha.ics';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-copy-address],[data-ics-title],[data-share]');
    if (!btn) return;
    if (btn.hasAttribute('data-copy-address')) {
      copyText(btn.getAttribute('data-copy-address'), function (ok) { status(btn, btn.getAttribute(ok ? 'data-copied' : 'data-copy-fail')); });
    } else if (btn.hasAttribute('data-ics-title')) {
      downloadIcs(btn);
    } else if (btn.hasAttribute('data-share')) {
      var data = { title: document.title, url: location.href };
      if (navigator.share) navigator.share(data).catch(function () {});
      else copyText(location.href, function (ok) { if (ok) status(btn, btn.getAttribute('data-copied')); });
    }
  });

  /* ── Пасхальное приветствие на разных языках ── */
  function initGreetings() {
    var root = document.querySelector('[data-greetings]');
    if (!root) return;
    var items = root.querySelectorAll('.greet__item');
    var chips = root.querySelectorAll('[data-greet-index]');
    var toggle = root.querySelector('[data-greet-toggle]');
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var i = 0, timer = null, userStopped = false;
    root.classList.add('is-enhanced');
    function show(n) {
      i = (n + items.length) % items.length;
      Array.prototype.forEach.call(items, function (el, k) { el.hidden = k !== i; });
      Array.prototype.forEach.call(chips, function (el, k) { el.setAttribute('aria-pressed', String(k === i)); });
    }
    function play() { stop(); timer = setInterval(function () { show(i + 1); }, 4200); setToggle(true); }
    function stop() { if (timer) clearInterval(timer); timer = null; setToggle(false); }
    function setToggle(on) {
      if (!toggle) return;
      toggle.setAttribute('aria-label', toggle.getAttribute(on ? 'data-label-pause' : 'data-label-play'));
      toggle.classList.toggle('is-paused', !on);
    }
    Array.prototype.forEach.call(chips, function (el) {
      el.addEventListener('click', function () { userStopped = true; stop(); show(+el.getAttribute('data-greet-index')); });
    });
    if (toggle) { toggle.hidden = false; toggle.addEventListener('click', function () { if (timer) { userStopped = true; stop(); } else { userStopped = false; play(); } }); }
    show(0);
    if (!reduce) {
      // Смена языков идёт, только пока блок виден
      if ('IntersectionObserver' in window) {
        var started = false;
        new IntersectionObserver(function (en) {
          if (userStopped) return;
          if (en[0].isIntersecting && !started) { started = true; play(); }
          else if (!en[0].isIntersecting && timer) { stop(); started = false; }
        }, { threshold: 0.4 }).observe(root);
      } else play();
    } else setToggle(false);
  }

  /* ── Нижняя панель быстрых действий на телефоне: после первого экрана ── */
  function initQuickbar() {
    var bar = document.querySelector('.quickbar'), hero = document.querySelector('.hero, .page-hero');
    if (!bar) return;
    if (!hero || !('IntersectionObserver' in window)) { bar.classList.add('is-visible'); return; }
    new IntersectionObserver(function (en) { bar.classList.toggle('is-visible', !en[0].isIntersecting); }, { threshold: 0 }).observe(hero);
  }

  function fallback(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  function init() {
    refresh();
    revealEnhanced();
    initGreetings();
    initQuickbar();
    // Проверка смены режима раз в минуту (например, наступление дня Пасхи или конец Отдания)
    setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
