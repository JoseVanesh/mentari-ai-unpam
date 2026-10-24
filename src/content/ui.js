(function (root) {
  const NS = (root.MentariExt = root.MentariExt || {});
  const HOST_ID = (NS.SELECTORS && NS.SELECTORS.panelHostId) || 'mentari-ai-root';

  const CSS = `
    :host { all: initial; }
    .wrap {
      position: fixed;
      right: 16px;
      bottom: 16px;
      width: 350px;
      max-width: calc(100vw - 32px);
      background: #0f172a;
      color: #e2e8f0;
      border: 1px solid #24324a;
      border-radius: 14px;
      box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
      font: 13px/1.45 system-ui, "Segoe UI", Roboto, sans-serif;
      overflow: hidden;
      z-index: 2147483647;
    }
    .head {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      background: linear-gradient(135deg, #0f172a, #132033);
      border-bottom: 1px solid #24324a;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #14b8a6;
      box-shadow: 0 0 8px #14b8a6;
      flex: 0 0 auto;
    }
    .title { font-weight: 700; font-size: 13px; flex: 1 1 auto; }
    .badge {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #7dd3fc;
      background: #0b2a3a;
      padding: 2px 7px;
      border-radius: 999px;
      white-space: nowrap;
    }
    .collapse {
      background: transparent;
      border: 0;
      color: #94a3b8;
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
      padding: 0 2px;
    }
    .body {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-height: 62vh;
      overflow: auto;
    }
    .body.collapsed { display: none; }
    .status { margin: 0; color: #cbd5e1; white-space: pre-wrap; }
    .status.ok { color: #34d399; }
    .status.warn { color: #fbbf24; }
    .status.error { color: #f87171; }
    .status.info { color: #93c5fd; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    button.act {
      background: #132033;
      color: #e2e8f0;
      border: 1px solid #2b3b56;
      border-radius: 9px;
      padding: 7px 11px;
      font: inherit;
      font-size: 12px;
      cursor: pointer;
    }
    button.act:hover:not(:disabled) { border-color: #3b82f6; }
    button.act.primary {
      background: #14b8a6;
      border-color: #14b8a6;
      color: #04231f;
      font-weight: 700;
    }
    button.act:disabled { opacity: 0.5; cursor: not-allowed; }
    .meta { font-size: 11px; color: #94a3b8; }
    .meta ul { margin: 6px 0 0; padding-left: 16px; }
    .meta li { margin: 2px 0; }
    .notes { display: flex; flex-direction: column; gap: 6px; }
    .note {
      font-size: 11px;
      color: #94a3b8;
      background: #0b1220;
      border: 1px dashed #24324a;
      padding: 8px;
      border-radius: 8px;
      white-space: pre-wrap;
    }
    .hidden { display: none !important; }
  `;

  let refs = null;

  function ensure() {
    if (refs && refs.host && refs.host.isConnected) return refs;

    let host = document.getElementById(HOST_ID);
    if (host) host.remove();

    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.display = 'block';
    (document.body || document.documentElement).appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML =
      '<style>' +
      CSS +
      '</style>' +
      '<div class="wrap">' +
      '  <div class="head">' +
      '    <span class="dot"></span>' +
      '    <span class="title">Mentari AI</span>' +
      '    <span class="badge">—</span>' +
      '    <button type="button" class="collapse" title="Lipat panel">−</button>' +
      '  </div>' +
      '  <div class="body">' +
      '    <p class="status">Memuat…</p>' +
      '    <div class="actions"></div>' +
      '    <div class="meta"></div>' +
      '    <div class="notes"></div>' +
      '  </div>' +
      '</div>';

    refs = {
      host: host,
      wrap: shadow.querySelector('.wrap'),
      status: shadow.querySelector('.status'),
      actions: shadow.querySelector('.actions'),
      meta: shadow.querySelector('.meta'),
      notes: shadow.querySelector('.notes'),
      badge: shadow.querySelector('.badge'),
      body: shadow.querySelector('.body'),
      collapse: shadow.querySelector('.collapse'),
      busy: false
    };

    refs.collapse.addEventListener('click', function () {
      const collapsed = refs.body.classList.toggle('collapsed');
      refs.collapse.textContent = collapsed ? '+' : '−';
    });

    return refs;
  }

  function setStatus(text, tone) {
    const r = ensure();
    r.status.textContent = text || '';
    r.status.className = 'status' + (tone ? ' ' + tone : '');
  }

  function setRoute(text) {
    const r = ensure();
    r.badge.textContent = text || '—';
  }

  function setBusy(value) {
    const r = ensure();
    r.busy = !!value;
    r.actions.querySelectorAll('button.act').forEach(function (button) {
      button.disabled = r.busy;
    });
  }

  function addAction(label, handler, options) {
    const r = ensure();
    const opts = options || {};
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'act' + (opts.primary ? ' primary' : '');
    button.textContent = label;
    if (r.busy) button.disabled = true;
    button.addEventListener('click', function () {
      if (button.disabled) return;
      Promise.resolve()
        .then(handler)
        .catch(function (error) {
          console.error('[Mentari AI]', error);
          setStatus('Terjadi kesalahan: ' + ((error && error.message) || error), 'error');
        });
    });
    r.actions.appendChild(button);
    return button;
  }

  function clearActions() {
    const r = ensure();
    r.actions.innerHTML = '';
  }

  function setSummary(lines) {
    const r = ensure();
    r.meta.innerHTML = '';
    const list = Array.isArray(lines) ? lines.filter(Boolean) : [];
    if (!list.length) return;
    const ul = document.createElement('ul');
    list.forEach(function (line) {
      const li = document.createElement('li');
      li.textContent = line;
      ul.appendChild(li);
    });
    r.meta.appendChild(ul);
  }

  function note(text) {
    const r = ensure();
    const div = document.createElement('div');
    div.className = 'note';
    div.textContent = text;
    r.notes.appendChild(div);
  }

  function reset() {
    const r = ensure();
    r.busy = false;
    r.status.textContent = '';
    r.status.className = 'status';
    r.actions.innerHTML = '';
    r.meta.innerHTML = '';
    r.notes.innerHTML = '';
  }

  function show() {
    ensure().host.style.display = 'block';
  }

  function hide() {
    if (refs && refs.host) refs.host.style.display = 'none';
  }

  NS.ui = {
    ensure: ensure,
    show: show,
    hide: hide,
    reset: reset,
    setStatus: setStatus,
    setRoute: setRoute,
    setBusy: setBusy,
    addAction: addAction,
    clearActions: clearActions,
    setSummary: setSummary,
    note: note
  };
})(globalThis);
