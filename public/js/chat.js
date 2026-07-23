/* REU assistant — floating chat widget.
   Self-contained: injects its own styles and DOM, talks to POST /api/chat.
   Progressive enhancement: if this script fails to load, the site is
   unaffected. Uses site theme tokens so it matches light and dark modes.
   Accessible: labelled controls, dialog semantics, focus management,
   keyboard support, and respects prefers-reduced-motion via CSS. */
(function () {
  'use strict';
  if (window.__reuChatLoaded) return;
  window.__reuChatLoaded = true;

  var STORAGE_KEY = 'reu-chat-history';
  var STORAGE_OPEN = 'reu-chat-open';
  var MAX_STORED = 20;

  // ---------- styles ----------
  var css = [
    '.reu-chat-fab{position:fixed;right:20px;bottom:20px;z-index:9998;display:inline-flex;',
    'align-items:center;gap:8px;border:none;border-radius:999px;cursor:pointer;',
    'padding:12px 18px;font:600 15px/1 "IBM Plex Sans",system-ui,sans-serif;',
    'background:var(--action-primary-bg,#6E2639);color:var(--action-primary-fg,#fff);',
    'box-shadow:var(--shadow-2,0 12px 32px rgba(0,0,0,.2));transition:transform .15s ease,filter .15s ease}',
    '.reu-chat-fab:hover{filter:brightness(1.06)}',
    '.reu-chat-fab:active{transform:scale(.97)}',
    '.reu-chat-fab:focus-visible{outline:3px solid var(--focus-ring,#6E2639);outline-offset:2px}',
    '.reu-chat-fab[hidden]{display:none}',
    '.reu-chat-panel{position:fixed;right:20px;bottom:20px;z-index:9999;width:380px;max-width:calc(100vw - 32px);',
    'height:560px;max-height:calc(100vh - 40px);display:flex;flex-direction:column;',
    'background:var(--bg-surface,#fff);color:var(--fg-primary,#333);',
    'border:1px solid var(--border-default,#d8d9db);border-radius:16px;overflow:hidden;',
    'box-shadow:var(--shadow-2,0 12px 32px rgba(0,0,0,.25));font-family:"IBM Plex Sans",system-ui,sans-serif}',
    '.reu-chat-panel[hidden]{display:none}',
    '.reu-chat-head{display:flex;align-items:center;gap:10px;padding:14px 16px;',
    'background:var(--bg-inverse,#6E2639);color:var(--fg-inverse,#fff)}',
    '.reu-chat-head h2{margin:0;font:700 15px/1.2 "Archivo","IBM Plex Sans",sans-serif}',
    '.reu-chat-head .sub{font-size:12px;opacity:.8;margin-top:2px}',
    '.reu-chat-x{margin-left:auto;background:transparent;border:none;color:inherit;cursor:pointer;',
    'padding:6px;border-radius:8px;line-height:0}',
    '.reu-chat-x:hover{background:rgba(255,255,255,.15)}',
    '.reu-chat-x:focus-visible{outline:2px solid #fff;outline-offset:1px}',
    '.reu-chat-log{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;',
    'background:var(--bg-canvas,#f4f4f4)}',
    '.reu-msg{max-width:85%;padding:10px 13px;border-radius:14px;font-size:14.5px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}',
    '.reu-msg.bot{align-self:flex-start;background:var(--bg-surface,#fff);border:1px solid var(--border-default,#d8d9db);border-bottom-left-radius:4px}',
    '.reu-msg.user{align-self:flex-end;background:var(--action-primary-bg,#6E2639);color:var(--action-primary-fg,#fff);border-bottom-right-radius:4px}',
    '.reu-src{margin-top:8px;display:flex;flex-wrap:wrap;gap:6px}',
    '.reu-src a{font-size:12px;text-decoration:none;color:var(--link,#6E2639);border:1px solid var(--border-default,#d8d9db);',
    'padding:3px 8px;border-radius:999px;background:var(--bg-canvas,#f4f4f4)}',
    '.reu-src a:hover{border-color:var(--border-strong,#a7a9ac)}',
    '.reu-typing{align-self:flex-start;display:inline-flex;gap:4px;padding:12px 14px;background:var(--bg-surface,#fff);',
    'border:1px solid var(--border-default,#d8d9db);border-radius:14px;border-bottom-left-radius:4px}',
    '.reu-typing span{width:7px;height:7px;border-radius:50%;background:var(--fg-muted,#5f5f60);opacity:.5;animation:reu-b 1s infinite}',
    '.reu-typing span:nth-child(2){animation-delay:.15s}.reu-typing span:nth-child(3){animation-delay:.3s}',
    '@keyframes reu-b{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-4px);opacity:.9}}',
    '.reu-chat-foot{padding:10px;border-top:1px solid var(--border-default,#d8d9db);background:var(--bg-surface,#fff)}',
    '.reu-chat-form{display:flex;gap:8px;align-items:flex-end}',
    '.reu-chat-input{flex:1;resize:none;border:1px solid var(--border-default,#d8d9db);border-radius:10px;',
    'padding:9px 11px;font:400 14.5px/1.4 "IBM Plex Sans",system-ui,sans-serif;color:var(--fg-primary,#333);',
    'background:var(--bg-canvas,#f4f4f4);max-height:110px}',
    '.reu-chat-input:focus{outline:2px solid var(--focus-ring,#6E2639);outline-offset:0;border-color:transparent}',
    '.reu-send{border:none;border-radius:10px;cursor:pointer;padding:9px 14px;font:600 14px/1 "IBM Plex Sans",sans-serif;',
    'background:var(--action-primary-bg,#6E2639);color:var(--action-primary-fg,#fff)}',
    '.reu-send:hover{filter:brightness(1.06)}',
    '.reu-send:disabled{opacity:.5;cursor:default}',
    '.reu-send:focus-visible{outline:3px solid var(--focus-ring,#6E2639);outline-offset:2px}',
    '.reu-chat-note{font-size:11px;color:var(--fg-muted,#5f5f60);text-align:center;margin-top:6px}',
    '@media (max-width:480px){.reu-chat-panel{right:8px;bottom:8px;height:calc(100vh - 20px)}}',
    '@media (prefers-reduced-motion:reduce){.reu-chat-fab,.reu-send{transition:none}.reu-typing span{animation:none}}',
  ].join('');
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ---------- DOM ----------
  var fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'reu-chat-fab';
  fab.setAttribute('aria-haspopup', 'dialog');
  fab.setAttribute('aria-expanded', 'false');
  fab.innerHTML =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
    '<path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z"/></svg>' +
    '<span>Ask about the REU</span>';

  var panel = document.createElement('div');
  panel.className = 'reu-chat-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-labelledby', 'reu-chat-title');
  panel.hidden = true;
  panel.innerHTML =
    '<div class="reu-chat-head">' +
    '<div><h2 id="reu-chat-title">REU Assistant</h2><div class="sub">UA Little Rock · NSF REU Site</div></div>' +
    '<button type="button" class="reu-chat-x" aria-label="Close assistant">' +
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
    '</button></div>' +
    '<div class="reu-chat-log" id="reu-chat-log" role="log" aria-live="polite" aria-label="Conversation"></div>' +
    '<div class="reu-chat-foot">' +
    '<form class="reu-chat-form" id="reu-chat-form">' +
    '<label class="reu-sr" for="reu-chat-input" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Your question</label>' +
    '<textarea class="reu-chat-input" id="reu-chat-input" rows="1" placeholder="Ask about dates, eligibility, funding…" autocomplete="off"></textarea>' +
    '<button class="reu-send" type="submit" id="reu-send">Send</button>' +
    '</form>' +
    '<div class="reu-chat-note">Answers are generated from this site. Verify important details with reu@ualr.edu.</div>' +
    '</div>';

  document.body.appendChild(fab);
  document.body.appendChild(panel);

  var log = panel.querySelector('#reu-chat-log');
  var form = panel.querySelector('#reu-chat-form');
  var input = panel.querySelector('#reu-chat-input');
  var sendBtn = panel.querySelector('#reu-send');
  var closeBtn = panel.querySelector('.reu-chat-x');

  var history = loadHistory();

  // ---------- helpers ----------
  function loadHistory() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function saveHistory() {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-MAX_STORED))); } catch (e) {}
  }
  function scrollDown() { log.scrollTop = log.scrollHeight; }

  function addMessage(role, text, sources) {
    var el = document.createElement('div');
    el.className = 'reu-msg ' + (role === 'user' ? 'user' : 'bot');
    el.textContent = text;
    if (sources && sources.length) {
      var box = document.createElement('div');
      box.className = 'reu-src';
      sources.forEach(function (s) {
        if (!s || !s.url) return;
        var a = document.createElement('a');
        a.href = s.url;
        a.textContent = s.title || s.url;
        box.appendChild(a);
      });
      if (box.children.length) el.appendChild(box);
    }
    log.appendChild(el);
    scrollDown();
    return el;
  }

  function showTyping() {
    var t = document.createElement('div');
    t.className = 'reu-typing';
    t.setAttribute('aria-label', 'Assistant is typing');
    t.innerHTML = '<span></span><span></span><span></span>';
    log.appendChild(t);
    scrollDown();
    return t;
  }

  function renderHistory() {
    log.innerHTML = '';
    if (!history.length) {
      addMessage('bot',
        'Hi! I can answer questions about the UA Little Rock NSF REU program — ' +
        'application dates, eligibility, funding, research areas, and how to apply. ' +
        'What would you like to know?');
    } else {
      history.forEach(function (m) { addMessage(m.role, m.content, m.sources); });
    }
  }

  var open = false;
  function openPanel(focusInput) {
    open = true;
    panel.hidden = false;
    fab.hidden = true;
    fab.setAttribute('aria-expanded', 'true');
    try { sessionStorage.setItem(STORAGE_OPEN, '1'); } catch (e) {}
    renderHistory();
    // Only steal focus on an explicit user open, not on auto-reopen after a
    // page navigation (that would scroll the new page down to the widget).
    if (focusInput !== false) setTimeout(function () { input.focus(); }, 50);
  }
  function closePanel() {
    open = false;
    panel.hidden = true;
    fab.hidden = false;
    fab.setAttribute('aria-expanded', 'false');
    try { sessionStorage.setItem(STORAGE_OPEN, '0'); } catch (e) {}
    fab.focus();
  }

  var pending = false;
  function send(text) {
    if (pending) return;
    text = String(text || '').trim();
    if (!text) return;
    pending = true;
    sendBtn.disabled = true;

    addMessage('user', text);
    history.push({ role: 'user', content: text });
    saveHistory();
    input.value = '';
    input.style.height = 'auto';

    var typing = showTyping();
    var apiHistory = history.slice(0, -1).map(function (m) {
      return { role: m.role, content: m.content };
    });

    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, history: apiHistory }),
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        typing.remove();
        if (!res.ok) {
          addMessage('bot', (res.d && res.d.error) || 'Something went wrong. Please try again.');
          return;
        }
        addMessage('bot', res.d.answer, res.d.sources);
        history.push({ role: 'assistant', content: res.d.answer, sources: res.d.sources });
        saveHistory();
      })
      .catch(function () {
        typing.remove();
        addMessage('bot', 'I could not reach the server. Please check your connection or email reu@ualr.edu.');
      })
      .finally(function () {
        pending = false;
        sendBtn.disabled = false;
        input.focus();
      });
  }

  // ---------- events ----------
  fab.addEventListener('click', openPanel);
  closeBtn.addEventListener('click', closePanel);

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    send(input.value);
  });

  // Enter to send, Shift+Enter for newline; auto-grow the textarea.
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input.value);
    }
  });
  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 110) + 'px';
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && open) closePanel();
  });

  // Clicking a source link navigates to another page on the site. Keep the
  // panel's open flag set so the chat reopens (with history) on the next page.
  log.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('.reu-src a') : null;
    if (a) { try { sessionStorage.setItem(STORAGE_OPEN, '1'); } catch (err) {} }
  });

  // Restore the panel if it was open before a same-site navigation.
  var wasOpen = false;
  try { wasOpen = sessionStorage.getItem(STORAGE_OPEN) === '1'; } catch (e) {}
  if (wasOpen) openPanel(false);
})();
