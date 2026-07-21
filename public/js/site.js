/* Progressive enhancement only. First paint never depends on this file:
   theme.css resolves the OS color scheme via light-dark(). This script
   (a) re-applies a previously saved explicit choice, (b) wires the toggle,
   (c) mobile menu, (d) nav scroll-spy. */
(function () {
  var root = document.documentElement;

  // (a) restore saved explicit preference
  try {
    var saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') root.classList.add(saved);
  } catch (e) {}

  // (b) toggle
  var btn = document.getElementById('theme-btn');
  if (btn) {
    btn.addEventListener('click', function () {
      var systemDark = matchMedia('(prefers-color-scheme: dark)').matches;
      var isDark = root.classList.contains('dark') ||
                   (!root.classList.contains('light') && systemDark);
      root.classList.remove('light', 'dark');
      var next = isDark ? 'light' : 'dark';
      root.classList.add(next);
      try { localStorage.setItem('theme', next); } catch (e) {}
      btn.setAttribute('aria-label', 'Switch to ' + (next === 'dark' ? 'light' : 'dark') + ' theme');
    });
  }

  // (c) mobile menu
  var menuBtn = document.getElementById('menu-btn');
  var links = document.getElementById('nav-links');
  if (menuBtn && links) {
    menuBtn.addEventListener('click', function () {
      var open = links.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', String(open));
    });
    links.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        links.classList.remove('open');
        menuBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // (d) scroll-spy for in-page anchors
  var anchors = Array.prototype.slice.call(
    document.querySelectorAll('.nav-links a[href^="#"], .nav-links a[href^="/#"]'));
  if ('IntersectionObserver' in window && anchors.length) {
    var map = {};
    anchors.forEach(function (a) {
      var id = a.getAttribute('href').replace(/^\/?#/, '');
      var el = document.getElementById(id);
      if (el) map[id] = a;
    });
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && map[en.target.id]) {
          anchors.forEach(function (a) { a.removeAttribute('aria-current'); });
          map[en.target.id].setAttribute('aria-current', 'true');
        }
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    Object.keys(map).forEach(function (id) {
      obs.observe(document.getElementById(id));
    });
  }
})();
