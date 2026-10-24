(function (root) {
  const NS = (root.MentariExt = root.MentariExt || {});

  NS.MESSAGES = {
    TEST_CONNECTION: 'MENTARI_TEST_CONNECTION',
    AI_QUIZ_ANSWERS: 'MENTARI_AI_QUIZ_ANSWERS',
    AI_FORUM_REPLY: 'MENTARI_AI_FORUM_REPLY'
  };

  NS.STORAGE = {
    SETTINGS: 'mentari.settings'
  };

  NS.SESSION = {
    QUIZ_LAST_RUN: 'mentari.quiz.lastRun'
  };

  NS.DEFAULT_SETTINGS = {
    apiKey: '',
    model: 'gemini-3.5-flash',
    features: { quiz: true, kuesioner: true, forum: true },
    confidenceThreshold: 0.6,
    batchSize: 15,
    context: '',
    debug: false
  };

  NS.MODELS = [
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash (gratis, default)' },
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite' }
  ];
})(globalThis);
