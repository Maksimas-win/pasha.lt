/**
 * animations.js — Reveal, Parallax, Particles & Effects
 * Pasha.lt | Светлое Воскресение Христово
 */

(function () {
  'use strict';

  /* ── Intersection Observer: fade-in on scroll ── */
  function initReveal() {
    const items = document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale');
    if (!items.length) return;
    if (reduceMotion || !('IntersectionObserver' in window)) {
      items.forEach(el => el.classList.add('revealed'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -60px 0px' }
    );

    items.forEach(el => observer.observe(el));
  }

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── Parallax: hero layer on desktop ── */
  function initParallax() {
    if (reduceMotion || window.innerWidth < 900) return;

    const layer = document.querySelector('.parallax-layer');
    if (!layer) return;

    let ticking = false;

    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          const y = window.scrollY;
          layer.style.transform = `translateY(${y * 0.3}px)`;
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });
  }

  /* ── Hero Particles: floating golden sparks ── */
  function initParticles() {
    const canvas = document.getElementById('hero-particles');
    if (!canvas || reduceMotion) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let particles = [];
    let w, h;
    let animId;

    function resize() {
      const hero = canvas.closest('.hero');
      if (!hero) return;
      w = canvas.width = hero.offsetWidth;
      h = canvas.height = hero.offsetHeight;
    }

    function createParticle() {
      return {
        x: Math.random() * w,
        y: h + Math.random() * 20,
        vx: (Math.random() - 0.5) * 0.4,
        vy: -(0.3 + Math.random() * 0.7),
        r: 1 + Math.random() * 2.5,
        life: 0,
        maxLife: 120 + Math.random() * 180,
        hue: 35 + Math.random() * 20 // gold range
      };
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);

      // Spawn new particles
      if (particles.length < 50) {
        particles.push(createParticle());
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life++;

        const progress = p.life / p.maxLife;
        const alpha = progress < 0.1
          ? progress / 0.1
          : progress > 0.7
            ? 1 - (progress - 0.7) / 0.3
            : 1;

        if (p.life >= p.maxLife || p.y < -10) {
          particles.splice(i, 1);
          continue;
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, 80%, 60%, ${alpha * 0.6})`;
        ctx.fill();

        // Glow
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, 80%, 60%, ${alpha * 0.12})`;
        ctx.fill();
      }

      animId = requestAnimationFrame(draw);
    }

    resize();
    window.addEventListener('resize', resize);
    draw();

    // Stop when hero is not visible
    const heroObs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        if (!animId) draw();
      } else {
        cancelAnimationFrame(animId);
        animId = null;
      }
    }, { threshold: 0 });

    const hero = canvas.closest('.hero');
    if (hero) heroObs.observe(hero);
  }

  /* Обратный отсчёт и расписание теперь в js/pascha-runtime.js (данные — data/site.json). */

  /* ── Scroll to top button ── */
  function initScrollTop() {
    const btn = document.querySelector('.scroll-top');
    if (!btn) return;

    window.addEventListener('scroll', () => {
      btn.classList.toggle('visible', window.scrollY > 400);
    }, { passive: true });

    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
      const skip = document.querySelector('.skip-nav');
      if (skip) skip.focus({ preventScroll: true });
    });
  }

  /* ── Header scroll style ── */
  function initHeaderScroll() {
    function update() {
      const header = document.getElementById('site-header');
      if (!header) return;
      header.classList.toggle('scrolled', window.scrollY > 60);
    }
    window.addEventListener('scroll', update, { passive: true });
    update();
  }

  /* ── Init ── */
  function init() {
    initReveal();
    initParallax();
    initParticles();
    initScrollTop();
    initHeaderScroll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
