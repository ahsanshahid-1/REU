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

  /* (c2) Placeholder / content-readiness treatment (Requirement 18).
     The canonical "published upon award" wording is defined ONCE here so it
     cannot drift across pages (Req 18.3). The exact string is also present in
     the raw HTML of every withheld-until-award location, so it shows with JS
     disabled (Req 17.5); this pass simply normalizes any drift and drops in
     finalized content when a slot has been populated (Req 18.2). */
  var PUBLISHED_UPON_AWARD = 'Published upon NSF award notification.';

  // Enforce identical wording on every withheld-until-award marker.
  Array.prototype.forEach.call(
    document.querySelectorAll('.placeholder[data-state="withheld-until-award"]'),
    function (el) {
      if (el.textContent.trim() !== PUBLISHED_UPON_AWARD) {
        el.textContent = PUBLISHED_UPON_AWARD;
      }
    });

  // Content slots: named mentor profiles + detailed project examples.
  // Each [data-content-slot] element names a JSON source (data-src). While the
  // source is an empty array the withheld treatment already in the DOM is kept;
  // when populated (the Aug 6 deliverable) finalized content is rendered in its
  // place with no code change (Req 2.6, 18.2).
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function renderMentors(items) {
    return '<div class="grid grid-2">' + items.map(function (m) {
      return '<div class="card">' +
        '<h3 style="margin-top:0">' + esc(m.name) + '</h3>' +
        (m.title ? '<p style="font-weight:600;color:var(--fg-secondary);margin-bottom:8px">' + esc(m.title) + '</p>' : '') +
        (m.area ? '<p style="font-size:13.5px;color:var(--fg-muted);margin-bottom:8px">' + esc(m.area) + '</p>' : '') +
        (m.focus ? '<p>' + esc(m.focus) + '</p>' : '') +
        (m.mentoring ? '<p style="margin-top:8px;font-size:14px;color:var(--fg-secondary)">' + esc(m.mentoring) + '</p>' : '') +
        '</div>';
    }).join('') + '</div>';
  }
  function renderProjects(items) {
    return '<div class="grid grid-2">' + items.map(function (p) {
      return '<div class="card">' +
        (p.area ? '<p style="font-size:13.5px;color:var(--fg-muted);margin-bottom:6px">' + esc(p.area) + '</p>' : '') +
        '<h3 style="margin-top:0">' + esc(p.title) + '</h3>' +
        (p.description ? '<p>' + esc(p.description) + '</p>' : '') +
        '</div>';
    }).join('') + '</div>';
  }
  var SLOT_RENDERERS = { mentors: renderMentors, projects: renderProjects };

  Array.prototype.forEach.call(
    document.querySelectorAll('[data-content-slot][data-src]'),
    function (slot) {
      var kind = slot.getAttribute('data-content-slot');
      var src = slot.getAttribute('data-src');
      var render = SLOT_RENDERERS[kind];
      if (!render || !window.fetch) return;
      fetch(src, { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (items) {
          // Only finalized (non-empty) content replaces the withheld treatment.
          if (Array.isArray(items) && items.length) {
            slot.innerHTML = render(items);
            slot.setAttribute('data-state', 'finalized');
          }
        })
        .catch(function () { /* keep the withheld treatment already in the DOM */ });
    });

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
