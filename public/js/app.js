// Shared front-end helpers used by every page.
// Plain browser JavaScript - no framework, no build step.

// Tiny wrapper around fetch so each page doesn't repeat the JSON + error handling.
// Throws an Error (with the server's message) when the response isn't OK.
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  // 204 = no content; nothing to parse.
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

// Escape text before putting it in HTML, so a monitor named "<script>" can't run.
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Turn a timestamp from the API (an ISO string like "2026-01-01T12:00:00.000Z")
// into something readable in the viewer's local time.
function formatTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return isNaN(d) ? '-' : d.toLocaleString();
}

// Show a friendly response time, or a dash if we don't have one.
function formatMs(ms) {
  return ms == null ? '-' : `${ms} ms`;
}
