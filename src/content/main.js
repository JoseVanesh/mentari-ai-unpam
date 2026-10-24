(function (root) {
  const NS = (root.MentariExt = root.MentariExt || {});
  if (!NS.detectRoute || !NS.ui) return;

  const LABELS = {
    exam: 'Exam / Quiz',
    quiz: 'Quiz',
    kuesioner: 'Kuesioner',
    forumTopics: 'Forum',
    forumTopic: 'Forum'
  };

  let currentKey = '';
  let currentType = 'unknown';
  let lastPath = '';
  let debounceTimer = null;
  let pollTimer = null;

  async function onRouteChange() {
    const route = NS.detectRoute(location.pathname);
    const key = NS.routeKey(route);
    if (key === currentKey) return;

    const previousType = currentType;
    currentKey = key;
    currentType = route.type;

    if (previousType === 'exam' && NS.features && NS.features.quiz) {
      NS.features.quiz.cleanup();
    }
    if (previousType === 'kuesioner' && NS.features && NS.features.kuesioner) {
      NS.features.kuesioner.cleanup();
    }
    if (previousType === 'forumTopic' && NS.features && NS.features.forum) {
      NS.features.forum.cleanup();
    }

    const ui = NS.ui;
    ui.ensure();

    if (route.type === 'unknown' || route.type === 'course') {
      ui.hide();
      return;
    }

    ui.show();
    ui.reset();
    ui.setRoute(LABELS[route.type] || route.type);

    if (route.type === 'quiz') {
      const settings = await NS.storage.getSettings();
      if (currentKey !== key) return;

      if (!settings.features || settings.features.quiz === false) {
        ui.setStatus('Fitur Quiz dimatikan di popup extension.', 'warn');
        ui.clearActions();
        return;
      }

      ui.setStatus(
        'Halaman detail quiz. Klik "Kerjakan Quiz" lalu "Mulai Quiz"; jawaban PG akan diisi otomatis.',
        'info'
      );
      ui.clearActions();
      ui.note('Extension tidak memulai atau mengakhiri quiz. Setelah quiz berjalan, jawaban diisi otomatis.');
      return;
    }

    if (route.type === 'exam') {
      const settings = await NS.storage.getSettings();
      if (currentKey !== key) return;

      if (!settings.features || settings.features.quiz === false) {
        ui.setStatus('Fitur Quiz dimatikan di popup extension.', 'warn');
        ui.clearActions();
        return;
      }

      if (NS.features.quiz.setDebug) NS.features.quiz.setDebug(settings.debug);

      await NS.features.quiz.init(
        {
          kodeCourses: route.kodeCourses,
          subSectionId: route.subSectionId,
          idQuizUser: route.idQuizUser,
          routeKey: key
        },
        ui
      );
      return;
    }

    if (route.type === 'kuesioner') {
      if (!NS.features || !NS.features.kuesioner) {
        ui.setStatus('Modul kuesioner gagal dimuat. Muat ulang halaman.', 'error');
        return;
      }

      const settings = await NS.storage.getSettings();
      if (currentKey !== key) return;

      if (!settings.features || settings.features.kuesioner === false) {
        ui.setStatus('Fitur Kuesioner dimatikan di popup extension.', 'warn');
        ui.clearActions();
        return;
      }

      await NS.features.kuesioner.init(
        {
          kodeCourses: route.kodeCourses,
          kodeSection: route.kodeSection,
          routeKey: key
        },
        ui
      );
      return;
    }

    if (route.type === 'forumTopic') {
      if (!NS.features || !NS.features.forum) {
        ui.setStatus('Modul forum gagal dimuat. Muat ulang halaman.', 'error');
        return;
      }

      const settings = await NS.storage.getSettings();
      if (currentKey !== key) return;

      if (!settings.features || settings.features.forum === false) {
        ui.setStatus('Fitur Forum dimatikan di popup extension.', 'warn');
        ui.clearActions();
        return;
      }

      await NS.features.forum.init(
        {
          kodeCourses: route.kodeCourses,
          subSectionId: route.subSectionId,
          topicId: route.topicId,
          routeKey: key
        },
        ui
      );
      return;
    }

    if (route.type === 'forumTopics') {
      const settings = await NS.storage.getSettings();
      if (currentKey !== key) return;

      if (!settings.features || settings.features.forum === false) {
        ui.setStatus('Fitur Forum dimatikan di popup extension.', 'warn');
        ui.clearActions();
        return;
      }

      ui.setStatus('Buka salah satu topik diskusi untuk membuat draf balasan dengan AI.', 'info');
      ui.note('Halaman daftar topik tidak diubah otomatis. Pilih topik, lalu panel akan menawarkan "Balas dengan AI".');
      ui.clearActions();
      return;
    }

    ui.hide();
  }

  function schedulePathCheck(force) {
    const path = location.pathname;
    if (!force && path === lastPath) return;
    lastPath = path;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      onRouteChange().catch(function (error) {
        if (!NS.ui) return;
        NS.ui.show();
        NS.ui.setStatus('Gagal memuat fitur: ' + ((error && error.message) || error), 'error');
      });
    }, 250);
  }

  function boot() {
    if (!document.body) {
      setTimeout(boot, 200);
      return;
    }

    NS.ui.ensure();

    window.addEventListener('mentari:locationchange', function () {
      schedulePathCheck(false);
    });
    window.addEventListener('popstate', function () {
      schedulePathCheck(false);
    });

    try {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local' || !changes || !changes[NS.STORAGE.SETTINGS]) return;
        currentKey = '';
        currentType = 'unknown';
        ['quiz', 'kuesioner', 'forum'].forEach(function (name) {
          if (NS.features && NS.features[name] && NS.features[name].cleanup) {
            NS.features[name].cleanup();
          }
        });
        schedulePathCheck(true);
      });
    } catch (e) {
      /* ignore */
    }

    const observer = new MutationObserver(function () {
      if (location.pathname !== lastPath) schedulePathCheck(false);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    pollTimer = setInterval(function () {
      if (location.pathname !== lastPath) schedulePathCheck(false);
    }, 1000);

    const start = function () {
      lastPath = '';
      schedulePathCheck(true);
    };

    if (NS.api && NS.api.requestBridgeAuth) {
      NS.api.requestBridgeAuth().catch(function () {}).then(start, start);
    } else {
      start();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})(globalThis);
