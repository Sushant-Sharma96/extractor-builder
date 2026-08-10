# Phase 10 Completion Report — Canonical Design Graph Materialization

| Field | Value |
|-------|--------|
| **Phase** | 10 — Canonical Design Graph (`NormalizedDesignGraph`) |
| **Date** | 2026-07-18 |
| **Depends on** | Phases 1–9; `PHASE_10_ARCHITECTURE_PROPOSAL.md` |
| **Authority** | Proposal (wins on conflict); RFC-001/002; Master Plan Phase 10 intent |
| **Status** | **Implementation complete** — all required tests green |
| **Phase 11** | **11a complete** — see `PHASE_11_COMPLETION_REPORT.md` (11b deferred) |

---

## 1. Deliverables

| Item | Location |
|------|----------|
| Execution plan | `docs/phases/PHASE_10_EXECUTION_PLAN.md` |
| Architecture notes | `docs/phases/PHASE_10_ARCHITECTURE_NOTES.md` |
| Migration notes | `docs/phases/PHASE_10_MIGRATION_NOTES.md` |
| NDG module | `compiler/ndg/` (ingest, build, validate, report, publish, materialize) |
| Facts plugin declaration | `facts.ndg.materialize` (`engineType: facts`) |
| Kernel API | `job.materializeNormalizedDesignGraph()` |
| Fingerprint | `ndgChecksum`, `ndgBuilderVersion`, `ndgGraphId` |
| Phase 9 migration | Prefer `ndg.node`; `source.node` transitional |
| Tests | `compiler/test/ndg.test.js` |
| npm | `npm run test:ndg` / `test:phase10` |

### Capabilities

- Build deterministic `NormalizedDesignGraph` from RawDesignDocument trees or `source.node` Facts  
- Visibility / empty / passthrough policies with Evidence traces  
- Publish IrSlice `normalized-design-graph` + Facts `ndg.graph` / `ndg.node`  
- Graph Validation Report (counts, drops, fingerprint, builder version)  
- Phase 9 packs consume NDG as structural SSOT  
- Idempotent rebuild; Decision Runtime untouched  

---

## 2. Structural SSOT

```text
Raw / source.node (ingress)
  → NormalizedDesignGraph (IrSlice + Facts)
  → Phase 9 Features / Recognition (proposals)
  → (later) Layout / Semantic / … → Decisions → ResolvedIR → Emit
```

Features and Recognition remain proposals. Meaning remains undecided.

---

## 3. Test Results

```text
npm run test:contracts   → 34 passed
npm run test:kernel      → 17 passed
npm run test:workspace   → 25 passed
npm run test:decision    → 24 passed
npm run test:policy      → 19 passed
npm run test:plugin      → 28 passed
npm run test:knowledge   → 16 passed
npm run test:rulepack    → 15 passed
npm run test:features    → 16 passed
npm run test:ndg         → 16 passed
```

---

## 4. Invariants Held

| Invariant | Status |
|-----------|--------|
| Existing NDG contract reused (no CanonicalGraph schema) | Held |
| No GraphEngine / LayoutEngine / SemanticEngine framework | Held |
| Fact writes via Phase 6 facts plugin (not Rule Packs) | Held |
| Decision Runtime unchanged | Held |
| Knowledge immutable | Held |
| Workspace passive | Held |
| No HTML / emit / `compile()` | Held |
| Phases 1–9 ownership preserved | Held |

---

## 5. Known Limitations

- Edge identity is composite (`kind:from:to:index`) — NDG schema has no `edgeId` field  
- Collapse policy is conservative and traced; may need Policy knobs later  
- `source.node` dual path remains transitional until call sites always materialize first  

---

## 6. Out-of-Scope Confirmation

Not implemented: Layout interpretation; flex/grid Decisions; Component/Hero/Navbar; Semantic/Token/Responsive/Animation engines; ResolvedIR; EmitPlan; HTML/CSS/JS; `compile()`; AI.

---

## 7. Phase 11 Handoff

Phase 11 (Layout) may:

- Read `ndg.node` / NDG IrSlice as sole structural input  
- Propose `layout.mode` Hypotheses / Decisions against stable subjects  

Phase 11 must **not**:

- Rebuild a private tree from raw Figma  
- Bypass NDG identity space  

**Historical note:** Phases 11a/11b and Foundation Freeze v1 (11b.1) are complete. Current status: `docs/CURRENT_TRUTH.md`.

**Stop. (Historical handoff text superseded — do not treat as current.)**
