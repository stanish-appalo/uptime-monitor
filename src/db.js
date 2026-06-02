// Database setup - now using PostgreSQL via the "pg" library.
//
// We moved here from SQLite because a hosted app needs a database that lives
// somewhere permanent and can be shared by more than one server. pg talks to Postgres
// over the network, so every call is ASYNCHRONOUS - that's why the rest of the code
// uses async/await around database calls.
//
// We use a connection "pool": a small set of reusable connections, so we don't open a
// brand new one for every request (which would be slow).

require('dotenv').config();
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn('⚠  DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
}

// Cloud Postgres providers (Neon, Supabase, Render, AWS RDS) require SSL; a database
// running on your own machine usually doesn't. We turn SSL on if PGSSL=true or if the
// host clearly looks like one of those providers.
const needsSsl =
  process.env.PGSSL === 'true' ||
  /neon\.tech|supabase\.|render\.com|amazonaws\.com/.test(connectionString || '');

const pool = new Pool({
  connectionString,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
});

// --- tiny helpers so the rest of the code reads nicely ---
// Note the $1, $2 placeholders: that's how Postgres takes parameters safely (this is
// what protects us from SQL injection - values are never glued into the query text).

// Return the first row (or undefined).
async function get(text, params) {
  const res = await pool.query(text, params);
  return res.rows[0];
}

// Return all rows as an array.
async function all(text, params) {
  const res = await pool.query(text, params);
  return res.rows;
}

// Run a query when you don't need the rows back (INSERT/UPDATE/DELETE).
async function run(text, params) {
  return pool.query(text, params);
}

// Run several queries as one all-or-nothing unit. If the callback throws, everything
// is rolled back. Used at signup (create user + team + membership together).
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release(); // give the connection back to the pool
  }
}

// Create the tables if they don't exist yet. Safe to run on every startup.
async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name          TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS teams (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL,
      invite_code TEXT NOT NULL UNIQUE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- A membership links a user to a team and says what role they have there.
    -- This is the heart of the "teams + roles" feature.
    CREATE TABLE IF NOT EXISTS memberships (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      team_id    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      role       TEXT NOT NULL DEFAULT 'member',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(user_id, team_id)
    );

    CREATE TABLE IF NOT EXISTS monitors (
      id               SERIAL PRIMARY KEY,
      team_id          INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      name             TEXT NOT NULL,
      url              TEXT NOT NULL,
      interval_seconds INTEGER NOT NULL DEFAULT 60,
      is_active        BOOLEAN NOT NULL DEFAULT true,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- One row per time we ping a monitor. This is where the history comes from.
    CREATE TABLE IF NOT EXISTS checks (
      id               SERIAL PRIMARY KEY,
      monitor_id       INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
      status           TEXT NOT NULL,            -- 'up' or 'down'
      status_code      INTEGER,                  -- HTTP code, e.g. 200 (null if no response)
      response_time_ms INTEGER,
      error            TEXT,                     -- why it failed, if it did
      checked_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- An incident is a stretch of downtime. It opens when a site goes down and gets a
    -- resolved_at timestamp when it comes back.
    CREATE TABLE IF NOT EXISTS incidents (
      id              SERIAL PRIMARY KEY,
      monitor_id      INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
      started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at     TIMESTAMPTZ,
      acknowledged_by INTEGER REFERENCES users(id),
      acknowledged_at TIMESTAMPTZ
    );

    -- Indexes make the "latest check / open incident for a monitor" queries fast.
    CREATE INDEX IF NOT EXISTS idx_checks_monitor    ON checks(monitor_id, checked_at);
    CREATE INDEX IF NOT EXISTS idx_incidents_monitor ON incidents(monitor_id);
  `);
}

module.exports = { pool, get, all, run, withTransaction, migrate };
