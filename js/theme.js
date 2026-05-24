window.GHD = window.GHD || {};
(function(GHD) {
  'use strict';
  const STORAGE_KEY = 'ghd_theme';

  function getSystemPreference() {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.textContent = theme === 'dark' ? '☀️' : '🌙';
      btn.setAttribute('aria-label', 'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' theme');
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.content = theme === 'dark' ? '#0b1120' : '#f8fafc';
    }
  }

  function current() {
    return localStorage.getItem(STORAGE_KEY) || getSystemPreference();
  }

  function toggle() {
    const next = current() === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, next);
    apply(next);
  }

  function init() {
    apply(current());
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function(e) {
      if (!localStorage.getItem(STORAGE_KEY)) apply(e.matches ? 'light' : 'dark');
    });
  }

  // Run immediately to avoid flash
  init();

  GHD.Theme = { toggle, current, init };

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function() {});
  }
})(window.GHD);
