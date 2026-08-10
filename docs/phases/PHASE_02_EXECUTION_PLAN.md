# Phase 2 Execution Plan — Compiler Kernel

| Field | Value |
|-------|--------|
| **Phase** | 2 — Compiler Kernel |
| **Status** | Authorized (Phase 1 approved 2026-07-18) |
| **Depends on** | Phase 1 `compiler-contract-suite@1.0.0` |
| **Unlocks** | Phase 3 — Workspace |
| **Authority** | IMPLEMENTATION_MASTER_PLAN Phase 2; RFC-002 §1 |

---

## Goals

Implement the **Compiler Kernel**: job OS for compile lifecycle, policy bind, budgets, engine registry hooks, scheduling skeleton, gate hooks, determinism fingerprint, failure taxonomy.

Empty jobs must reach terminal states **success | failed | aborted** with policy attached, deterministically for the same fingerprint inputs.

## In scope

- Job create / run / terminal states  
- Policy profile bind (Phase 1 PolicyProfile shape)  
- Budget slot tracking / exceed detection hooks  
- Engine registration + capability declaration storage  
- Scheduling skeleton (wave plan from declarations; no domain engines)  
- Gate evaluation hook (consumes QualityReport-shaped input; no scoring)  
- Compile Job Fingerprint construction (Phase 1 contract fields)  
- Failure taxonomy surface + typed job failures  
- Load/expose Phase 1 IR stage registry for stage-id checks  
- Enforce RFC-002 kernel invariants (no UI ontology, no HTML emit, no design API calls)  
- Hook placeholders for Workspace attach (Phase 3) and Arbitration (Phase 4) — **stubs only**

## Out of scope

- Workspace blackboard (Phase 3)  
- Decision Records / arbitration runtime (Phase 4)  
- Policy threshold product values (Phase 5)  
- Real engines, rules, Knowledge, layout, semantic, codegen, network  
- Wiring into `/api/figma/convert` or legacy compile path  
- New RFC concepts  

## Deliverables

1. Kernel module API (`createKernel`, `createJob`, registry, schedule, gates, fingerprint, failures)  
2. Empty-job terminal-state runner  
3. Unit/integration tests (`test:kernel`) including invariant / ontology absence checks  
4. Phase 2 completion report  

## Exit criteria

- Empty job reaches success / failed / aborted with bound policy  
- Same inputs → same fingerprint  
- No Navbar/Hero/Carousel (or similar) ontology in kernel  
- Engine register/list works; schedule skeleton returns wave plan without executing domain logic  
- Gate hook can fail-closed on error violations when configured  
- Tests green; Phase 3 may assume kernel job shell  

## Rollback

Do not wire Kernel into production convert routes. Remove or ignore `compiler/kernel` if abandoned.
