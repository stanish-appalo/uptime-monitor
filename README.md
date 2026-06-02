# Uptime Monitor

A small SaaS app for keeping an eye on websites. You add the URLs you care about,
the app checks them on a schedule, and it records when something goes down (and when
it comes back). Teams can share monitors, and there's a public status page you can
share with customers.

I built this to learn how a real SaaS fits together end to end - auth, teams with
roles, a background job that does work on its own, and both a private dashboard and a
public-facing page.

## What it does

- Sign up / log in (passwords are hashed, sessions stored in a cookie)
- Every account gets a **team**. You can invite people with an invite code.
- **Roles**: owner / admin / member / viewer - different people can do different things
- Add **monitors** (a name + a URL + how often to check it)
- A **background checker** pings each URL on its schedule and saves the result
- When a site goes down it opens an **incident**; when it recovers, the incident closes
- A **dashboard** shows current status, uptime %, and recent response times
- A **public status page** (no login needed) you can share

## Tech

- Node.js + Express (the server)
- PostgreSQL via the `pg` library (the production database)
- bcryptjs for password hashing
- express-session for login sessions
- dotenv for configuration via a `.env` file
- Plain HTML/CSS/JS on the front end (no build step - just open the page)

> This started on SQLite to move fast, then moved to Postgres so it can be deployed to
> a host (where the disk isn't permanent) and run on more than one server later. See
> "Things I'd add next" for the scaling story.

## Running it

You need Node 18 or newer (built with v22) and a PostgreSQL database. The quickest way
to get a free database is a cloud provider like [Neon](https://neon.tech) or
[Supabase](https://supabase.com) - they hand you a connection string.

```bash
npm install
cp .env.example .env       # then edit .env and paste in your DATABASE_URL
npm start
```

Then open http://localhost:3000

The tables are created automatically on first start (see `migrate()` in `src/db.js`).

> Using a cloud database? Set `PGSSL=true` in your `.env` - most of them require SSL.

## Deploying it live

The app is hosted on [Render](https://render.com) with a free [Neon](https://neon.tech)
Postgres database. There's a `render.yaml` blueprint in the repo, so Render can set the
service up automatically - the only thing you provide is the `DATABASE_URL` from Neon.

1. Create a Postgres database on Neon and copy its connection string.
2. On Render: **New + > Blueprint**, pick this repo, and paste the connection string
   into the `DATABASE_URL` field when prompted. `SESSION_SECRET` is generated for you.
3. Render runs `npm install` then `npm start`, and the tables are created on first boot.

> The free Render tier sleeps after inactivity, so the first request after idle takes a
> few seconds to wake up - and the background checker only runs while the service is awake.

## Roles cheat-sheet

| Role   | Can do                                                        |
|--------|---------------------------------------------------------------|
| owner  | everything, incl. billing + deleting the team                 |
| admin  | manage monitors, manage members, delete monitors              |
| member | add/edit monitors, acknowledge incidents                      |
| viewer | read-only - can see the dashboard but not change anything     |

## Things I'd add next

- Email / Slack alerts when something goes down (right now it just logs to the console)
- Real Stripe billing instead of the placeholder plan limits
- Move the checker into its own worker process so the web server isn't doing both jobs
- Charts on the dashboard instead of plain numbers
- Run multiple app instances behind a load balancer - now that the database is Postgres
  (and not a single SQLite file) this is actually possible; the checker would need a
  lock so two instances don't ping the same monitor twice
- Archive / roll up old `checks` rows, since that table grows forever
