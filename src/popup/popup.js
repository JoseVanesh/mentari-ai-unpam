(function () {
  const NS = window.MentariExt;
  const $ = function (id) {
    return document.getElementById(id);
  };

  let settings = null;

  function setStatus(text, tone) {
    const el = $('status');
    el.textContent = text || '';
    el.className = 'status' + (tone ? ' ' + tone : '');
  }

  function fillModels(selected) {
    const input = $('model');
    const list = $('modelOptions');
    list.innerHTML = '';
    NS.MODELS.forEach(function (model) {
      const option = document.createElement('option');
      option.value = model.id;
      option.label = model.label;
      list.appendChild(option);
    });
    input.value = selected || NS.MODELS[0].id;
  }

  async function load() {
    settings = await NS.storage.getSettings();
    $('apiKey').value = settings.apiKey || '';
    fillModels(settings.model || NS.MODELS[0].id);
    $('featQuiz').checked = !!(settings.features && settings.features.quiz);
    $('featKuesioner').checked = !!(settings.features && settings.features.kuesioner);
    $('featForum').checked = !!(settings.features && settings.features.forum);
  }

  function collect() {
    return {
      apiKey: $('apiKey').value.trim(),
      model: $('model').value.trim() || NS.MODELS[0].id,
      features: {
        quiz: $('featQuiz').checked,
        kuesioner: $('featKuesioner').checked,
        forum: $('featForum').checked
      }
    };
  }

  async function save(silent) {
    settings = await NS.storage.setSettings(collect());
    if (!silent) setStatus('Tersimpan.', 'ok');
    return settings;
  }

  $('toggleKey').addEventListener('click', function () {
    const input = $('apiKey');
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    $('toggleKey').textContent = showing ? 'Tampilkan' : 'Sembunyikan';
  });

  $('save').addEventListener('click', function () {
    save(false).catch(function (error) {
      setStatus('Gagal menyimpan: ' + (error.message || error), 'error');
    });
  });

  $('test').addEventListener('click', function () {
    save(true)
      .then(function () {
        setStatus('Menguji koneksi ke Gemini…', 'info');

        let settled = false;
        const timer = setTimeout(function () {
          if (settled) return;
          settled = true;
          setStatus(
            'Gagal: timeout menunggu background. Reload extension (chrome://extensions) lalu coba lagi.',
            'error'
          );
        }, 75000);

        function finish(text, tone) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          setStatus(text, tone);
        }

        try {
          chrome.runtime.sendMessage(
            {
              type: NS.MESSAGES.TEST_CONNECTION,
              model: $('model').value.trim() || NS.MODELS[0].id
            },
            function (response) {
              const lastError = chrome.runtime.lastError;
              if (lastError) {
                finish('Gagal: ' + lastError.message, 'error');
                return;
              }
              if (response && response.ok) {
                finish(
                  'OK · ' +
                    response.model +
                    ' · ' +
                    response.latencyMs +
                    ' ms' +
                    (response.via ? ' · ' + response.via : ''),
                  'ok'
                );
              } else {
                const detail =
                  (response && response.error && response.error.message) || 'Tidak diketahui';
                finish('Gagal: ' + detail, 'error');
              }
            }
          );
        } catch (error) {
          finish('Gagal: ' + (error.message || error), 'error');
        }
      })
      .catch(function (error) {
        setStatus('Gagal: ' + (error.message || error), 'error');
      });
  });

  load().catch(function (error) {
    setStatus('Gagal memuat pengaturan: ' + (error.message || error), 'error');
  });
})();
