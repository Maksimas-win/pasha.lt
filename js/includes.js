/**
 * includes.js — Component Loader
 * Pasha.lt | Светлое Воскресение Христово
 * Подгружает header.html и footer.html в каждую страницу
 */

(function () {
  'use strict';

  // Определяем базовый путь до /includes/ относительно текущей страницы
  function getBasePath() {
    const path = window.location.pathname;
    // Если мы в /ru/, /lt/, /en/ и т.д. — нужно подняться на уровень вверх
    const depth = (path.match(/\//g) || []).length;
    if (depth >= 2) return '../';
    return '';
  }

  const base = getBasePath();

  // Загружаем HTML-фрагмент и вставляем в контейнер
  async function loadComponent(selector, url) {
    const el = document.querySelector(selector);
    if (!el) return;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      el.innerHTML = html;
      // Запускаем скрипты внутри загруженного HTML
      el.querySelectorAll('script').forEach(s => {
        const ns = document.createElement('script');
        ns.textContent = s.textContent;
        document.head.appendChild(ns);
      });
      // Диспатчим событие для navigation.js
      el.dispatchEvent(new CustomEvent('component:loaded', { bubbles: true }));
    } catch (e) {
      // Component load failed silently
    }
  }

  async function init() {
    await Promise.all([
      loadComponent('#site-header', `${base}includes/header.html`),
      loadComponent('#site-footer', `${base}includes/footer.html`)
    ]);

    // После загрузки компонентов — инициализируем навигацию
    document.dispatchEvent(new Event('components:ready'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
