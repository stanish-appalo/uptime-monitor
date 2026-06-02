// Shared helpers for turning raw rows into the friendly shape the front end wants.
// Used by both the private dashboard (monitors.js) and the public status page
// (status.js), so it lives in one place to avoid copy-paste.

const db = require('./db');

// Given a monitor row, work out:
//   - status: 'up' / 'down' / 'pending' (pending = never checked yet)
//   - uptime: % of the last 100 checks that were 'up'
//   - lastResponseTime + lastCheckedAt from the most recent check
//   - whether there's an open (unresolved) incident right now
//
// It's async because each of these is a database query.
async function summarizeMonitor(monitor) {
  const latest = await db.get(
    'SELECT * FROM checks WHERE monitor_id = $1 ORDER BY checked_at DESC LIMIT 1',
    [monitor.id]
  );

  // Uptime over the most recent 100 checks. We count rows and how many were 'up'.
  // Heads up: Postgres returns COUNT/SUM as strings, so we wrap them in Number().
  const window = await db.get(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) AS ups
       FROM (
         SELECT status FROM checks WHERE monitor_id = $1
         ORDER BY checked_at DESC LIMIT 100
       ) recent`,
    [monitor.id]
  );
  const total = Number(window.total) || 0;
  const ups = Number(window.ups) || 0;
  const uptime = total ? Math.round((ups / total) * 1000) / 10 : null;

  const openIncident = await db.get(
    'SELECT * FROM incidents WHERE monitor_id = $1 AND resolved_at IS NULL',
    [monitor.id]
  );

  return {
    id: monitor.id,
    name: monitor.name,
    url: monitor.url,
    intervalSeconds: monitor.interval_seconds,
    isActive: !!monitor.is_active,
    status: latest ? latest.status : 'pending',
    statusCode: latest ? latest.status_code : null,
    lastResponseTime: latest ? latest.response_time_ms : null,
    lastCheckedAt: latest ? latest.checked_at : null,
    uptime, // percentage like 99.5, or null if never checked
    hasOpenIncident: !!openIncident,
  };
}

module.exports = { summarizeMonitor };
