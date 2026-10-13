/**
 * navigation.js — мобильное меню.
 * Шапка и подвал теперь встроены в HTML при сборке (tools/build.mjs),
 * поэтому навигация и переключатель языков работают и без JavaScript;
 * отметка текущей страницы и языка (aria-current) тоже проставляется при сборке.
 */
(function () {
  'use strict';

  function init() {
    var hamburger = document.querySelector('.hamburger');
    var menu = document.querySelector('.mobile-menu');
    if (!hamburger || !menu) return;

    function setOpen(open, returnFocus) {
      menu.classList.toggle('open', open);
      hamburger.classList.toggle('open', open);
      hamburger.setAttribute('aria-expanded', String(open));
      document.body.style.overflow = open ? 'hidden' : '';
      if (open) {
        var first = menu.querySelector('a');
        if (first) first.focus();
      } else if (returnFocus) {
        hamburger.focus();
      }
    }

    hamburger.addEventListener('click', function () {
      setOpen(!menu.classList.contains('open'), true);
    });
    menu.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { setOpen(false, false); });
    });
    document.addEventListener('click', function (e) {
      if (menu.classList.contains('open') && !hamburger.contains(e.target) && !menu.contains(e.target)) setOpen(false, false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu.classList.contains('open')) setOpen(false, true);
    });
    // При переходе на широкий экран меню закрывается
    window.addEventListener('resize', function () {
      if (window.innerWidth > 900 && menu.classList.contains('open')) setOpen(false, false);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
