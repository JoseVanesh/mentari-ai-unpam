import { generate, parseJson, testConnection, GeminiError } from './gemini.js';
import { QUIZ_SCHEMA, buildQuizPrompt, buildForumPrompt } from './prompts.js';
import { getSettings, saveSettings } from './store.js';

chrome.runtime.onInstalled.addListener(function () {
  getSettings()
    .then(function (settings) {
      return saveSettings(settings);
    })
    .catch(function () {});
});

function serializeError(error) {
  if (!error) return { code: 'ERROR', message: 'Terjadi kesalahan tidak diketahui.' };
  return {
    code: error.code || 'ERROR',
    message: error.message || String(error),
    status: error.status || null
  };
}

async function handleTest(message) {
  try {
    const result = await testConnection(message && message.model);
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
}

async function handleQuiz(message) {
  try {
    const payload = (message && message.payload) || {};
    const questions = Array.isArray(payload.questions) ? payload.questions : [];
    if (!questions.length) {
      throw new GeminiError('Tidak ada soal untuk dikirim ke AI.', { code: 'NO_QUESTIONS' });
    }

    const settings = await getSettings();
    const built = buildQuizPrompt(payload);
    const result = await generate({
      system: built.system,
      prompt: built.prompt,
      schema: QUIZ_SCHEMA,
      model: settings.model
    });

    const data = parseJson(result.text);
    if (!data || !Array.isArray(data.answers)) {
      throw new GeminiError('Struktur jawaban AI tidak valid.', { code: 'BAD_SHAPE' });
    }

    return {
      ok: true,
      answers: data.answers,
      model: result.model,
      via: result.via
    };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
}

function normalizeForumText(text) {
  let value = String(text || '').trim();
  value = value.replace(/^```[a-z]*\s*/i, '').replace(/```$/i, '').trim();
  value = value.replace(/^["\u201c]([\s\S]*)["\u201d]$/, '$1').trim();
  value = value.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return value.slice(0, 2500);
}

async function handleForum(message) {
  try {
    const payload = (message && message.payload) || {};
    const title = String(payload.topicTitle || '').trim();
    const content = String(payload.topicContent || '').trim();
    if (!title && !content) {
      throw new GeminiError('Topik forum tidak memiliki judul atau isi.', { code: 'EMPTY_TOPIC' });
    }

    const settings = await getSettings();
    const built = buildForumPrompt(payload);
    const result = await generate({
      system: built.system,
      prompt: built.prompt,
      model: settings.model,
      maxOutputTokens: 1024,
      timeoutMs: 60000
    });

    const text = normalizeForumText(result.text);
    if (!text) {
      throw new GeminiError('AI menghasilkan balasan kosong.', { code: 'EMPTY' });
    }

    return { ok: true, text: text, model: result.model, via: result.via };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || typeof message !== 'object') return false;

  if (message.type === 'MENTARI_TEST_CONNECTION') {
    handleTest(message).then(sendResponse);
    return true;
  }

  if (message.type === 'MENTARI_AI_QUIZ_ANSWERS') {
    handleQuiz(message).then(sendResponse);
    return true;
  }

  if (message.type === 'MENTARI_AI_FORUM_REPLY') {
    handleForum(message).then(sendResponse);
    return true;
  }

  return false;
});
