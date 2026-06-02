// Team routes: see your team, view/manage members, change roles.
// This is the clearest example of role-based access control (RBAC) in the app -
// notice how the "manage people" routes require an admin or owner.

const express = require('express');
const db = require('./db');
const { requireLogin, requireRole, asyncHandler, ROLE_RANK } = require('./middleware');

const router = express.Router();

// Everything under /api/team needs you to be logged in.
router.use(requireLogin);

// GET /api/team - basic info about my team, including the invite code.
router.get('/', asyncHandler(async (req, res) => {
  const team = await db.get('SELECT * FROM teams WHERE id = $1', [req.membership.team_id]);
  res.json({
    id: team.id,
    name: team.name,
    // Only admins/owners get to see (and therefore share) the invite code.
    inviteCode: ROLE_RANK.indexOf(req.membership.role) >= ROLE_RANK.indexOf('admin')
      ? team.invite_code
      : null,
  });
}));

// GET /api/team/members - list everyone on the team and their role.
router.get('/members', asyncHandler(async (req, res) => {
  const members = await db.all(
    `SELECT u.id, u.name, u.email, m.role
       FROM memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.team_id = $1
      ORDER BY u.name`,
    [req.membership.team_id]
  );
  res.json(members);
}));

// POST /api/team/members/:userId/role - change someone's role. Admins and owners only.
router.post('/members/:userId/role', requireRole('admin'), asyncHandler(async (req, res) => {
  const targetUserId = Number(req.params.userId);
  const { role } = req.body;

  if (!ROLE_RANK.includes(role)) {
    return res.status(400).json({ error: 'Unknown role.' });
  }
  // Only an owner is allowed to hand out the "owner" role.
  if (role === 'owner' && req.membership.role !== 'owner') {
    return res.status(403).json({ error: 'Only an owner can promote someone to owner.' });
  }
  // Don't let people lock themselves out by changing their own role here.
  if (targetUserId === req.user.id) {
    return res.status(400).json({ error: "You can't change your own role." });
  }

  const target = await db.get(
    'SELECT * FROM memberships WHERE user_id = $1 AND team_id = $2',
    [targetUserId, req.membership.team_id]
  );
  if (!target) {
    return res.status(404).json({ error: 'That person is not on your team.' });
  }

  await db.run('UPDATE memberships SET role = $1 WHERE id = $2', [role, target.id]);
  res.json({ ok: true });
}));

// DELETE /api/team/members/:userId - remove someone from the team. Admins/owners only.
router.delete('/members/:userId', requireRole('admin'), asyncHandler(async (req, res) => {
  const targetUserId = Number(req.params.userId);
  if (targetUserId === req.user.id) {
    return res.status(400).json({ error: "You can't remove yourself." });
  }

  const target = await db.get(
    'SELECT * FROM memberships WHERE user_id = $1 AND team_id = $2',
    [targetUserId, req.membership.team_id]
  );
  if (!target) {
    return res.status(404).json({ error: 'That person is not on your team.' });
  }
  // An owner is the only one who can remove another owner.
  if (target.role === 'owner' && req.membership.role !== 'owner') {
    return res.status(403).json({ error: 'Only an owner can remove another owner.' });
  }

  await db.run('DELETE FROM memberships WHERE id = $1', [target.id]);
  res.json({ ok: true });
}));

module.exports = router;
