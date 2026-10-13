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
    schedule: C.renderSchedule, blessing: C.renderBlessing
  };
  var lastKey = null, timer = null;

  /** Ключ состояния: при его смене блоки перерисовываются. */
  function keyOf(s) {
    return [s.mode, s.year, s.schedule ? s.schedule.status : '', s.serviceInProgress, s.scheduleRelevant].join('|');
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
      cells.days.textContent = pad(Math.floor(s / 86400));
      cells.hours.textContent = pad(Math.floor((s % 86400) / 3600));
      cells.minutes.textContent = pad(Math.floor((s % 3600) / 60));
      cells.seconds.textContent = pad(s % 60);
    }
    box.hidden = false;
    // Обновление цифр каждую секунду не озвучивается программами экранного доступа
    box.setAttribute('aria-live', 'off');
    tick();
    if (target > now()) timer = setInterval(tick, 1000);
  }

  /* ── Копирование адреса ── */
  function initCopy() {
    var btns = document.querySelectorAll('[data-copy-address]');
    Array.prototype.forEach.call(btns, function (btn) {
      btn.hidden = false;
      btn.addEventListener('click', function () {
        var text = btn.getAttribute('data-copy-address');
        var status = btn.closest('.route-card').querySelector('[data-copy-status]');
        function done(ok) { if (status) status.textContent = btn.getAttribute(ok ? 'data-copied' : 'data-copy-fail'); }
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallback(text)); });
        } else {
          done(fallback(text));
        }
      });
    });
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
    initCopy();
    // Проверка смены режима раз в минуту (например, наступление дня Пасхи или конец Отдания)
    setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
