(function (root) {
  const NS = (root.MentariExt = root.MentariExt || {});

  let running = false;
  let runToken = 0;
  let reloadTimer = null;
  let autoTimer = null;
  let startWatch = null;
  let startWatchBusy = false;
  let startWatchTries = 0;

  function makeError(message, code) {
    const error = new Error(message);
    error.code = code || 'ERROR';
    return error;
  }

  function clamp01(value) {
    if (!Number.isFinite(value)) return 0.5;
    return Math.max(0, Math.min(1, value));
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

  function extractQuizPayload(response) {
    if (response === null || response === undefined) {
      return { questions: [], endAt: null };
    }
    if (Array.isArray(response)) {
      return { questions: response, endAt: null };
    }
    if (Array.isArray(response.data)) {
      return { questions: response.data, endAt: response.end_at || null };
    }

    const rootNode = response.data && typeof response.data === 'object' ? response.data : response;
    let questions = [];
    if (Array.isArray(rootNode.data)) questions = rootNode.data;
    else if (Array.isArray(rootNode.questions)) questions = rootNode.questions;
    else if (Array.isArray(rootNode.soal)) questions = rootNode.soal;

    return {
      questions: questions,
      endAt: response.end_at || response.endAt || rootNode.end_at || rootNode.endAt || null
    };
  }

  function normalizeQuestion(question, index) {
    const type = String(question.jenis_soal || question.jenisSoal || '').toUpperCase();
    const isDescription = type.indexOf('DESCRIPTION') >= 0;
    const isEssay = type.indexOf('ESSAY') >= 0;
    const isMc =
      type.indexOf('MULTIPLE') >= 0 ||
      (!isDescription && !isEssay && Array.isArray(question.list_jawaban));

    const rawOptions = Array.isArray(question.list_jawaban) ? question.list_jawaban : [];
    const options = rawOptions
      .map(function (option) {
        return {
          id: option.id,
          text: stripHtml(option.jawaban !== undefined ? option.jawaban : option.konten)
        };
      })
      .filter(function (option) {
        return option.text;
      });

    return {
      index: index,
      id: question.id,
      type: type,
      text: stripHtml(question.deskripsi || question.pertanyaan || ''),
      options: options,
      isDescription: isDescription,
      isEssay: isEssay,
      isMc: isMc,
      answered: question.id_jawaban !== undefined && question.id_jawaban !== null
    };
  }

  function getCourseTitle() {
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
      .map(function (node) {
        return (node.textContent || '').trim();
      })
      .filter(function (text) {
        return text && text.length <= 140;
      });

    if (headings.length) return headings[0];

    const title = (document.title || '').replace(/\s*\|.*$/, '').trim();
    return title || 'Mentari UNPAM';
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

  function messageFor(error) {
    if (!error) return 'Terjadi kesalahan tidak diketahui.';
    if (error.code === 'NO_SESSION') return 'Sesi login tidak ditemukan. Silakan login ulang di Mentari.';
    if (error.code === 'UNAUTHORIZED') return 'Sesi kedaluwarsa (401). Silakan login ulang di Mentari.';
    if (error.code === 'FORBIDDEN') return 'Akses ditolak (403) untuk akun ini.';
    return error.message || String(error);
  }

  function readLastRun() {
    try {
      const raw = sessionStorage.getItem(NS.SESSION.QUIZ_LAST_RUN);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data.at !== 'number') return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function showLastRun(routeKey, ui) {
    const last = readLastRun();
    if (!last || last.routeKey !== routeKey) return false;
    if (Date.now() - last.at > 30 * 60 * 1000) return false;

    ui.setStatus(
      'Sesi sebelumnya: ' + last.filled + ' jawaban tersimpan, ' + last.failed + ' gagal.',
      last.failed ? 'warn' : 'ok'
    );

    const lines = [];
    if (last.low && last.low.length) {
      lines.push(
        'Confidence rendah: ' +
          last.low
            .map(function (item) {
              return '#' + item.no;
            })
            .join(', ')
      );
    }
    if (last.skipped && last.skipped.essay) {
      lines.push(last.skipped.essay + ' soal essay perlu diisi manual.');
    }
    ui.setSummary(lines);
    ui.note('Review jawaban di tiap halaman, lalu klik "Selesai Quiz" sendiri.');
    return true;
  }

  function summaryRouteKey(params) {
    return [params.kodeCourses || '', params.subSectionId || ''].join('|');
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  async function readQuizState(params) {
    try {
      const response = await NS.api.quizGet(params.subSectionId, params.idQuizUser);
      return extractQuizPayload(response);
    } catch (e) {
      return null;
    }
  }

  function describeError(error) {
    if (!error) return 'kesalahan tidak diketahui';
    const message = error.message || String(error);
    if (error.status && message.indexOf('HTTP ' + error.status) < 0) {
      return message + ' (HTTP ' + error.status + ')';
    }
    return message;
  }

  async function init(params, ui) {
    const access = NS.api.readAccess();
    if (!access) {
      ui.setStatus('Sesi login tidak ditemukan. Silakan login ulang di Mentari.', 'error');
      ui.clearActions();
      return;
    }

    if (access.role && access.role.indexOf('mahasiswa') < 0) {
      ui.setStatus('Role "' + access.role + '" tidak didukung untuk pengisian otomatis.', 'warn');
      ui.clearActions();
      return;
    }

    const restored = showLastRun(summaryRouteKey(params), ui);
    if (!restored) {
      ui.setStatus('Siap. Soal pilihan ganda akan dijawab otomatis oleh AI.', 'info');
    }

    ui.addAction(
      'Isi Jawaban Otomatis',
      function () {
        return run(params, ui);
      },
      { primary: true }
    );

    ui.addAction('Cek Sesi', function () {
      const current = NS.api.readAccess();
      if (current) {
        ui.setStatus('Sesi OK · role: ' + (current.role || 'tidak diketahui'), 'ok');
      } else {
        ui.setStatus('Sesi tidak ditemukan. Login ulang di Mentari.', 'error');
      }
    });

    const autoToken = runToken;
    autoTimer = setTimeout(function () {
      autoTimer = null;
      if (autoToken !== runToken || running) return;
      run(params, ui);
    }, 1200);
  }

  function cleanup() {
    runToken += 1;
    running = false;
    if (reloadTimer) {
      clearInterval(reloadTimer);
      reloadTimer = null;
    }
    if (autoTimer) {
      clearTimeout(autoTimer);
      autoTimer = null;
    }
    stopStartWatch();
  }

  function stopStartWatch() {
    if (startWatch) {
      clearInterval(startWatch);
      startWatch = null;
    }
    startWatchBusy = false;
    startWatchTries = 0;
  }

  function startWatchForQuiz(params, ui, token) {
    if (startWatch) {
      ui.note('Masih menunggu quiz dimulai… Klik "Mulai Quiz" di halaman.');
      return;
    }

    startWatchTries = 0;
    ui.note(
      'Menunggu quiz dimulai… Klik "Mulai Quiz" di halaman; jawaban akan diisi otomatis setelah quiz berjalan.'
    );

    startWatch = setInterval(async function () {
      if (token !== runToken) {
        stopStartWatch();
        return;
      }
      if (running || startWatchBusy) return;

      if (startWatchTries >= 200) {
        stopStartWatch();
        if (token === runToken) {
          ui.setStatus('Quiz belum dimulai. Klik "Mulai Quiz" lalu "Coba Lagi".', 'warn');
        }
        return;
      }
      startWatchTries += 1;
      startWatchBusy = true;

      try {
        const response = await NS.api.quizGet(params.subSectionId, params.idQuizUser);
        if (token !== runToken) {
          stopStartWatch();
          return;
        }

        const parsed = extractQuizPayload(response);
        if (parsed.endAt) {
          stopStartWatch();
          ui.setStatus('Quiz sudah selesai. Jawaban tidak diubah.', 'info');
          return;
        }
        if (parsed.questions.length) {
          stopStartWatch();
          run(params, ui);
        }
      } catch (e) {
        /* quiz belum siap; coba lagi pada interval berikutnya */
      } finally {
        startWatchBusy = false;
      }
    }, 3000);
  }

  async function run(params, ui) {
    if (running) return;

    if (autoTimer) {
      clearTimeout(autoTimer);
      autoTimer = null;
    }

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
      debugEnabled = !!settings.debug;
      if (!settings.apiKey) {
        throw makeError(
          'API key Gemini belum diatur. Buka popup extension, isi API key, lalu simpan.',
          'NO_API_KEY'
        );
      }

      ui.setStatus('Mengambil soal dari server Mentari…', 'info');
      let response;
      try {
        response = await NS.api.quizGet(params.subSectionId, params.idQuizUser);
      } catch (error) {
        if (error && error.status === 404) {
          throw makeError(
            'Quiz belum dimulai. Klik "Mulai Quiz" terlebih dahulu, lalu coba lagi.',
            'NOT_STARTED'
          );
        }
        throw error;
      }
      if (!alive()) return;

      const parsed = extractQuizPayload(response);
      if (parsed.endAt) {
        ui.setStatus('Quiz sudah selesai. Jawaban tidak diubah.', 'info');
        ui.addAction('Muat Ulang', function () {
          location.reload();
        });
        ui.addAction('Isi Jawaban Otomatis', function () {
          return run(params, ui);
        });
        ui.note('Jika kamu baru mengulang quiz, muat ulang halaman agar pengisian otomatis berjalan.');
        return;
      }
      if (!parsed.questions.length) {
        throw makeError(
          'Quiz belum dimulai. Klik "Mulai Quiz" terlebih dahulu, lalu coba lagi.',
          'NOT_STARTED'
        );
      }

      const items = parsed.questions.map(normalizeQuestion).filter(function (item) {
        return item.id !== undefined && item.id !== null;
      });

      const pending = items.filter(function (item) {
        return item.isMc && item.options.length > 0 && !item.answered;
      });

      const skipped = {
        essay: items.filter(function (item) {
          return item.isEssay;
        }).length,
        description: items.filter(function (item) {
          return item.isDescription;
        }).length,
        answered: items.filter(function (item) {
          return item.isMc && item.answered;
        }).length,
        noOptions: items.filter(function (item) {
          return item.isMc && !item.answered && !item.options.length;
        }).length
      };

      if (!pending.length) {
        if (!showLastRun(summaryRouteKey(params), ui)) {
          ui.setStatus('Tidak ada soal pilihan ganda yang perlu diisi.', 'info');
          ui.setSummary(buildSkippedLines(skipped));
        }
        ui.addAction('Muat Ulang', function () {
          location.reload();
        });
        return;
      }

      sessionStorage.removeItem(NS.SESSION.QUIZ_LAST_RUN);

      const courseTitle = getCourseTitle();
      const resolved = [];
      const failed = [];
      const batchSize = Math.min(Math.max(parseInt(settings.batchSize, 10) || 15, 1), 20);

      for (let offset = 0; offset < pending.length; offset += batchSize) {
        if (!alive()) return;
        const batch = pending.slice(offset, offset + batchSize);
        ui.setStatus(
          'AI menjawab ' +
            Math.min(offset + batch.length, pending.length) +
            '/' +
            pending.length +
            ' soal…',
          'info'
        );

        const aiPayload = {
          courseTitle: courseTitle,
          context: settings.context || '',
          questions: batch.map(function (item) {
            return {
              id: String(item.id),
              text: item.text.slice(0, 4000),
              options: item.options.map(function (option) {
                return { id: String(option.id), text: option.text.slice(0, 600) };
              })
            };
          })
        };

        const aiResponse = await sendMessage({
          type: NS.MESSAGES.AI_QUIZ_ANSWERS,
          payload: aiPayload
        });
        if (!alive()) return;

        if (!aiResponse || !aiResponse.ok) {
          const detail =
            (aiResponse && aiResponse.error && aiResponse.error.message) || 'AI gagal menjawab.';
          throw makeError(detail, (aiResponse && aiResponse.error && aiResponse.error.code) || 'AI_ERROR');
        }

        const answerList = Array.isArray(aiResponse.answers) ? aiResponse.answers : [];
        const byId = new Map();
        batch.forEach(function (item) {
          byId.set(String(item.id), item);
        });

        const handled = new Set();
        answerList.forEach(function (answer) {
          if (!answer || answer.id === undefined || answer.id === null) return;
          const key = String(answer.id);
          const item = byId.get(key);
          if (!item || handled.has(key)) return;
          handled.add(key);

          const option = item.options.find(function (candidate) {
            return String(candidate.id) === String(answer.option_id);
          });
          if (!option) {
            failed.push({ id: item.id, reason: 'Opsi dari AI tidak dikenal.' });
            return;
          }

          resolved.push({
            item: item,
            option: option,
            confidence: clamp01(Number(answer.confidence)),
            reason: String(answer.reason || '')
          });
        });

        batch.forEach(function (item) {
          if (!handled.has(String(item.id))) {
            failed.push({ id: item.id, reason: 'AI tidak menjawab soal ini.' });
          }
        });
      }

      if (!resolved.length) {
        throw makeError('AI tidak menghasilkan jawaban yang bisa dipakai.', 'NO_RESULT');
      }

      if (!alive()) return;
      ui.setStatus('Menyimpan ' + resolved.length + ' jawaban ke server…', 'info');
      let savedCount = 0;
      for (let index = 0; index < resolved.length; index += 1) {
        if (!alive()) return;
        const entry = resolved[index];
        const answerBody = {
          id_trx_quiz_user_soal: entry.item.id,
          id_jawaban: entry.option.id,
          jawaban: null
        };

        try {
          await NS.api.quizJawab(answerBody);
          savedCount += 1;
        } catch (error) {
          if (error && (error.code === 'UNAUTHORIZED' || error.code === 'FORBIDDEN')) {
            throw error;
          }

          await delay(300);
          if (!alive()) return;

          try {
            await NS.api.quizJawab(answerBody);
            savedCount += 1;
            continue;
          } catch (retryError) {
            const state = await readQuizState(params);
            if (state && state.endAt) {
              ui.setStatus(
                'Quiz sudah selesai saat menyimpan. ' +
                  savedCount +
                  '/' +
                  resolved.length +
                  ' jawaban tersimpan.',
                'warn'
              );
              ui.addAction('Muat Ulang', function () {
                location.reload();
              });
              ui.note('Jawaban yang sudah tersimpan tetap tersimpan. Periksa kembali di halaman quiz.');
              return;
            }

            if (debugEnabled) {
              console.warn('[Mentari AI] quiz save failed', entry.item.id, retryError);
            }
            throw makeError(
              'Gagal menyimpan jawaban soal #' +
                (entry.item.index + 1) +
                ' (' +
                describeError(retryError) +
                '). ' +
                savedCount +
                '/' +
                resolved.length +
                ' jawaban tersimpan.',
              (retryError && retryError.code) || 'SAVE_ERROR'
            );
          }
        }
      }

      if (!alive()) return;

      const threshold = Number(settings.confidenceThreshold);
      const low = resolved
        .filter(function (entry) {
          return entry.confidence < (Number.isFinite(threshold) ? threshold : 0.6);
        })
        .map(function (entry) {
          return {
            no: entry.item.index + 1,
            confidence: entry.confidence,
            reason: entry.reason
          };
        });

      const summary = {
        at: Date.now(),
        routeKey: summaryRouteKey(params),
        filled: resolved.length,
        failed: failed.length,
        skipped: skipped,
        low: low.slice(0, 8)
      };
      sessionStorage.setItem(NS.SESSION.QUIZ_LAST_RUN, JSON.stringify(summary));

      renderResult(summary, ui);

      let countdown = 4;
      if (reloadTimer) clearInterval(reloadTimer);
      reloadTimer = setInterval(function () {
        if (!alive()) {
          clearInterval(reloadTimer);
          reloadTimer = null;
          return;
        }
        countdown -= 1;
        if (countdown <= 0) {
          clearInterval(reloadTimer);
          reloadTimer = null;
          location.reload();
          return;
        }
        ui.setStatus(
          'Jawaban tersimpan. Halaman dimuat ulang dalam ' + countdown + ' detik…',
          'ok'
        );
      }, 1000);

      ui.addAction(
        'Muat Ulang Sekarang',
        function () {
          if (reloadTimer) {
            clearInterval(reloadTimer);
            reloadTimer = null;
          }
          location.reload();
        },
        { primary: true }
      );
    } catch (error) {
      if (!alive()) return;
      if (debugEnabled) console.warn('[Mentari AI] quiz', error);
      ui.setStatus(messageFor(error), 'error');
      ui.addAction(
        'Coba Lagi',
        function () {
          return run(params, ui);
        },
        { primary: true }
      );
      if (error && error.code === 'NOT_STARTED') {
        startWatchForQuiz(params, ui, token);
      } else if (error && error.code === 'NO_API_KEY') {
        ui.note('Klik ikon extension di toolbar browser untuk mengisi API key Gemini.');
      }
    } finally {
      if (alive()) {
        running = false;
        ui.setBusy(false);
      }
    }
  }

  function buildSkippedLines(skipped) {
    const lines = [];
    if (skipped.essay) lines.push(skipped.essay + ' soal essay dilewati (isi manual).');
    if (skipped.answered) lines.push(skipped.answered + ' soal sudah terjawab manual, tidak diubah.');
    if (skipped.description) lines.push(skipped.description + ' blok deskripsi dilewati.');
    if (skipped.noOptions) lines.push(skipped.noOptions + ' soal tanpa opsi dilewati.');
    return lines;
  }

  function renderResult(summary, ui) {
    ui.setStatus(
      'Selesai: ' + summary.filled + ' jawaban tersimpan, ' + summary.failed + ' gagal.',
      summary.failed ? 'warn' : 'ok'
    );

    const lines = buildSkippedLines(summary.skipped);
    if (summary.failed) lines.push(summary.failed + ' soal gagal diisi.');
    if (summary.low.length) {
      lines.push(
        'Confidence rendah: ' +
          summary.low
            .map(function (item) {
              return '#' + item.no + ' (' + Math.round(item.confidence * 100) + '%)';
            })
            .join(', ')
      );
    }
    ui.setSummary(lines);

    if (summary.low.length) {
      ui.note(
        'Alasan AI untuk confidence rendah:\n' +
          summary.low
            .map(function (item) {
              return '#' + item.no + ': ' + (item.reason || '-');
            })
            .join('\n')
      );
    }

    ui.note('Review tiap halaman, lalu klik "Selesai Quiz" sendiri. Extension tidak mengakhiri quiz.');
  }

  let debugEnabled = false;

  NS.features = NS.features || {};
  NS.features.quiz = {
    init: init,
    cleanup: cleanup,
    setDebug: function (value) {
      debugEnabled = !!value;
    }
  };
})(globalThis);
