(function (root) {
  const NS = (root.MentariExt = root.MentariExt || {});

  const PATTERNS = {
    exam: /^\/u-courses\/([^/]+)\/exam\/([^/]+)(?:\/([^/]+))?\/?$/,
    quiz: /^\/u-courses\/([^/]+)\/quiz\/([^/]+)\/?$/,
    kuesioner: /^\/u-courses\/([^/]+)\/kuesioner\/([^/]+)\/?$/,
    forumTopic: /^\/u-courses\/([^/]+)\/forum\/([^/]+)\/topics\/([^/]+)\/?$/,
    forumTopics: /^\/u-courses\/([^/]+)\/forum\/([^/]+)\/?$/,
    course: /^\/u-courses\/([^/]+)\/?$/
  };

  function safeDecode(value) {
    try {
      return decodeURIComponent(value || '');
    } catch (e) {
      return value || '';
    }
  }

  function detect(pathname) {
    const path = safeDecode(pathname || '/');
    let m;

    if ((m = PATTERNS.exam.exec(path))) {
      return {
        type: 'exam',
        kodeCourses: m[1],
        subSectionId: m[2],
        idQuizUser: m[3] || null
      };
    }
    if ((m = PATTERNS.forumTopic.exec(path))) {
      return { type: 'forumTopic', kodeCourses: m[1], subSectionId: m[2], topicId: m[3] };
    }
    if ((m = PATTERNS.kuesioner.exec(path))) {
      return { type: 'kuesioner', kodeCourses: m[1], kodeSection: m[2] };
    }
    if ((m = PATTERNS.forumTopics.exec(path))) {
      return { type: 'forumTopics', kodeCourses: m[1], subSectionId: m[2] };
    }
    if ((m = PATTERNS.quiz.exec(path))) {
      return { type: 'quiz', kodeCourses: m[1], subSectionId: m[2] };
    }
    if ((m = PATTERNS.course.exec(path))) {
      return { type: 'course', kodeCourses: m[1] };
    }
    return { type: 'unknown' };
  }

  function key(route) {
    return [
      route.type || '',
      route.kodeCourses || '',
      route.subSectionId || '',
      route.idQuizUser || '',
      route.kodeSection || '',
      route.topicId || ''
    ].join('|');
  }

  NS.detectRoute = detect;
  NS.routeKey = key;
})(globalThis);
