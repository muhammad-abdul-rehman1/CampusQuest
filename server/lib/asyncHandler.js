// Express 5 forwards rejected promises automatically; this wrapper keeps handlers explicit.
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
