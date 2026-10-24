(function (root) {
  const NS = (root.MentariExt = root.MentariExt || {});

  let running = false;
  let runToken = 0;

  const YES_WORDS = /\bya\b/i;

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

  function inputLabel(input) {
    const label = input.closest ? input.closest('label') : null;
    return ((label || input.parentElement || {}).textContent || '').trim();
  }

  function isYesNoGroup(group) {
    if (!group || !group.querySelectorAll) return false;
    const radios = Array.from(group.querySelectorAll('input[type="radio"]'));
    if (radios.length < 2) return false;

    const labels = radios
      .map(function (radio) {
        return inputLabel(radio);
      })
      .join(' ')
      .toLowerCase();
    if (labels.indexOf('ya') >= 0 && labels.indexOf('tidak') >= 0) return true;

    const values = radios.map(function (radio) {
      return String(radio.value);
    });
    return values.indexOf('1') >= 0 && values.indexOf('0') >= 0;
  }

  function getGroups() {
    const selector = (NS.SELECTORS && NS.SELECTORS.kuesioner && NS.SELECTORS.kuesioner.radioGroup) ||
      '[role="radiogroup"]';
    return Array.from(document.querySelectorAll(selector)).filter(isYesNoGroup);
  }

  function isAnswered(group) {
    return !!group.querySelector('input[type="radio"]:checked');
  }

  function findYesRadio(group) {
    const value = (NS.SELECTORS && NS.SELECTORS.kuesioner && NS.SELECTORS.kuesioner.yesValue) || '1';
    const byValue = group.querySelector('input[type="radio"][value="' + value + '"]');
    if (byValue) return byValue;

    return (
      Array.from(group.querySelectorAll('input[type="radio"]')).find(function (radio) {
        return YES_WORDS.test(inputLabel(radio));
      }) || null
    );
  }

  async function waitForGroups(timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 6000);
    do {
      const groups = getGroups().filter(function (group) {
        return isVisible(group);
      });
      if (groups.length) return groups;
      await sleep(150);
    } while (Date.now() < deadline);
    return [];
  }

  function messageFor(error) {
    if (!error) return 'Terjadi kesalahan tidak diketahui.';
    if (error.code === 'NO_SESSION') return 'Sesi login tidak ditemukan. Silakan login ulang di Mentari.';
    if (error.code === 'UNAUTHORIZED') return 'Sesi kedaluwarsa (401). Silakan login ulang di Mentari.';
    if (error.code === 'FORBIDDEN') return 'Akses ditolak (403) untuk akun ini.';
    if (error.code === 'NOT_FOUND') return 'Kuesioner tidak ditemukan.';
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
      ui.setStatus('Role "' + access.role + '" tidak didukung untuk mengisi kuesioner.', 'warn');
      ui.clearActions();
      return;
    }

    ui.setStatus('Siap. Mengisi otomatis jawaban "Ya" untuk pertanyaan yang masih kosong…', 'info');
    ui.addAction(
      'Isi "Ya" yang Kosong',
      function () {
        return run(params, ui);
      },
      { primary: true }
    );
    ui.note(
      'Kuesioner memakai pilihan Ya/Tidak. Extension hanya memilih "Ya" pada pertanyaan kosong. ' +
        'Periksa setiap jawaban, lalu klik "Submit Kuesioner" sendiri.'
    );

    const autoToken = runToken;
    setTimeout(function () {
      if (autoToken !== runToken || running) return;
      run(params, ui);
    }, 800);
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
      ui.setStatus('Memuat data kuesioner…', 'info');

      let data = null;
      try {
        data = await NS.api.kuesionerGet(params.kodeCourses, params.kodeSection);
      } catch (error) {
        if (error && error.status === 404) {
          throw makeError('Kuesioner tidak ditemukan di server.', 'NOT_FOUND');
        }
        throw error;
      }
      if (!alive()) return;

      const items =
        data && Array.isArray(data.kuesioner)
          ? data.kuesioner.filter(function (item) {
              return item && item.id !== undefined && item.id !== null;
            })
          : [];

      if (!items.length) {
        throw makeError('Kuesioner ini tidak memiliki pertanyaan.', 'NO_QUESTIONS');
      }

      ui.setStatus('Menunggu form kuesioner tampil…', 'info');
      const initialGroups = await waitForGroups(8000);
      if (!alive()) return;
      if (!initialGroups.length) {
        throw makeError(
          'Form kuesioner belum muncul. Tunggu halaman selesai memuat lalu coba lagi.',
          'NO_FORM'
        );
      }

      const total = initialGroups.length;
      let filled = 0;
      let skipped = 0;
      let missing = 0;
      let disabled = 0;

      for (let index = 0; index < total; index += 1) {
        if (!alive()) return;

        const group = getGroups()[index];
        if (!group) {
          missing += 1;
          continue;
        }

        if (isAnswered(group)) {
          skipped += 1;
          continue;
        }

        const yes = findYesRadio(group);
        if (!yes || yes.disabled) {
          if (yes && yes.disabled) disabled += 1;
          else missing += 1;
          continue;
        }

        ui.setStatus('Memilih "Ya" (' + (index + 1) + '/' + total + ')…', 'info');
        yes.click();
        filled += 1;
        await sleep(60);
      }

      if (!alive()) return;

      const finalGroups = getGroups();
      const totalFinal = finalGroups.length;
      const answered = finalGroups.filter(isAnswered).length;

      const lines = [];
      if (data && data.judul) lines.push('Judul: ' + String(data.judul));
      lines.push(answered + '/' + totalFinal + ' pertanyaan terisi.');
      if (skipped) lines.push(skipped + ' jawaban yang sudah ada tidak diubah.');
      if (filled) lines.push(filled + ' pertanyaan diisi "Ya".');
      if (missing) lines.push(missing + ' pertanyaan tidak dapat diisi (radio tidak ditemukan).');
      if (disabled) lines.push(disabled + ' radio dinonaktifkan oleh aplikasi.');
      ui.setSummary(lines);

      if (totalFinal > 0 && answered === totalFinal) {
        ui.setStatus(
          'Terisi ' + answered + '/' + totalFinal + '. Periksa, lalu klik "Submit Kuesioner" sendiri.',
          'ok'
        );
      } else if (filled > 0) {
        ui.setStatus(
          'Terisi ' + answered + '/' + totalFinal + '. Periksa jawaban yang tersisa sebelum submit.',
          'warn'
        );
      } else if (skipped > 0) {
        ui.setStatus('Semua pertanyaan sudah terisi. Tidak ada yang diubah.', 'info');
      } else {
        throw makeError(
          'Tidak dapat memilih jawaban "Ya". Pastikan kamu login sebagai mahasiswa dan form sudah tampil.',
          'NO_FILL'
        );
      }

      ui.note(
        'Extension TIDAK menekan "Submit Kuesioner". Jawaban "Ya" dipilih otomatis karena preferensi ' +
          '"selalu setuju"; periksa apakah setiap jawaban sudah sesuai.'
      );

      ui.addAction('Isi Ulang yang Kosong', function () {
        return run(params, ui);
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
      if (error && error.code === 'NO_FORM') {
        ui.note('Tunggu daftar pertanyaan muncul, lalu klik "Coba Lagi".');
      }
      if (error && error.code === 'NO_FILL') {
        ui.note('Pastikan akun berperan MAHASISWA dan kuesioner belum dikunci.');
      }
    } finally {
      if (alive()) {
        running = false;
        ui.setBusy(false);
      }
    }
  }

  NS.features = NS.features || {};
  NS.features.kuesioner = {
    init: init,
    cleanup: cleanup
  };
})(globalThis);
