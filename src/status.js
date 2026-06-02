// Public status page data.
//
// This route has NO requireLogin on purpose - anyone with the link can see whether a
// team's services are up. It's the page you'd share with your customers. We only
// expose safe, summary info (names + status), never anything private.

const express = require('express');
const db = require('./db');
const { asyncHandler } = require('./middleware');
const { summarizeMonitor } = require('./status-helpers');

const router = express.Router();

// GET /api/status/:teamId - public summary for one team.
router.get('/:teamId', asyncHandler(async (req, res) => {
  const team = await db.get('SELECT id, name FROM teams WHERE id = $1', [req.params.teamId]);
  if (!team) return res.status(404).json({ error: 'No such status page.' });

  const monitors = await db.all(
    'SELECT * FROM monitors WHERE team_id = $1 AND is_active = true ORDER BY name',
    [team.id]
  );
  const summarized = await Promise.all(monitors.map(summarizeMonitor));

  // An overall headline: if everything's up we say so, otherwise we flag trouble.
  const anyDown = summarized.some((m) => m.status === 'down');
  const overall = summarized.length === 0 ? 'unknown' : anyDown ? 'down' : 'up';

  res.json({
    team: { name: team.name },
    overall,
    monitors: summarized.map((m) => ({
      name: m.name,
      status: m.status,
      uptime: m.uptime,
      lastResponseTime: m.lastResponseTime,
    })),
  });
}));

module.exports = router;
