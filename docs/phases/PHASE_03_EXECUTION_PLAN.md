# Phase 3 Execution Plan — Workspace (Blackboard)

| Field | Value |
|-------|--------|
| **Phase** | 3 — Workspace |
| **Status** | Authorized (Phase 2 accepted) |
| **Depends on** | Phase 1 contracts `@1.0.0`, Phase 2 Kernel |
| **Unlocks** | Phase 4 — Decision / Arbitration |
| **Authority** | IMPLEMENTATION_MASTER_PLAN Phase 3; RFC-002 §6 Workspace model; RFC-001 data contracts |

---

## Goals

Provide a **passive shared blackboard** for Facts, Hypotheses, Decision Records, Evidence, IR slices, and Provenance.

Engines (later) communicate **only** through the Workspace. The Workspace **stores**; it does not reason, score, arbitrate, schedule, match patterns, or emit.

## In scope

- Workspace create / finalize / discard lifecycle  
- Typed stores: Fact, Hypothesis, DecisionRecord, Evidence, IR slice, Provenance  
- Read/write APIs with auditability  
- Immutable Facts (no in-place mutation; conflict on identity)  
- Version-aware storage (`suiteVersion` / contract pins)  
- Debug snapshot (deep serializable clone)  
- Capability-check stub (writer may only write declared kinds)  
- Invalidation hooks (record invalidations without mutating Facts)  
- Cross-reference integrity checks on write (optional soft/hard)  
- Replace Kernel `attachWorkspace` stub with real Workspace attach  
- Tests including two fake writers communicating only via Workspace  

## Out of scope

- Arbitration, scoring, confidence math (Phase 4)  
- Rule / Knowledge / pattern engines  
- Layout / Semantic reasoning  
- HTML emit, convert API wiring  
- Changing Decision outcomes inside Workspace logic  
- UI ontology  

## Deliverables

1. `compiler/workspace/` module  
2. Kernel job `attachWorkspace()` returns live Workspace  
3. `npm run test:workspace` green  
4. `docs/phases/PHASE_03_COMPLETION_REPORT.md`  

## Exit criteria

- Workspace usable as blackboard for registered-capability writers  
- Fact immutability enforced  
- Invalid / unauthorized writes denied  
- Two fake engines exchange data only via Workspace (no private pipe)  
- Snapshot available for debug  
- No reasoning/arbitration/emit in Workspace  

## Rollback

Detach Workspace; restore Kernel stub behavior if needed. Do not wire into production convert routes.
