// Incident routes: the history of downtime, and the ability to "acknowledge" an
// active incident (your way of saying "I've seen this, I'm on it").

const express = require('express');
const db = require('./db');
const { requireLogin, requireRole, asyncHandler } = require('./middleware');

const router = express.Router();

router.use(requireLogin);

// GET /api/incidents - every incident for my team's monitors, newest first.
// We join to monitors so each row carries the monitor's name (handy for the UI).
router.get('/', asyncHandler(async (req, res) => {
  const incidents = await db.all(
    `SELECT i.*, m.name AS monitor_name, m.url AS monitor_url
       FROM incidents i
       JOIN monitors m ON m.id = i.monitor_id
      WHERE m.team_id = $1
      ORDER BY i.started_at DESC
      LIMIT 100`,
    [req.membership.team_id]
  );
  res.json(incidents);
}));

// POST /api/incidents/:id/acknowledge - mark an open incident as acknowledged.
// Members and up. Viewers can look but not touch.
router.post('/:id/acknowledge', requireRole('member'), asyncHandler(async (req, res) => {
  // Make sure the incident belongs to one of MY team's monitors before touching it.
  const incident = await db.get(
    `SELECT i.*
       FROM incidents i
       JOIN monitors m ON m.id = i.monitor_id
      WHERE i.id = $1 AND m.team_id = $2`,
    [req.params.id, req.membership.team_id]
  );

  if (!incident) return res.status(404).json({ error: 'Incident not found.' });
  if (incident.resolved_at) {
    return res.status(400).json({ error: 'That incident is already resolved.' });
  }
  if (incident.acknowledged_by) {
    return res.status(400).json({ error: 'Already acknowledged.' });
  }

  await db.run(
    'UPDATE incidents SET acknowledged_by = $1, acknowledged_at = now() WHERE id = $2',
    [req.user.id, incident.id]
  );

  res.json({ ok: true });
}));

module.exports = router;
