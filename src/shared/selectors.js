(function (root) {
  const NS = (root.MentariExt = root.MentariExt || {});

  NS.SELECTORS = {
    panelHostId: 'mentari-ai-root',
    quiz: {
      radio: 'input[type="radio"]'
    },
    kuesioner: {
      radioGroup: '[role="radiogroup"]',
      radio: 'input[type="radio"]',
      yesValue: '1'
    },
    forum: {
      ckEditor: '.ck-editor__editable',
      ckContent: '.ck-content',
      textarea: 'textarea',
      replyPlaceholder: 'write your reply',
      advancedLabel: /^(advanced|adv)$/i,
      replyLabel: /^reply$/i
    }
  };
})(globalThis);
