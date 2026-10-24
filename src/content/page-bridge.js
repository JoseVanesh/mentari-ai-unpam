(function () {
  if (window.__mentariExtBridge) return;
  window.__mentariExtBridge = true;

  const CHANNEL = 'MENTARI_EXT';

  function emitLocationChange() {
    try {
      window.dispatchEvent(new Event('mentari:locationchange'));
    } catch (e) {
      /* ignore */
    }
  }

  const originalPushState = history.pushState;
  history.pushState = function () {
    const result = originalPushState.apply(this, arguments);
    emitLocationChange();
    return result;
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function () {
    const result = originalReplaceState.apply(this, arguments);
    emitLocationChange();
    return result;
  };

  window.addEventListener('popstate', emitLocationChange);
  window.addEventListener('hashchange', emitLocationChange);

  function isVisible(node) {
    if (!node || !node.isConnected) return false;
    const rect = node.getBoundingClientRect();
    return !!(rect && rect.width > 1 && rect.height > 1);
  }

  function editorEntries() {
    return Array.from(document.querySelectorAll('.ck-editor__editable'))
      .filter(function (node) {
        return node && node.ckeditorInstance;
      })
      .map(function (node) {
        return {
          node: node,
          editor: node.ckeditorInstance,
          visible: isVisible(node)
        };
      });
  }

  function pickEntry(entries, data) {
    if (!entries.length) return null;
    if (Number.isInteger(data.index) && entries[data.index]) return entries[data.index];

    const visible = entries.filter(function (entry) {
      return entry.visible;
    });
    if (visible.length) return visible[visible.length - 1];
    return entries[entries.length - 1];
  }

  function readEditor(editor) {
    if (!editor) return '';
    try {
      if (typeof editor.getData === 'function') return String(editor.getData() || '');
      if (editor.data && typeof editor.data.get === 'function') {
        return String(editor.data.get() || '');
      }
    } catch (e) {
      /* ignore */
    }
    return '';
  }

  function writeEditor(editor, html) {
    if (!editor) return false;
    try {
      if (typeof editor.setData === 'function') {
        editor.setData(html);
        return true;
      }
      if (editor.data && typeof editor.data.set === 'function') {
        editor.data.set(html);
        return true;
      }
    } catch (e) {
      /* ignore */
    }
    return false;
  }

  function respond(payload) {
    try {
      window.postMessage(Object.assign({ channel: CHANNEL }, payload), '*');
    } catch (e) {
      /* ignore */
    }
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL) return;

    if (data.type === 'auth:get') {
      try {
        const raw = localStorage.getItem('access');
        const list = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(list)) throw new Error('Format access tidak dikenal.');

        let index = parseInt(localStorage.getItem('accessIndex') || '0', 10);
        if (!Number.isFinite(index) || index < 0 || index >= list.length) index = 0;

        const item = list[index];
        respond({
          type: 'auth:result',
          requestId: data.requestId,
          ok: !!(item && item.token),
          role: item ? item.role : null,
          token: item ? item.token : null
        });
      } catch (error) {
        respond({
          type: 'auth:result',
          requestId: data.requestId,
          ok: false,
          message: String((error && error.message) || error)
        });
      }
      return;
    }

    if (data.type === 'ckeditor:list') {
      const entries = editorEntries();
      respond({
        type: 'ckeditor:list-result',
        requestId: data.requestId,
        count: entries.length,
        visible: entries.filter(function (entry) {
          return entry.visible;
        }).length,
        ok: true
      });
      return;
    }

    if (data.type === 'ckeditor:get') {
      try {
        const entries = editorEntries();
        const entry = pickEntry(entries, data);
        if (!entry) throw new Error('Editor CKEditor tidak ditemukan di halaman ini.');
        respond({
          type: 'ckeditor:get-result',
          requestId: data.requestId,
          ok: true,
          html: readEditor(entry.editor),
          visible: entry.visible,
          index: entries.indexOf(entry)
        });
      } catch (error) {
        respond({
          type: 'ckeditor:get-result',
          requestId: data.requestId,
          ok: false,
          message: String((error && error.message) || error)
        });
      }
      return;
    }

    if (data.type === 'ckeditor:set') {
      try {
        const entries = editorEntries();
        if (!entries.length) {
          throw new Error('Editor CKEditor tidak ditemukan di halaman ini.');
        }

        const html = String(data.html || '');
        const targets = data.all
          ? entries.map(function (entry) {
              return entry;
            })
          : [pickEntry(entries, data)].filter(Boolean);

        if (!targets.length) throw new Error('Editor tujuan tidak ditemukan.');

        let written = 0;
        targets.forEach(function (entry) {
          if (writeEditor(entry.editor, html)) written += 1;
        });

        if (!written) throw new Error('Editor menolak data balasan.');
        respond({
          type: 'ckeditor:result',
          requestId: data.requestId,
          ok: true,
          count: written,
          index: targets.length === 1 ? entries.indexOf(targets[0]) : null,
          visible: targets.length === 1 ? targets[0].visible : null
        });
      } catch (error) {
        respond({
          type: 'ckeditor:result',
          requestId: data.requestId,
          ok: false,
          message: String((error && error.message) || error)
        });
      }
    }
  });

  emitLocationChange();
})();
