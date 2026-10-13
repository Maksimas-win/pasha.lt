/**
 * animations.js — поведение шапки и кнопки «Наверх».
 * Декоративные частицы, параллакс и «проявление» блоков при прокрутке удалены:
 * они мешали чтению и нагружали телефоны. Единственный акцент движения —
 * мягкое свечение главного экрана при загрузке (в CSS, отключается при prefers-reduced-motion).
 */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function init() {
    var header = document.getElementById('site-header');
    var top = document.querySelector('.scroll-top');
    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        var y = window.scrollY;
        if (header) header.classList.toggle('scrolled', y > 24);
        if (top) top.classList.toggle('visible', y > 700);
        ticking = false;
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    if (top) top.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
      var skip = document.querySelector('.skip-nav');
      if (skip) skip.focus({ preventScroll: true });
    });

    // Выпадающий список языков закрывается при клике мимо и по Esc
    var menu = document.querySelector('.lang-menu');
    if (menu) {
      document.addEventListener('click', function (e) { if (menu.open && !menu.contains(e.target)) menu.open = false; });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && menu.open) { menu.open = false; menu.querySelector('summary').focus(); }
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
