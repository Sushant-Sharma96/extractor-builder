'use strict';
/**
 * Local persistence for Budget Manager (no Redis/DB).
 * Advisory counters + authoritative Retry-After locks.
 * Hardening: atomic rename, corrupt recovery, best-effort exclusive lock.
 */

const fs = require('fs');
const path = require('path');

function getStateDir() {
  return process.env.FIGMA_BUDGET_DIR
    || path.join(process.env.OUTPUT_DIR || path.join(__dirname, '..', '..', 'output'), 'figma-cache', '_budget');
}

function getStateFile() {
  return path.join(getStateDir(), 'state.json');
}

function getLockFile() {
  return path.join(getStateDir(), 'state.lock');
}

/** In-process session counters (reset on process restart). */
const sessionCounters = {
  t1: 0,
  t2: 0,
  startedAt: Date.now(),
};

function monthKey(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function minuteKey(d = new Date()) {
  return `${monthKey(d)}-${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function emptyBucket() {
  return { t1: 0, t2: 0, monthKey: monthKey(), minuteKey: minuteKey(), minuteT1: 0, minuteT2: 0 };
}

function defaultState() {
  return {
    version: 1,
    locks: {},
    counters: {
      users: {},
      files: {},
      workspaces: {},
    },
    lastPlanTier: null,
    updatedAt: null,
  };
}

function ensureDir() {
  fs.mkdirSync(getStateDir(), { recursive: true });
}

/** Best-effort exclusive lock (stale locks > 10s discarded). Not cross-machine. */
function withFileLock(fn) {
  ensureDir();
  const lockPath = getLockFile();
  const maxAttempts = 40;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, String(process.pid));
      fs.closeSync(fd);
      try {
        return fn();
      } finally {
        try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
      }
    } catch (e) {
      if (e && e.code === 'EEXIST') {
        try {
          const st = fs.statSync(lockPath);
          if (Date.now() - st.mtimeMs > 10000) {
            try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
        // busy-wait briefly
        const end = Date.now() + 25;
        while (Date.now() < end) { /* spin */ }
        continue;
      }
      throw e;
    }
  }
  // Fallback without lock rather than failing convert
  return fn();
}

function loadStateUnlocked() {
  const STATE_FILE = getStateFile();
  try {
    if (!fs.existsSync(STATE_FILE)) return defaultState();
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!raw || typeof raw !== 'object') return defaultState();
    raw.locks = raw.locks || {};
    raw.counters = raw.counters || { users: {}, files: {}, workspaces: {} };
    raw.counters.users = raw.counters.users || {};
    raw.counters.files = raw.counters.files || {};
    raw.counters.workspaces = raw.counters.workspaces || {};
    return raw;
  } catch {
    // Corrupt JSON → quarantine and reset
    try {
      if (fs.existsSync(STATE_FILE)) {
        fs.renameSync(STATE_FILE, `${STATE_FILE}.corrupt-${Date.now()}`);
      }
    } catch { /* ignore */ }
    return defaultState();
  }
}

function saveStateUnlocked(state) {
  ensureDir();
  const STATE_FILE = getStateFile();
  state.updatedAt = new Date().toISOString();
  const tmp = `${STATE_FILE}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  try {
    fs.renameSync(tmp, STATE_FILE);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
}

function loadState() {
  return withFileLock(() => loadStateUnlocked());
}

function saveState(state) {
  return withFileLock(() => saveStateUnlocked(state));
}

/** Atomic read-modify-write under lock (preferred for counters/locks). */
function updateState(mutator) {
  return withFileLock(() => {
    const state = loadStateUnlocked();
    const next = mutator(state) || state;
    saveStateUnlocked(next);
    return next;
  });
}

function rollBucket(bucket) {
  const b = bucket || emptyBucket();
  const mk = monthKey();
  const mink = minuteKey();
  if (b.monthKey !== mk) {
    b.t1 = 0;
    b.t2 = 0;
    b.monthKey = mk;
  }
  if (b.minuteKey !== mink) {
    b.minuteT1 = 0;
    b.minuteT2 = 0;
    b.minuteKey = mink;
  }
  return b;
}

function getBucket(map, key) {
  if (!map[key]) map[key] = emptyBucket();
  map[key] = rollBucket(map[key]);
  return map[key];
}

module.exports = {
  get STATE_DIR() { return getStateDir(); },
  get STATE_FILE() { return getStateFile(); },
  sessionCounters,
  monthKey,
  minuteKey,
  emptyBucket,
  defaultState,
  loadState,
  saveState,
  updateState,
  rollBucket,
  getBucket,
  withFileLock,
};
