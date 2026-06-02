// Everything to do with signing up, logging in, and logging out.

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { requireLogin, asyncHandler } = require('./middleware');

const router = express.Router();

// Make a short random code like "A7F3K9" for team invites. Not meant to be
// cryptographically perfect - just hard enough to guess for a small app.
function makeInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing 0/O/1/I
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// POST /api/register
// A new user either creates their own team (and becomes its owner) or joins an
// existing team using an invite code (as a member).
router.post('/register', asyncHandler(async (req, res) => {
  const { email, password, name, teamName, inviteCode } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Name, email and password are required.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const existing = await db.get('SELECT id FROM users WHERE email = $1', [email]);
  if (existing) {
    return res.status(409).json({ error: 'That email is already registered.' });
  }

  // Never store the raw password. bcrypt turns it into a hash that can't be reversed.
  const passwordHash = await bcrypt.hash(password, 10);

  // We touch several tables, so wrap it in a transaction: either all of it succeeds
  // or none of it does. That stops us from creating a user with no team, etc.
  let userId;
  try {
    userId = await db.withTransaction(async (client) => {
      const userRes = await client.query(
        'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id',
        [email, passwordHash, name]
      );
      const newUserId = userRes.rows[0].id;

      let teamId;
      let role;

      if (inviteCode) {
        const teamRes = await client.query(
          'SELECT id FROM teams WHERE invite_code = $1',
          [inviteCode.trim().toUpperCase()]
        );
        if (teamRes.rows.length === 0) {
          throw new Error('INVALID_INVITE');
        }
        teamId = teamRes.rows[0].id;
        role = 'member'; // people who join via invite start as members
      } else {
        const teamRes = await client.query(
          'INSERT INTO teams (name, invite_code) VALUES ($1, $2) RETURNING id',
          [teamName || `${name}'s team`, makeInviteCode()]
        );
        teamId = teamRes.rows[0].id;
        role = 'owner'; // you own the team you create
      }

      await client.query(
        'INSERT INTO memberships (user_id, team_id, role) VALUES ($1, $2, $3)',
        [newUserId, teamId, role]
      );

      return newUserId;
    });
  } catch (err) {
    if (err.message === 'INVALID_INVITE') {
      return res.status(400).json({ error: 'That invite code does not exist.' });
    }
    throw err; // anything else is a real bug - let the error handler catch it
  }

  // Log them straight in by saving their id in the session.
  req.session.userId = userId;
  res.json({ ok: true });
}));

// POST /api/login
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await db.get('SELECT * FROM users WHERE email = $1', [email]);

  // Compare the typed password against the stored hash. We give the same error for
  // "no such user" and "wrong password" on purpose - it doesn't leak which emails exist.
  const ok = user && (await bcrypt.compare(password || '', user.password_hash));
  if (!ok) {
    return res.status(401).json({ error: 'Wrong email or password.' });
  }

  req.session.userId = user.id;
  res.json({ ok: true });
}));

// POST /api/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// GET /api/me - who am I? The front end calls this on load to decide what to show.
router.get('/me', requireLogin, asyncHandler(async (req, res) => {
  const team = await db.get('SELECT * FROM teams WHERE id = $1', [req.membership.team_id]);
  res.json({
    user: req.user,
    team: { id: team.id, name: team.name },
    role: req.membership.role,
  });
}));

module.exports = router;
