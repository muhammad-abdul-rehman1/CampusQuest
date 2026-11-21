// Shape DB documents for the API. Never expose password hashes, reset tokens or correct answers.

function publicUser(u) {
  return { id: String(u._id), name: u.name, email: u.email, role: u.role, status: u.status, emailVerified: u.emailVerified !== false, createdAt: u.createdAt };
}

function initials(name) {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

function courseOut(c, extra = {}) {
  return {
    id: String(c._id),
    title: c.title,
    code: c.code,
    description: c.description,
    category: c.category,
    term: c.term,
    status: c.status,
    enrollmentOpen: c.enrollmentOpen,
    requiresCode: !!c.enrollmentCode,
    instructorId: String(c.instructorId && c.instructorId._id ? c.instructorId._id : c.instructorId),
    instructorName: c.instructorId && c.instructorId.name ? c.instructorId.name : undefined,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    ...extra
  };
}

module.exports = { publicUser, initials, courseOut };
