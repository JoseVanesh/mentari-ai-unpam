(function (root) {
  const NS = (root.MentariExt = root.MentariExt || {});

  function makeError(message, code, extra) {
    const error = new Error(message);
    error.code = code || 'ERROR';
    if (extra) Object.assign(error, extra);
    return error;
  }

  let bridgedAccess = null;

  function readStoredAccess() {
    try {
      const raw = localStorage.getItem('access');
      if (!raw) return null;

      const list = JSON.parse(raw);
      if (!Array.isArray(list) || !list.length) return null;

      let index = parseInt(localStorage.getItem('accessIndex') || '0', 10);
      if (!Number.isFinite(index) || index < 0 || index >= list.length) index = 0;

      const item = list[index];
      if (!item || !item.token) return null;

      return {
        role: String(item.role || '').toLowerCase(),
        token: String(item.token)
      };
    } catch (e) {
      return null;
    }
  }

  function readAccess() {
    return readStoredAccess() || bridgedAccess;
  }

  function requestBridgeAuth() {
    return new Promise(function (resolve) {
      const requestId = 'auth-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      let settled = false;

      const finish = function (value) {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMessage);
        if (value) bridgedAccess = value;
        resolve(bridgedAccess);
      };

      const onMessage = function (event) {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.channel !== 'MENTARI_EXT') return;
        if (data.type !== 'auth:result' || data.requestId !== requestId) return;

        if (data.ok && data.token) {
          finish({
            role: String(data.role || '').toLowerCase(),
            token: String(data.token)
          });
        } else {
          finish(null);
        }
      };

      window.addEventListener('message', onMessage);
      try {
        window.postMessage(
          { channel: 'MENTARI_EXT', type: 'auth:get', requestId: requestId },
          '*'
        );
      } catch (e) {
        finish(null);
        return;
      }

      setTimeout(function () {
        finish(null);
      }, 800);
    });
  }

  function getRole() {
    const access = readAccess();
    return access ? access.role : '';
  }

  function plainText(value) {
    return String(value || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function errorMessage(data, fallback) {
    if (!data) return fallback;
    if (typeof data === 'string') {
      const text = plainText(data);
      return (text || fallback).slice(0, 300);
    }
    if (typeof data.message === 'string' && data.message) return data.message;
    if (data.error) {
      if (typeof data.error === 'string') return data.error;
      if (typeof data.error.message === 'string' && data.error.message) return data.error.message;
    }
    return fallback;
  }

  function singleBody(body) {
    return Array.isArray(body) ? body[0] : body;
  }

  async function request(path, options) {
    const opts = options || {};
    const access = readAccess();
    if (!access) {
      throw makeError('Sesi login tidak ditemukan. Silakan login ulang di Mentari.', 'NO_SESSION');
    }

    const headers = Object.assign(
      {
        authorization: 'Bearer ' + access.token,
        t: String(Date.now()),
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache'
      },
      opts.headers || {}
    );
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

    let response;
    try {
      response = await fetch(path, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        credentials: 'same-origin',
        cache: 'no-store'
      });
    } catch (error) {
      throw makeError('Tidak dapat menghubungi server Mentari: ' + (error.message || error), 'NETWORK');
    }

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (e) {
        data = text;
      }
    }

    if (!response.ok) {
      const code =
        response.status === 401
          ? 'UNAUTHORIZED'
          : response.status === 403
          ? 'FORBIDDEN'
          : response.status === 404
          ? 'NOT_FOUND'
          : 'HTTP_ERROR';
      throw makeError(
        errorMessage(data, 'Permintaan gagal (HTTP ' + response.status + ')'),
        code,
        {
          status: response.status,
          data: data,
          path: path,
          method: opts.method || 'GET'
        }
      );
    }

    return data;
  }

  const api = {
    readAccess: readAccess,
    requestBridgeAuth: requestBridgeAuth,
    getRole: getRole,
    request: request,
    quizGet: function (subSectionId, idQuizUser) {
      const suffix = idQuizUser ? '?id_quiz_user=' + encodeURIComponent(idQuizUser) : '';
      return request('/api/quiz/soal/' + encodeURIComponent(subSectionId) + suffix);
    },
    quizJawab: function (answer) {
      return request('/api/quiz/jawab', { method: 'PUT', body: singleBody(answer) });
    },
    kuesionerGet: function (kodeCourses, kodeSection) {
      return request(
        '/api/kuesioner/' + encodeURIComponent(kodeCourses) + '/' + encodeURIComponent(kodeSection)
      );
    },
    kuesionerSubmit: function (body) {
      return request('/api/kuesioner/submit', { method: 'POST', body: singleBody(body) });
    },
    forumTopics: function (subSectionId) {
      return request('/api/forum/topic/' + encodeURIComponent(subSectionId));
    },
    forumReplies: function (topicId) {
      return request('/api/forum/reply/' + encodeURIComponent(topicId));
    },
    forumAddReply: function (body) {
      return request('/api/forum/reply', { method: 'POST', body: singleBody(body) });
    }
  };

  NS.api = api;
})(globalThis);
