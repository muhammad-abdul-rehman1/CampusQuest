// Tiny shared state (current user, unread count, one-shot values passed between pages).
export const store = {
  user: null,
  unread: 0,
  flash: null // e.g. rewards waiting to be shown on the quiz-result page
};

export const roleHome = (role) => (role === 'admin' ? '/a' : role === 'instructor' ? '/i' : '/');
