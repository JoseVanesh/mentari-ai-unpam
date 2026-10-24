import { getSettings } from './store.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_ATTEMPTS = 3;
const FALLBACK_MODELS = ['gemini-3.5-flash', 'gemini-3.6-flash'];

let chain = Promise.resolve();

export class GeminiError extends Error {
  constructor(message, options) {
    super(message);
    this.name = 'GeminiError';
    const opts = options || {};
    this.code = opts.code || 'GEMINI_ERROR';
    this.status = opts.status || null;
    this.detail = opts.detail || null;
  }
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

function enqueue(task) {
  const run = chain.then(task, task);
  chain = run.catch(function () {});
  return run;
}

function extractText(data) {
  if (!data) return '';
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const collected = [];
  const push = function (value) {
    if (typeof value === 'string' && value.trim()) collected.push(value.trim());
  };

  const visit = function (node, depth) {
    if (!node || depth > 8) return;
    if (Array.isArray(node)) {
      node.forEach(function (item) {
        visit(item, depth + 1);
      });
      return;
    }
    if (typeof node === 'string') {
      push(node);
      return;
    }
    if (typeof node !== 'object') return;

    if (node.thought === true) return;
    const nodeType = String(node.type || '').toLowerCase();
    if (nodeType === 'thought' || nodeType === 'reasoning' || nodeType === 'thinking') return;

    if (typeof node.text === 'string') push(node.text);
    else if (typeof node.output_text === 'string') push(node.output_text);
    else if (node.type === 'text' && typeof node.content === 'string') push(node.content);

    ['outputs', 'output', 'steps', 'candidates', 'content', 'parts', 'message'].forEach(function (key) {
      if (node[key]) visit(node[key], depth + 1);
    });
  };

  visit(data, 0);

  const seen = new Set();
  const unique = [];
  collected.forEach(function (text) {
    if (!seen.has(text)) {
      seen.add(text);
      unique.push(text);
    }
  });
  return unique.join('\n').trim();
}

function findJsonObject(body) {
  let start = body.indexOf('"answers"');
  if (start >= 0) {
    const brace = body.lastIndexOf('{', start);
    start = brace >= 0 ? brace : body.indexOf('{');
  } else {
    start = body.indexOf('{');
  }
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < body.length; i += 1) {
    const ch = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return null;
}

export function parseJson(text) {
  if (!text) {
    throw new GeminiError('Respons AI kosong.', { code: 'EMPTY' });
  }
  let body = String(text).trim();
  body = body.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const candidate = findJsonObject(body);
  if (candidate) body = candidate;
  try {
    return JSON.parse(body);
  } catch (e) {
    throw new GeminiError('Format JSON dari AI tidak valid.', {
      code: 'BAD_JSON',
      detail: body.slice(0, 300)
    });
  }
}

async function fetchJson(url, init, timeoutMs) {
  let lastError = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(function () {
      controller.abort();
    }, timeoutMs);

    let response;
    let text;
    try {
      response = await fetch(url, Object.assign({}, init, { signal: controller.signal }));
      text = await response.text();
    } catch (error) {
      lastError = error;
      clearTimeout(timer);
      if (attempt === MAX_ATTEMPTS - 1) {
        const aborted = error && error.name === 'AbortError';
        throw new GeminiError(
          aborted ? 'Permintaan ke Gemini timeout.' : 'Gagal menghubungi Gemini: ' + (error.message || error),
          { code: aborted ? 'TIMEOUT' : 'NETWORK' }
        );
      }
      await sleep(1000 * (attempt + 1));
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) {
      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new GeminiError('Respons Gemini bukan JSON.', { code: 'BAD_RESPONSE' });
      }
    }

    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      parsed = { raw: text };
    }
    const message =
      (parsed && parsed.error && parsed.error.message) ||
      (parsed && parsed.message) ||
      'HTTP ' + response.status;

    const retryable = [500, 502, 503, 504].indexOf(response.status) >= 0;
    if (retryable && attempt < MAX_ATTEMPTS - 1) {
      const retryAfter = parseInt(response.headers.get('retry-after') || '0', 10);
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : 1000 * (attempt + 1);
      const maxRetryWaitMs = 8000;
      if (waitMs <= maxRetryWaitMs) {
        await sleep(waitMs);
        continue;
      }
    }

    throw new GeminiError(message, {
      code: response.status === 429 ? 'RATE_LIMITED' : 'GEMINI_HTTP',
      status: response.status,
      detail: parsed
    });
  }

  throw lastError instanceof GeminiError
    ? lastError
    : new GeminiError('Permintaan Gemini gagal.', { code: 'NETWORK' });
}

async function callInteractions(options) {
  const body = {
    model: options.model,
    input: options.prompt,
    store: false
  };
  if (options.system) body.system_instruction = options.system;
  if (options.schema) {
    body.response_format = {
      type: 'text',
      mime_type: 'application/json',
      schema: options.schema
    };
  }

  const data = await fetchJson(
    API_BASE + '/interactions',
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': options.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    },
    options.timeoutMs
  );

  const text = extractText(data);
  if (!text) {
    throw new GeminiError('Respons Gemini kosong.', {
      code: 'EMPTY',
      detail: data
    });
  }
  return { text: text, raw: data, model: data.model || options.model, via: 'interactions' };
}

async function callGenerateContent(options) {
  const url =
    API_BASE +
    '/models/' +
    encodeURIComponent(options.model) +
    ':generateContent';

  const body = {
    contents: [{ role: 'user', parts: [{ text: options.prompt }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: options.maxOutputTokens || 4096
    }
  };
  if (options.system) body.systemInstruction = { parts: [{ text: options.system }] };
  if (options.schema) {
    body.generationConfig.responseMimeType = 'application/json';
    body.generationConfig.responseSchema = options.schema;
  }

  const data = await fetchJson(
    url,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': options.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    },
    options.timeoutMs
  );

  const parts =
    data &&
    data.candidates &&
    data.candidates[0] &&
    data.candidates[0].content &&
    data.candidates[0].content.parts;
  const text = Array.isArray(parts)
    ? parts
        .map(function (part) {
          return part.text || '';
        })
        .join('')
        .trim()
    : '';

  if (!text) {
    throw new GeminiError('Respons Gemini kosong.', {
      code: 'EMPTY',
      detail: data
    });
  }
  return { text: text, raw: data, model: data.modelVersion || options.model, via: 'generateContent' };
}

function isBadKeyError(error) {
  return /api key/i.test((error && error.message) || '');
}

function shouldTryOtherApi(error) {
  if (!error || isBadKeyError(error)) return false;
  return [400, 404, 405, 422, 429, 503].indexOf(error.status) >= 0;
}

function shouldTryNextModel(error) {
  if (!error) return false;
  return error.status === 429 || error.status === 404 || error.status === 503;
}

async function callModel(opts, model) {
  const modelOpts = Object.assign({}, opts, { model: model });

  try {
    return await callInteractions(modelOpts);
  } catch (error) {
    if (!shouldTryOtherApi(error)) throw error;
  }

  return callGenerateContent(modelOpts);
}

export async function generate(options) {
  const settings = await getSettings();
  const apiKey = String(settings.apiKey || '').trim();
  if (!apiKey) {
    throw new GeminiError('API key Gemini belum diatur. Buka popup ekstensi lalu simpan API key.', {
      code: 'NO_API_KEY'
    });
  }

  const requestedModel = options.model || settings.model || 'gemini-3.5-flash';
  const opts = {
    apiKey: apiKey,
    model: requestedModel,
    system: options.system || '',
    prompt: options.prompt || '',
    schema: options.schema || null,
    timeoutMs: options.timeoutMs || 60000,
    maxOutputTokens: options.maxOutputTokens || 4096
  };

  if (!opts.prompt.trim()) {
    throw new GeminiError('Prompt kosong.', { code: 'EMPTY_PROMPT' });
  }

  const models = [requestedModel].concat(
    FALLBACK_MODELS.filter(function (model) {
      return model !== requestedModel;
    })
  );

  return enqueue(async function () {
    let lastError = null;

    for (let index = 0; index < models.length; index += 1) {
      try {
        return await callModel(opts, models[index]);
      } catch (error) {
        lastError = error;
        if (!shouldTryNextModel(error)) throw error;
      }
    }

    throw lastError || new GeminiError('Permintaan Gemini gagal.', { code: 'NETWORK' });
  });
}

export async function testConnection(model) {
  const startedAt = Date.now();
  const result = await generate({
    model: model,
    prompt: 'Balas hanya dengan JSON: {"ok":true,"message":"pong"}',
    schema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        message: { type: 'string' }
      },
      required: ['ok', 'message']
    },
    timeoutMs: 30000,
    maxOutputTokens: 256
  });

  return {
    model: result.model,
    via: result.via,
    latencyMs: Date.now() - startedAt,
    text: result.text.slice(0, 200)
  };
}
