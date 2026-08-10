# Production Hardening Report

| Field | Value |
|-------|--------|
| **Status** | Complete — awaiting manual review |
| **Date** | 2026-07-18 |
| **Scope** | Reliability only (tests, atomic I/O, locks, structured logs) |
| **Not in scope** | Product Modes, Redis, CDN, Planner/Budget/Resolver/Executor behavior changes, compiler |

---

## 1. Files modified

| File | Change |
|------|--------|
| `server/scalability/budget-state.js` | Atomic RMW lock, corrupt quarantine, env getters |
| `server/scalability/budget.js` | `recordRateLimit` / `recordUsage` via `updateState` |
| `server/figma-snapshot.js` | Atomic `writeJson`, `getCacheDir()`, safer index writes |
| `server/scalability/request-log.js` | **New** — structured JSON convert logs |
| `server/scalability/index.js` | Structured prepare/hit/miss logs + `executorSteps` |
| `server/index.js` | `requestId`, structured convert logs (additive API field) |
| `package.json` | `test:scalability`, `bench:scalability` |
| `server/scalability/test/*` | **New** helpers, run-all, bench |

## Untouched (by design)

- Planner/Budget/Resolver/Executor **decision logic**
- `compiler/**`, `contracts/**`
- Covering selection rules, cache strategies

---

## 2. Tests added

Command: `npm run test:scalability`

| Area | Coverage |
|------|----------|
| Planner | HIT/SUBTREE offline, refresh, self-cover refine, skip fills |
| Covering | Top-level FRAME preference |
| Budget | Allow HIT, 429 lock Deny MISS / Allow HIT, corrupt JSON recovery |
| Resolver + Snapshot | Exact HIT, Subtree Pricing/Hero, refresh bypass, validate incomplete |
| Integration | Desktop snap → Pricing prepare → **0 REST** → compile HTML |
| Executor | `fromSnapshot` shape |
| Regression | Dual `compile()` identical HTML + emit checksum |

**Result:** `15 passed, 0 failed`

---

## 3. Benchmarks

Command: `npm run bench:scalability`  
(Offline fixture — no live Figma cold MISS)

| Metric | Result (sample run) |
|--------|---------------------|
| Warm Exact resolve | **4 ms** |
| Warm Subtree resolve | **4 ms** |
| Warm Subtree prepare | **12 ms** |
| Compile (Pricing extract) | **93 ms** |
| Snapshot write (minimal) | **23 ms** |
| Snapshot load (via resolve) | **4 ms** |
| REST calls (Subtree) | **0** |
| Heap used | **~9.8 MB** |
| Cache size (fixture) | **~8 KB** |
| Cold MISS REST | n/a without network token |

Artifact: `server/scalability/test/bench-results.json`

---

## 4. Concurrency review (identify only — no redesign)

| Scenario | Finding | Severity |
|----------|---------|----------|
| Parallel converts + budget | Mitigated by `withFileLock` + `updateState` RMW | Improved; still single-host only |
| Parallel snapshot same key | Last atomic rename wins; possible lost update | Medium |
| Subtree read during bg write | `complete` flag + tmp dirs avoid partial HIT | OK |
| Stale lock file | Locks older than 10s discarded | OK |
| Multi-machine shared disk | File locks **not** distributed | Known blocker for SaaS |
| Queue outcome | Still immediate 503 (not a worker queue) | Naming debt only |

---

## 5. Race condition review

| Race | Before | After hardening |
|------|--------|-----------------|
| Budget load/modify/save | Lost updates | Serialized via lock file |
| Index `writeJson` tear | Partial JSON possible | Temp + rename |
| Corrupt budget JSON | Could throw oddly | Quarantine `.corrupt-*` + default state |
| Concurrent Exact save | Unchanged last-writer-wins | Documented; no redesign |

---

## 6. Atomic write strategy

| Store | Strategy |
|-------|----------|
| Snapshot dirs | Existing: write to `.tmp-*` → validate → rename (unchanged) |
| Snapshot JSON helpers | **New:** `writeJson` → temp → rename |
| File index | Uses atomic `writeJson` |
| Budget state | Temp → rename under exclusive `state.lock` |
| Corrupt budget | Rename aside; start clean |

---

## 7. Logging strategy

Module: `server/scalability/request-log.js`  
Format: one JSON object per line on stdout.

| Event | Fields (subset) |
|-------|-----------------|
| `convert_start` | requestId, fileKey, nodeId |
| `prepare` | cacheStrategy, plannerDecision, budgetDecision, predictions |
| `cache_hit` / `cache_miss_done` | restCalls, prepareMs, executorSteps |
| `budget_blocked` | reason, restCalls=0 |
| `snapshot_saved` / `snapshot_error` | snapshotTime / errors |
| `convert_done` / `convert_error` | compileTime, restCalls, errors |

Additive response field: `requestId` (non-breaking). Existing `cache` / `budget` unchanged in meaning.

---

## 8. Failure handling & recovery

| Failure | Behavior |
|---------|----------|
| Missing snapshot | MISS → Planner/Executor (unchanged) |
| Partial/invalid snap | `validateSnapshot` fail → treat as miss |
| Budget JSON corrupt | Quarantine + empty state → Allow/Deny by rules |
| Network/429 | Existing fetch errors + lock persist |
| Timeout | Existing 30s abort in `figmaGet` |
| Snapshot bg fail | Logged via `snapshot_error`; response already sent |
| Unexpected empty covering | Planner refine clears asset needs |

No behavior change to happy-path HTML/REST decisions.

---

## 9. Performance results

See §3. Offline Subtree path is sub-20ms prepare + ~100ms compile on sample fixture. Production cold MISS remains dominated by Figma latency (not re-benchmarked live to avoid burning quota).

---

## 10. Remaining production blockers

| # | Blocker | Status after hardening |
|---|---------|------------------------|
| B1 | Scalability tests | **Addressed** (`test:scalability`) |
| B2 | Budget concurrency | **Mitigated** on single host; not multi-node |
| B3 | Cache eviction | **Still open** (no policy — by design this phase) |
| B4 | Secret handling | **Still open** |
| B5 | Observability | **Mitigated** (structured logs; no metrics backend) |
| B6 | Multi-instance | **Still open** |
| B7 | Plan-tier default | **Still open** (no Budget logic change) |

---

## 11. Final checklist

| Check | Result |
|-------|--------|
| Compiler unchanged | **Yes** (only consumed in tests) |
| Architecture unchanged | **Yes** |
| Public API unchanged (non-breaking) | **Yes** (+ optional `requestId`) |
| HTML unchanged (decision paths) | **Yes** — regression test dual-compile equal |
| Existing snapshots still valid | **Yes** (`schemaVersion` 1) |
| No regression | **Yes** — `test:scalability` 15/15; `test:compile` exit 0 |

---

## How to run

```bash
npm run test:scalability
npm run bench:scalability
npm run test:compile
```

---

## STOP

Production Hardening is complete. **No Product Modes / Redis / architecture work performed.**  
Awaiting manual review.
