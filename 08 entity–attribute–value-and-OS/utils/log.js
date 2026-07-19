// Lightweight tagged debug logger so you can watch the system react: writes,
// outbox enqueue, the sync worker draining, and OpenSearch reads.
//
// On by default (this is a teaching demo). Silence it with:
//   DEBUG=0   (or off / false / no)
// Filter to specific tags with a comma list, e.g.:
//   DEBUG=sync,outbox   → only those tags
//
// Tags used across the codebase: write · outbox · sync · os · api · read

const raw = String(process.env.DEBUG ?? '').trim().toLowerCase();
const OFF = ['0', 'off', 'false', 'no'].includes(raw);
const ON = !OFF;
// If DEBUG names specific tags (not a boolean), only those tags pass.
const BOOLISH = ['', '1', 'on', 'true', 'yes', ...['0', 'off', 'false', 'no']];
const TAG_FILTER = ON && !BOOLISH.includes(raw) ? new Set(raw.split(',').map((s) => s.trim())) : null;

function ts() {
  return new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
}

function fmt(extra) {
  if (extra === undefined) return '';
  if (typeof extra === 'object') {
    const s = JSON.stringify(extra);
    return ' ' + (s.length > 300 ? s.slice(0, 297) + '…' : s);
  }
  return ' ' + extra;
}

// debug(tag, message, extra?) — extra is stringified compactly if an object.
function debug(tag, message, extra) {
  if (!ON) return;
  if (TAG_FILTER && !TAG_FILTER.has(tag)) return;
  console.log(`  ⟨${ts()}⟩ [${tag}] ${message}${fmt(extra)}`);
}

module.exports = { debug, DEBUG_ON: ON };
