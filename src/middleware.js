// Middleware = small functions that run before a route handler. They can check
// something and either let the request continue (next()) or stop it with an error.

const db = require('./db');

// Roles, ordered from least to most powerful. We compare positions in this list to
// answer "is this role at least an admin?" without writing a big if/else everywhere.
const ROLE_RANK = ['viewer', 'member', 'admin', 'owner'];

// Express 4 doesn't automatically catch errors thrown inside async functions, so we
// wrap async handlers with this. If the promise rejects, the error is passed to
// next() and our central error handler deals with it (instead of the app hanging).
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Runs on every request. If the session has a user id, we load that user plus their
// team membership and attach them to req so later handlers can use them.
async function loadUser(req, res, next) {
  if (req.session && req.session.userId) {
    const user = await db.get(
      'SELECT id, email, name FROM users WHERE id = $1',
      [req.session.userId]
    );
    if (user) {
      const membership = await db.get(
        'SELECT * FROM memberships WHERE user_id = $1 LIMIT 1',
        [user.id]
      );
      req.user = user;
      req.membership = membership; // has team_id and role
    }
  }
  next();
}

// Blocks the request unless someone is logged in.
function requireLogin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'You need to be logged in.' });
  }
  next();
}

// Returns a middleware that only lets the request through if the user's role is at
// least `minRole`. Usage: requireRole('admin')
function requireRole(minRole) {
  return function (req, res, next) {
    if (!req.membership) {
      return res.status(403).json({ error: 'You are not part of a team.' });
    }
    const have = ROLE_RANK.indexOf(req.membership.role);
    const need = ROLE_RANK.indexOf(minRole);
    if (have < need) {
      return res
        .status(403)
        .json({ error: `This action needs the "${minRole}" role or higher.` });
    }
    next();
  };
}

module.exports = { asyncHandler, loadUser, requireLogin, requireRole, ROLE_RANK };
