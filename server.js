// Entry point. Run `npm start` and this is the file that boots.
// It wires together the web server, the routes, and the background checker.

require('dotenv').config(); // load values from .env into process.env (must be first)

const path = require('path');
const express = require('express');
const session = require('express-session');

const db = require('./src/db');
const { loadUser, asyncHandler } = require('./src/middleware');
const authRoutes = require('./src/auth');
const teamRoutes = require('./src/team');
const monitorRoutes = require('./src/monitors');
const incidentRoutes = require('./src/incidents');
const statusRoutes = require('./src/status');
const { startChecker } = require('./src/checker');

const app = express();
const PORT = process.env.PORT || 3000;

// When deployed behind a host like Render, traffic arrives through their HTTPS proxy.
// This tells Express to trust that proxy so things like secure cookies and req.protocol
// work correctly. Harmless locally (there's no proxy in front of us there).
app.set('trust proxy', 1);

// Parse JSON request bodies into req.body.
app.use(express.json());

// Sessions: this signs a cookie and remembers who is logged in between requests.
// In a real deployment you'd set SESSION_SECRET in the environment and turn on
// `cookie.secure` behind HTTPS.
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true, // JS in the browser can't read the cookie - safer
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);

// Load the logged-in user (if any) onto req before the routes run.
// loadUser is async (it hits the database), so we wrap it with asyncHandler.
app.use(asyncHandler(loadUser));

// API routes.
app.use('/api', authRoutes);            // /api/register, /api/login, /api/me ...
app.use('/api/team', teamRoutes);
app.use('/api/monitors', monitorRoutes);
app.use('/api/incidents', incidentRoutes);
app.use('/api/status', statusRoutes);   // public

// Serve the front-end files from /public (login.html, dashboard.html, css, js ...).
app.use(express.static(path.join(__dirname, 'public')));

// A clean shareable URL for the public status page, e.g. /status/1
app.get('/status/:teamId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'status.html'));
});

// Visiting the root sends you to the dashboard (which itself bounces you to login
// if you're not signed in).
app.get('/', (req, res) => res.redirect('/dashboard.html'));

// Catch-all error handler. Any error thrown in a route ends up here so we don't crash
// and we always reply with JSON.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

// Make sure the database tables exist before we start taking requests, then boot.
(async () => {
  try {
    await db.migrate();
  } catch (err) {
    console.error('Could not set up the database. Is DATABASE_URL correct?');
    console.error(err.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Uptime Monitor running at http://localhost:${PORT}`);
    startChecker();
  });
})();
