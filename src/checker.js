// The background checker - the "engine" of the app.
//
// Every few seconds it wakes up, finds the monitors that are due for a check (based
// on each monitor's own interval), pings them, and saves the result. If a site just
// went down it opens an incident; if a down site recovered it closes the incident.
//
// Note: for a real product you'd usually run this in its own process (so a busy web
// server doesn't slow down the checks, and vice versa). Here it runs inside the same
// Node process to keep things simple to start. That's called out in the README.

const db = require('./db');

const TICK_MS = 10_000;            // how often we wake up and look for due monitors
const REQUEST_TIMEOUT_MS = 10_000; // give each site up to 10s to respond

// Find monitors that are "due": never checked, or last checked longer ago than their
// interval. EXTRACT(EPOCH FROM (now() - checked_at)) gives the gap in seconds.
const DUE_MONITORS_SQL = `
  SELECT m.* FROM monitors m
   WHERE m.is_active = true
     AND (
       NOT EXISTS (SELECT 1 FROM checks c WHERE c.monitor_id = m.id)
       OR (
         SELECT EXTRACT(EPOCH FROM (now() - MAX(c.checked_at)))
           FROM checks c WHERE c.monitor_id = m.id
       ) >= m.interval_seconds
     )
`;

// Actually hit the URL once and report back how it went.
async function pingUrl(url) {
  const startedAt = Date.now();
  // AbortController lets us cancel the request if it takes too long.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    });
    const responseTime = Date.now() - startedAt;
    // We treat anything below 400 as "up". 4xx/5xx means the site answered but with
    // an error, so we count that as down.
    return {
      status: res.status < 400 ? 'up' : 'down',
      statusCode: res.status,
      responseTime,
      error: res.status < 400 ? null : `HTTP ${res.status}`,
    };
  } catch (err) {
    // Network error, DNS failure, or our timeout firing all land here.
    const responseTime = Date.now() - startedAt;
    const error = err.name === 'AbortError' ? 'Timed out' : err.message;
    return { status: 'down', statusCode: null, responseTime, error };
  } finally {
    clearTimeout(timer);
  }
}

// Where downtime alerts would go out. Right now we just log; swap this for email or
// Slack later (see README "things I'd add next").
function notify(message) {
  console.log(`[ALERT] ${message}`);
}

// Check a single monitor and update incidents based on the result.
async function checkMonitor(monitor) {
  const result = await pingUrl(monitor.url);

  await db.run(
    `INSERT INTO checks (monitor_id, status, status_code, response_time_ms, error)
     VALUES ($1, $2, $3, $4, $5)`,
    [monitor.id, result.status, result.statusCode, result.responseTime, result.error]
  );

  const open = await db.get(
    'SELECT * FROM incidents WHERE monitor_id = $1 AND resolved_at IS NULL',
    [monitor.id]
  );

  if (result.status === 'down' && !open) {
    // Just went down - open an incident and shout about it.
    await db.run('INSERT INTO incidents (monitor_id) VALUES ($1)', [monitor.id]);
    notify(`${monitor.name} (${monitor.url}) is DOWN - ${result.error}`);
  } else if (result.status === 'up' && open) {
    // Recovered - close the open incident.
    await db.run('UPDATE incidents SET resolved_at = now() WHERE id = $1', [open.id]);
    notify(`${monitor.name} (${monitor.url}) is back UP`);
  }
}

let running = false; // guard so two ticks never overlap

async function tick() {
  if (running) return; // previous tick still going - skip this one
  running = true;
  try {
    const due = await db.all(DUE_MONITORS_SQL);
    // Check them in parallel - they're independent network calls.
    await Promise.all(
      due.map((m) =>
        checkMonitor(m).catch((err) => {
          console.error(`Failed to check monitor ${m.id}:`, err.message);
        })
      )
    );
  } catch (err) {
    console.error('Checker tick failed:', err.message);
  } finally {
    running = false;
  }
}

function startChecker() {
  console.log('Background checker started.');
  tick();                       // run once right away on startup
  setInterval(tick, TICK_MS);   // ...then every TICK_MS after that
}

module.exports = { startChecker };
