(function () {
  const NS = window.MentariExt;
  const $ = function (id) {
    return document.getElementById(id);
  };

  function setStatus(text, tone) {
    const el = $('status');
    el.textContent = text || '';
    el.className = 'status' + (tone ? ' ' + tone : '');
  }

  async function load() {
    const settings = await NS.storage.getSettings();
    const threshold = Number(settings.confidenceThreshold);
    $('threshold').value = Number.isFinite(threshold) ? threshold : 0.6;
    const batch = Number(settings.batchSize);
    $('batchSize').value = Number.isFinite(batch) ? batch : 15;
    $('context').value = settings.context || '';
    $('debug').checked = !!settings.debug;
  }

  $('save').addEventListener('click', function () {
    const threshold = Math.max(0, Math.min(1, Number($('threshold').value) || 0.6));
    const batchSize = Math.max(1, Math.min(20, parseInt($('batchSize').value, 10) || 15));

    NS.storage
      .setSettings({
        confidenceThreshold: threshold,
        batchSize: batchSize,
        context: $('context').value,
        debug: $('debug').checked
      })
      .then(function () {
        setStatus('Tersimpan.', 'ok');
      })
      .catch(function (error) {
        setStatus('Gagal menyimpan: ' + (error.message || error), 'error');
      });
  });

  load().catch(function (error) {
    setStatus('Gagal memuat: ' + (error.message || error), 'error');
  });
})();
