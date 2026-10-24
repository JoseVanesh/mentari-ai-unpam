(function (root) {
  const NS = (root.MentariExt = root.MentariExt || {});

  function defaults() {
    return JSON.parse(JSON.stringify(NS.DEFAULT_SETTINGS));
  }

  function merge(current, patch) {
    const next = Object.assign({}, current, patch || {});
    next.features = Object.assign(
      {},
      current && current.features ? current.features : {},
      patch && patch.features ? patch.features : {}
    );
    return next;
  }

  function getSettings() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get([NS.STORAGE.SETTINGS], function (res) {
          void chrome.runtime.lastError;
          const saved = (res && res[NS.STORAGE.SETTINGS]) || {};
          resolve(merge(defaults(), saved));
        });
      } catch (e) {
        resolve(defaults());
      }
    });
  }

  function setSettings(patch) {
    return getSettings().then(function (current) {
      const next = merge(current, patch);
      return new Promise(function (resolve) {
        try {
          chrome.storage.local.set({ [NS.STORAGE.SETTINGS]: next }, function () {
            void chrome.runtime.lastError;
            resolve(next);
          });
        } catch (e) {
          resolve(next);
        }
      });
    });
  }

  NS.storage = {
    getSettings: getSettings,
    setSettings: setSettings,
    defaults: defaults
  };
})(globalThis);
