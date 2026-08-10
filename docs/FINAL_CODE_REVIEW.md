# Final Code Review — Product Scalability Shell

| Field | Value |
|-------|--------|
| **Reviewer stance** | Senior Staff Engineer — critical |
| **Date** | 2026-07-18 |
| **Scope** | `server/scalability/*`, `figma-snapshot.js` (Phase 1–2 bits), `figma-fetch.js` (429 fields), `/api/figma/convert` wiring |
| **Out of scope** | Compiler IR quality (frozen; assumed separately validated) |
| **Code changes** | **None** — review only |

---

## Executive take

You built the **right shape**: Resolver → Planner → Budget → Executor → compile. Phase boundaries held. That is rare and valuable.

You also accumulated **integration debt**: almost no tests on the new shell, advisory budget that can false-Deny, and file-backed state that will corrupt under concurrency. Ship as a **local tool**; do not market as production SaaS until the blockers in `PRODUCTION_READINESS_REPORT.md` are closed.

---

## What is genuinely good

1. **Hard compiler wall** — convert still ends at `compile()`; no second emitter.  
2. **Opaque snapshot → Executor** — Exact vs Subtree correctly hidden behind `fromSnapshot`.  
3. **Covering ingest + subtree** — highest-ROI product idea; matches Figma economics.  
4. **Budget never calls Figma** — clean authority split; 429 lock prevents stampede.  
5. **Planner refine stages** — decisions pulled out of Executor; executable plan object is real.  
6. **Phase reports** — operational memory for future maintainers.

---

## Critical findings

### 1. Missing tests (severity: High)

`compiler/test/*` is rich. `server/scalability/*` has **no** automated suite.  

Every Phase 1–4 invariant (SUBTREE 0 REST, lock Deny, skip fills) is one refactor away from silent breakage.  

**This is the #1 maintenance risk.**

### 2. Budget persistence races (severity: High)

`loadState` → mutate → `saveState` without locking. Two parallel MISSes → lost usage or lost locks.  

False sense of quota safety under load.

### 3. Soft limits default to Starter (severity: Medium–High)

Unknown plan tier → 6 Tier‑1/month soft Deny. Pro users who never 429 yet get blocked by **your** estimate, not Figma’s.  

`force=true` is an escape hatch — and a security/product footgun if exposed in UI carelessly.

### 4. Queue is not a queue (severity: Medium)

`outcome: Queue` returns HTTP 503 immediately. Name implies delayed execution; behavior is Deny-with-retry-hint. Misleading for future maintainers and clients.

### 5. Background snapshot failure is silent (severity: Medium)

Convert returns `ok: true` before snap completes. Failed bg save → next “Subtree” still MISS → surprise REST/429.  

Client believes it is cached; it is not.

### 6. Planner ↔ Executor temporal coupling (severity: Medium)

Executor must call refine hooks in the correct order. Nothing type-enforces the state machine (`pending_geometry` → …). A future contributor can skip a refine and reintroduce decisions into Executor.

### 7. Double analyze (severity: Low–Medium)

`refineAfterCovering` analyzes covering; route/`executeMiss` analyzes compile extract again. Correct but wasteful; easy to drift if analyze gains side effects.

### 8. `userKey: 'local'` hard-coded (severity: Medium for SaaS)

Budget identity is fake. All users share one advisory bucket on a shared server.

### 9. Plugin path bypass (severity: Low — intentional)

`/api/figma/plugin` skips Resolver/Planner/Budget. Fine for plugin, but two products in one repo without a shared “source adapter” interface. Drift risk.

### 10. Dead / leftover abstractions (severity: Low)

- `needsLegacy` field placeholder in planner `basePlan`  
- Comments referring to “Phase 0” in places  
- `discoverCovering` removed from executor exports but covering logic split across modules — OK, watch orphans  
- Old `ARCHITECTURE_VALIDATION_REPORT` content moved aside — good; ensure links updated elsewhere if any

### 11. Error handling inconsistency (severity: Low–Medium)

Figma errors attach rich 429 fields; other failures are plain messages. Budget on error only populated for 429. Fine, but clients must special-case.

### 12. Cache growth / naming (severity: Medium ops)

URL-hash asset names + no eviction + covering snaps with full asset sets → disk bloat. Content-hash was correctly deferred; ops still need a broom.

### 13. Over-engineering? (severity: Low — mostly justified)

Seven scalability files for a local tool looks heavy, but each maps to an approved phase. **Not** microservice theater.  

Slight overkill: Budget Queue/Degrade outcomes before Executor enforces Degrade — half-built policy surface.

### 14. Under-engineering? (severity: High where it counts)

Tests, concurrency, observability — underbuilt relative to architectural ambition.

### 15. Rollback safety (severity: Medium)

Phases are revertible by file, but **on-disk** snaps/index/`_budget` remain. Rolling back code while keeping new metadata is usually OK (`schemaVersion` still 1); rolling forward after partial revert needs care.

### 16. Regression risks (severity: High without tests)

Most fragile edges:

- Subtree asset filtering missing a ref  
- Covering save using compile doc instead of covering doc (was fixed in Phase 2 — don’t regress)  
- Budget Deny blocking offline HIT (was fixed — don’t regress)  
- Planner skip fills when imageRef exists only on nested node  

### 17. File organization & naming (severity: Low)

`server/scalability/` is clear. `prepareFigmaSources` name is fine. `executeMiss` still named “Miss” though it executes any REST plan — mild misnomer (`executePlan` would be clearer).

### 18. Hidden coupling (severity: Medium)

- Planner imports `figma-build.analyze` + `reconstructSvgMarkup` (domain knowledge in planner — acceptable but couples planner to emitter helpers)  
- Budget prediction duplicated conceptually with Planner prediction (Budget prefers plan.prediction — good; keep single source)  
- `index.js` knows covering snapshot fields — could live in a `persistPreparedSources` helper later

### 19. Future scalability (severity: Honest)

Architecture **extends** cleanly (modes, degrade enforcement, object storage).  

Infrastructure **does not** scale without replacing disk budget/cache assumptions.

### 20. Race conditions summary

| Race | Impact |
|------|--------|
| Budget JSON RMW | Lost locks/counters |
| Concurrent `saveSnapshotAtomic` same key | Last wins |
| Read Subtree while bg write | Mitigated by validate `complete` + tmp dirs |
| OAuth token swap mid-request | Edge case single-user |

---

## Maintainability forecast (12 months)

If you add Product Modes + UI budget chips **without** tests: expect intermittent 429/Deny bugs and “why is my Pro denied?” support load.  

If you add a focused `server/scalability/*.test.js` harness first: this shell will age well.

---

## Verdict table

| Area | Grade | Note |
|------|-------|------|
| Architecture fit | **A** | Matches approved spec |
| Implementation discipline (phases) | **A−** | Clean stops; little scope creep |
| Correctness confidence | **C+** | Manual smoke only |
| Production hardness | **D+** | See readiness blockers |
| Code clarity | **B+** | Good modules; some naming debt |
| Test coverage (shell) | **F** | Essentially absent |

**Staff recommendation:** Freeze features. Invest the next sprint in **tests + budget atomicity + cache TTL/eviction**, not new planners.

---

## Do not do next (reviewer opinion)

- Redis/CDN/S3 “because production” before tests  
- Enforcing Degrade in five places at once  
- Rewriting compiler to “help” caching  
- Collapsing Planner back into Executor “to simplify”

---

*End of final code review. No code modified. Awaiting manual review.*
