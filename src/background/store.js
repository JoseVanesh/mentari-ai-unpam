const SETTINGS_KEY = 'mentari.settings';

export const DEFAULT_SETTINGS = {
  apiKey: '',
  model: 'gemini-3.5-flash',
  features: { quiz: true, kuesioner: true, forum: true },
  confidenceThreshold: 0.6,
  batchSize: 15,
  context: '',
  debug: false
};

export async function getSettings() {
  const res = await chrome.storage.local.get([SETTINGS_KEY]);
  const saved = (res && res[SETTINGS_KEY]) || {};
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    features: { ...DEFAULT_SETTINGS.features, ...(saved.features || {}) }
  };
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = {
    ...current,
    ...(patch || {}),
    features: { ...current.features, ...((patch && patch.features) || {}) }
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}
