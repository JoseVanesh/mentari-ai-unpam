(function (root) {
  const NS = (root.MentariExt = root.MentariExt || {});

  const CHANNEL = 'MENTARI_EXT';

  let running = false;
  let runToken = 0;

  function makeError(message, code) {
    const error = new Error(message);
    error.code = code || 'ERROR';
    return error;
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function isVisible(node) {
    if (!node || !node.isConnected) return false;
    const rect = node.getBoundingClientRect();
    return !!(rect && rect.width > 1 && rect.height > 1);
  }

  function stripHtml(html) {
    if (html === null || html === undefined) return '';
    const raw = String(html);
    if (!/[<&]/.test(raw)) return raw.replace(/\s+/g, ' ').trim();

    try {
      const doc = new DOMParser().parseFromString(raw, 'text/html');
      doc.querySelectorAll('script,style').forEach(function (node) {
        node.remove();
      });
      doc.querySelectorAll('img').forEach(function (img) {
        const alt = img.getAttribute('alt');
        img.replaceWith(doc.createTextNode(alt ? ' [gambar: ' + alt + '] ' : ' [gambar] '));
      });
      return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
    } catch (e) {
      return raw
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
  }

  function plainText(text) {
    let value = String(text || '');
    value = value.replace(/^```[a-z]*\s*/i, '').replace(/```$/i, '');
    value = value
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\/\s*p\s*>/gi, '\n\n')
      .replace(/<[^>]+>/g, '');
    value = value.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    value = value.replace(/^["\u201c]([\s\S]*)["\u201d]$/, '$1').trim();
    return value;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toHtml(text) {
    const value = plainText(text);
    if (!value) return '';
    return value
      .split(/\n{2,}/)
      .map(function (paragraph) {
        return paragraph.trim();
      })
      .filter(Boolean)
      .map(function (paragraph) {
        return '<p>' + escapeHtml(paragraph).replace(/\n/g, '<br>') + '</p>';
      })
      .join('');
  }

  function authorName(item) {
    if (!item || typeof item !== 'object') return '';
    const mahasiswa = item.mahasiswa || {};
    const dosen = item.dosen || {};
    return String(mahasiswa.nama_mahasiswa || dosen.nama_gelar || dosen.nama_dosen || '').trim();
  }

  function sendMessage(message) {
    return new Promise(function (resolve, reject) {
      try {
        chrome.runtime.sendMessage(message, function (response) {
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            reject(
              makeError(
                'Tidak dapat menghubungi background extension: ' +
                  lastError.message +
                  '. Muat ulang halaman lalu coba lagi.',
                'EXTENSION_ERROR'
              )
            );
            return;
          }
          resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function bridgeRequest(type, payload, resultType) {
    return new Promise(function (resolve, reject) {
      const requestId = 'ck-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      let settled = false;

      const cleanup = function () {
        settled = true;
        window.removeEventListener('message', onMessage);
      };

      const onMessage = function (event) {
        if (event.source !== window || settled) return;
        const data = event.data;
        if (!data || data.channel !== CHANNEL) return;
        if (data.type !== resultType || data.requestId !== requestId) return;
        cleanup();
        if (data.ok) resolve(data);
        else reject(makeError(data.message || 'Editor CKEditor gagal diproses.', 'EDITOR'));
      };

      window.addEventListener('message', onMessage);

      try {
        window.postMessage(
          Object.assign({ channel: CHANNEL, type: type, requestId: requestId }, payload || {}),
          '*'
        );
      } catch (error) {
        cleanup();
        reject(error);
        return;
      }

      setTimeout(function () {
        if (settled) return;
        cleanup();
        reject(makeError('Editor tidak merespons. Coba muat ulang halaman.', 'EDITOR_TIMEOUT'));
      }, 3000);
    });
  }

  function forumSelectors() {
    return (NS.SELECTORS && NS.SELECTORS.forum) || {};
  }

  function visibleButtons() {
    return Array.from(document.querySelectorAll('button')).filter(isVisible);
  }

  function findReplyButton() {
    const pattern = forumSelectors().replyLabel || /^reply$/i;
    return (
      visibleButtons().find(function (button) {
        return !button.disabled && pattern.test((button.textContent || '').trim());
      }) || null
    );
  }

  function findReplyTextarea() {
    const needle = String(forumSelectors().replyPlaceholder || 'write your reply').toLowerCase();
    return (
      Array.from(document.querySelectorAll('textarea')).find(function (textarea) {
        if (!isVisible(textarea)) return false;
        return String(textarea.placeholder || '').toLowerCase().indexOf(needle) >= 0;
      }) || null
    );
  }

  function findVisibleEditor() {
    const selector = forumSelectors().ckEditor || '.ck-editor__editable';
    return (
      Array.from(document.querySelectorAll(selector)).find(function (node) {
        return node && node.ckeditorInstance && isVisible(node);
      }) || null
    );
  }

  function setTextareaValue(textarea, text) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    ).set;
    setter.call(textarea, text);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function ensureReplyTarget() {
    let editor = findVisibleEditor();
    if (editor) {
      if (editor.ckeditorInstance && editor.ckeditorInstance.isReadOnly) {
        throw makeError('Editor balasan sedang read-only. Kamu tidak dapat membalas topik ini.', 'READ_ONLY');
      }
      return { kind: 'ckeditor', node: editor };
    }

    let textarea = findReplyTextarea();
    if (textarea) return { kind: 'textarea', node: textarea };

    const button = findReplyButton();
    if (!button) {
      throw makeError(
        'Tombol "Reply" tidak ditemukan. Pastikan topik masih terbuka dan kamu berhak membalas.',
        'NO_REPLY_BUTTON'
      );
    }

    button.click();

    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
      await sleep(130);
      editor = findVisibleEditor();
      if (editor) return { kind: 'ckeditor', node: editor };
      textarea = findReplyTextarea();
      if (textarea) return { kind: 'textarea', node: textarea };
    }

    throw makeError(
      'Form balasan tidak muncul. Klik tombol "Reply" pada topik, lalu coba lagi.',
      'NO_REPLY_FORM'
    );
  }

  async function fillTextarea(textarea, text) {
    if (textarea.disabled || textarea.readOnly) {
      throw makeError('Kolom balasan dinonaktifkan. Kamu tidak dapat membalas topik ini.', 'READ_ONLY');
    }

    if (String(textarea.value || '').trim()) {
      throw makeError(
        'Kolom balasan sudah berisi. Kosongkan dulu jika ingin diisi AI.',
        'EDITOR_NOT_EMPTY'
      );
    }

    setTextareaValue(textarea, text);
    await sleep(120);

    if (!String(textarea.value || '').trim()) {
      throw makeError('Kolom balasan tidak menerima draf. Coba isi manual.', 'FILL_FAILED');
    }

    try {
      textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) {
      /* ignore */
    }

    return text.length;
  }

  async function fillEditor(html) {
    const check = await bridgeRequest('ckeditor:get', {}, 'ckeditor:get-result');
    if (stripHtml(check.html)) {
      throw makeError(
        'Editor balasan sudah berisi. Kosongkan dulu jika ingin diisi AI.',
        'EDITOR_NOT_EMPTY'
      );
    }

    await bridgeRequest('ckeditor:set', { html: html }, 'ckeditor:result');

    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      await sleep(120);
      try {
        const current = await bridgeRequest('ckeditor:get', {}, 'ckeditor:get-result');
        if (stripHtml(current.html)) {
          const node = findVisibleEditor();
          if (node) {
            try {
              node.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } catch (e) {
              /* ignore */
            }
          }
          return stripHtml(current.html).length;
        }
      } catch (e) {
        /* keep waiting */
      }
    }

    throw makeError('CKEditor tidak menampilkan draf. Coba isi manual.', 'FILL_FAILED');
  }

  function messageFor(error) {
    if (!error) return 'Terjadi kesalahan tidak diketahui.';
    if (error.code === 'NO_SESSION') return 'Sesi login tidak ditemukan. Silakan login ulang di Mentari.';
    if (error.code === 'UNAUTHORIZED') return 'Sesi kedaluwarsa (401). Silakan login ulang di Mentari.';
    if (error.code === 'FORBIDDEN') return 'Akses ditolak (403) untuk akun ini.';
    return error.message || String(error);
  }

  async function init(params, ui) {
    const access = NS.api.readAccess();
    if (!access) {
      ui.setStatus('Sesi login tidak ditemukan. Silakan login ulang di Mentari.', 'error');
      ui.clearActions();
      return;
    }

    if (access.role && access.role.indexOf('mahasiswa') < 0) {
      ui.setStatus('Role "' + access.role + '" tidak didukung untuk membalas forum.', 'warn');
      ui.clearActions();
      return;
    }

    ui.setStatus('Siap. AI akan menulis draf balasan untuk topik ini.', 'info');
    ui.addAction(
      'Balas dengan AI',
      function () {
        return run(params, ui);
      },
      { primary: true }
    );
    ui.note(
      'Draf diisi ke form balasan, bukan dikirim. Periksa dan edit dulu, lalu klik tombol kirim ' +
        '(ikon pesawat) sendiri.'
    );
    ui.note(
      'Ingin memakai CKEditor? Buka form "Reply", klik "Advanced" lebih dulu, baru tekan "Balas dengan AI".'
    );
  }

  function cleanup() {
    runToken += 1;
    running = false;
  }

  async function run(params, ui) {
    if (running) return;

    const token = runToken;
    const alive = function () {
      return token === runToken;
    };

    running = true;
    ui.reset();
    ui.setBusy(true);

    try {
      const settings = await NS.storage.getSettings();
      if (!alive()) return;
      if (!settings.apiKey) {
        throw makeError(
          'API key Gemini belum diatur. Buka popup extension, isi API key, lalu simpan.',
          'NO_API_KEY'
        );
      }

      ui.setStatus('Membaca topik dan balasan sebelumnya…', 'info');

      let topic = null;
      try {
        topic = await NS.api.forumReplies(params.topicId);
      } catch (error) {
        if (error && error.status === 404) {
          throw makeError('Topik forum tidak ditemukan.', 'NOT_FOUND');
        }
        throw error;
      }
      if (!alive()) return;

      if (!topic || typeof topic !== 'object') {
        throw makeError('Data topik forum tidak valid.', 'BAD_TOPIC');
      }

      const replies = Array.isArray(topic.data) ? topic.data : [];
      const aiPayload = {
        topicTitle: String(topic.judul || ''),
        topicContent: stripHtml(topic.konten || ''),
        replies: replies.slice(-8).map(function (reply) {
          return {
            name: authorName(reply),
            content: stripHtml(reply.konten || '')
          };
        }),
        context: settings.context || ''
      };

      if (!aiPayload.topicTitle.trim() && !aiPayload.topicContent.trim()) {
        throw makeError('Topik forum tidak memiliki judul atau isi.', 'EMPTY_TOPIC');
      }

      ui.setStatus('AI menulis draf balasan…', 'info');
      const response = await sendMessage({
        type: NS.MESSAGES.AI_FORUM_REPLY,
        payload: aiPayload
      });
      if (!alive()) return;

      if (!response || !response.ok) {
        throw makeError(
          (response && response.error && response.error.message) || 'AI gagal menulis balasan.',
          (response && response.error && response.error.code) || 'AI_ERROR'
        );
      }

      const draft = plainText(response.text);
      if (!draft) {
        throw makeError('AI menghasilkan balasan kosong.', 'EMPTY');
      }

      ui.setStatus('Membuka form balasan…', 'info');
      const target = await ensureReplyTarget();
      if (!alive()) return;

      let length = 0;
      if (target.kind === 'ckeditor') {
        length = await fillEditor(toHtml(draft));
      } else {
        length = await fillTextarea(target.node, draft);
      }

      if (!alive()) return;

      ui.setStatus(
        'Draf balasan terisi (' + length + ' karakter). Periksa, edit bila perlu, lalu klik kirim sendiri.',
        'ok'
      );
      ui.setSummary([
        'Topik: ' + (aiPayload.topicTitle || '(tanpa judul)'),
        'Draf: ' + length + ' karakter',
        'Balasan sebelumnya dibaca: ' + Math.min(replies.length, 8)
      ]);

      if (target.kind === 'textarea') {
        ui.note(
          'Draf diisi ke kolom balasan biasa. Edit langsung di kolom ini; jangan beralih ke "Advanced" ' +
            'setelah terisi karena isi kolom bisa hilang.'
        );
      }
      ui.note(
        'Extension TIDAK mengirim balasan. Klik tombol kirim (ikon pesawat) di form setelah memeriksa isinya.'
      );

      ui.addAction('Gulir ke Editor', function () {
        const node = target.kind === 'ckeditor' ? findVisibleEditor() : findReplyTextarea();
        if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    } catch (error) {
      if (!alive()) return;
      ui.setStatus(messageFor(error), 'error');
      ui.addAction(
        'Coba Lagi',
        function () {
          return run(params, ui);
        },
        { primary: true }
      );
      if (error && error.code === 'NO_API_KEY') {
        ui.note('Klik ikon extension di toolbar browser untuk mengisi API key Gemini.');
      }
      if (error && error.code === 'NO_REPLY_BUTTON') {
        ui.note('Buka salah satu topik, tunggu tombol "Reply" muncul, lalu coba lagi.');
      }
      if (error && error.code === 'EDITOR_NOT_EMPTY') {
        ui.note('Hapus isi form balasan terlebih dahulu, lalu jalankan lagi.');
      }
    } finally {
      if (alive()) {
        running = false;
        ui.setBusy(false);
      }
    }
  }

  NS.features = NS.features || {};
  NS.features.forum = {
    init: init,
    cleanup: cleanup
  };
})(globalThis);
