/**
 * navigation.js — Mobile Menu & Active Link
 * Pasha.lt | Светлое Воскресение Христово
 */

(function () {
  'use strict';

  function initNavigation() {
    const hamburger   = document.querySelector('.hamburger');
    const mobileMenu  = document.querySelector('.mobile-menu');
    const navLinks    = document.querySelectorAll('.nav-links a, .mobile-menu a');

    /* ── Hamburger toggle ── */
    if (hamburger && mobileMenu) {
      hamburger.addEventListener('click', () => {
        const open = mobileMenu.classList.toggle('open');
        hamburger.classList.toggle('open', open);
        hamburger.setAttribute('aria-expanded', String(open));
        document.body.style.overflow = open ? 'hidden' : '';
      });

      // Закрыть при клике на ссылку
      mobileMenu.querySelectorAll('a').forEach(a => {
        a.addEventListener('click', () => {
          mobileMenu.classList.remove('open');
          hamburger.classList.remove('open');
          hamburger.setAttribute('aria-expanded', 'false');
          document.body.style.overflow = '';
        });
      });

      // Закрыть при клике вне меню
      document.addEventListener('click', e => {
        if (!hamburger.contains(e.target) && !mobileMenu.contains(e.target)) {
          mobileMenu.classList.remove('open');
          hamburger.classList.remove('open');
          hamburger.setAttribute('aria-expanded', 'false');
          document.body.style.overflow = '';
        }
      });
    }

    /* ── Active link detection ── */
    const currentPath = window.location.pathname;

    navLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (!href) return;

      // Нормализуем путь для сравнения
      const linkPath = new URL(href, window.location.href).pathname;

      if (
        linkPath === currentPath ||
        (currentPath.endsWith('/index.html') && linkPath === currentPath.replace('/index.html', '/')) ||
        (currentPath !== '/' && linkPath !== '/' && currentPath.startsWith(linkPath) && linkPath.length > 3)
      ) {
        link.classList.add('active');
      }
    });

    /* ── Language switcher: detect current lang ── */
    const langLinks = document.querySelectorAll('.lang-switcher a, .footer-bottom__langs a, .mobile-lang a');
    const pathParts = currentPath.split('/').filter(Boolean);
    const currentLang = ['ru', 'lt', 'en', 'pl', 'ukr', 'de'].includes(pathParts[0])
      ? pathParts[0] : 'ru';

    langLinks.forEach(link => {
      const href = link.getAttribute('href') || '';
      const langMatch = href.match(/\/(ru|lt|en|pl|ukr|de)\//);
      if (langMatch && langMatch[1] === currentLang) {
        link.classList.add('active');
      }
    });

    /* ── Keyboard navigation: close on Escape ── */
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && mobileMenu && mobileMenu.classList.contains('open')) {
        mobileMenu.classList.remove('open');
        hamburger && hamburger.classList.remove('open');
        document.body.style.overflow = '';
      }
    });
  }

  // Предотвращаем двойную инициализацию
  let initialized = false;
  function initOnce() {
    if (initialized) return;
    initialized = true;
    initNavigation();
  }

  // Инициализация после загрузки компонентов
  document.addEventListener('components:ready', initOnce);
  // Также — при стандартной загрузке
  document.addEventListener('DOMContentLoaded', initOnce);

})();
