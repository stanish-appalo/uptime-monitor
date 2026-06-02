// Monitor routes: the websites a team is watching.
// Reading is allowed for any logged-in member. Creating/editing needs "member",
// and deleting needs "admin" - that way you can see the roles doing real work.

const express = require('express');
const db = require('./db');
const { requireLogin, requireRole, asyncHandler } = require('./middleware');
const { summarizeMonitor } = require('./status-helpers');

const router = express.Router();

router.use(requireLogin);

// A tiny sanity check so we don't try to monitor "banana".
function isValidUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// GET /api/monitors - all of my team's monitors, each with its current status,
// uptime % and latest response time worked out for the dashboard.
router.get('/', asyncHandler(async (req, res) => {
  const monitors = await db.all(
    'SELECT * FROM monitors WHERE team_id = $1 ORDER BY created_at DESC',
    [req.membership.team_id]
  );
  // summarizeMonitor runs queries, so resolve them all together.
  const summarized = await Promise.all(monitors.map(summarizeMonitor));
  res.json(summarized);
}));

// GET /api/monitors/:id - one monitor plus its recent checks and incidents.
router.get('/:id', asyncHandler(async (req, res) => {
  const monitor = await db.get(
    'SELECT * FROM monitors WHERE id = $1 AND team_id = $2',
    [req.params.id, req.membership.team_id]
  );
  if (!monitor) return res.status(404).json({ error: 'Monitor not found.' });

  const recentChecks = await db.all(
    'SELECT * FROM checks WHERE monitor_id = $1 ORDER BY checked_at DESC LIMIT 20',
    [monitor.id]
  );
  const incidents = await db.all(
    'SELECT * FROM incidents WHERE monitor_id = $1 ORDER BY started_at DESC LIMIT 10',
    [monitor.id]
  );

  res.json({ ...(await summarizeMonitor(monitor)), recentChecks, incidents });
}));

// POST /api/monitors - add a new one. Members and up.
router.post('/', requireRole('member'), asyncHandler(async (req, res) => {
  const { name, url } = req.body;
  let intervalSeconds = Number(req.body.intervalSeconds) || 60;

  if (!name || !url) {
    return res.status(400).json({ error: 'Name and URL are required.' });
  }
  if (!isValidUrl(url)) {
    return res.status(400).json({ error: 'That does not look like a valid http(s) URL.' });
  }
  // Keep the interval sensible - at least 15s so we don't hammer sites.
  if (intervalSeconds < 15) intervalSeconds = 15;

  const result = await db.get(
    `INSERT INTO monitors (team_id, name, url, interval_seconds)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.membership.team_id, name, url, intervalSeconds]
  );

  res.status(201).json(await summarizeMonitor(result));
}));

// PUT /api/monitors/:id - edit name/url/interval/active. Members and up.
router.put('/:id', requireRole('member'), asyncHandler(async (req, res) => {
  const monitor = await db.get(
    'SELECT * FROM monitors WHERE id = $1 AND team_id = $2',
    [req.params.id, req.membership.team_id]
  );
  if (!monitor) return res.status(404).json({ error: 'Monitor not found.' });

  const name = req.body.name ?? monitor.name;
  const url = req.body.url ?? monitor.url;
  let intervalSeconds = Number(req.body.intervalSeconds) || monitor.interval_seconds;
  // is_active is a real boolean in Postgres now.
  const isActive = req.body.isActive === undefined ? monitor.is_active : !!req.body.isActive;

  if (!isValidUrl(url)) {
    return res.status(400).json({ error: 'That does not look like a valid http(s) URL.' });
  }
  if (intervalSeconds < 15) intervalSeconds = 15;

  await db.run(
    'UPDATE monitors SET name = $1, url = $2, interval_seconds = $3, is_active = $4 WHERE id = $5',
    [name, url, intervalSeconds, isActive, monitor.id]
  );

  const updated = await db.get('SELECT * FROM monitors WHERE id = $1', [monitor.id]);
  res.json(await summarizeMonitor(updated));
}));

// DELETE /api/monitors/:id - remove a monitor. Admins and owners only.
router.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const monitor = await db.get(
    'SELECT * FROM monitors WHERE id = $1 AND team_id = $2',
    [req.params.id, req.membership.team_id]
  );
  if (!monitor) return res.status(404).json({ error: 'Monitor not found.' });

  // Because of "ON DELETE CASCADE" in the schema, deleting the monitor also clears
  // its checks and incidents automatically.
  await db.run('DELETE FROM monitors WHERE id = $1', [monitor.id]);
  res.json({ ok: true });
}));

module.exports = router;
