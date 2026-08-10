# Phase 10 Execution Plan — Canonical Design Graph Materialization

| Field | Value |
|-------|--------|
| **Phase** | 10 — Canonical Design Graph (NormalizedDesignGraph) Materialization |
| **Status** | Authorized (PHASE_10_ARCHITECTURE_PROPOSAL) |
| **Depends on** | Phases 1–9 |
| **Unlocks** | Phase 11 Layout Engine (and all graph consumers) |
| **Authority** | PHASE_10_ARCHITECTURE_PROPOSAL (wins on conflict); RFC-001/002; Master Plan Phase 10 intent |

---

## Goals

Materialize the existing **`NormalizedDesignGraph`** contract as the compiler’s **structural Single Source of Truth** (AST).

Publish into Workspace as:

- IrSlice `stageId: normalized-design-graph`
- Facts `ndg.graph` / `ndg.node`
- Evidence for dropped / collapsed nodes (traced, not silent)
- Graph Validation Report

Phase 9 Feature / Recognition packs become **graph consumers** (prefer `ndg.node`; `source.node` transitional).

---

## In scope

- Deterministic NDG builder + validator + report
- Kernel-invoked Fact producer plugin (`engineType: facts`) — **not** a Rule Pack Fact writer
- Stable ids, parent/order edges, visibility / empty-wrapper policy with traces
- Fingerprint fields for NDG checksum / builder version
- Phase 9 migration to read NDG Facts
- Tests + phase docs

## Out of scope

Layout/Semantic/Token/Responsive/Animation Decisions; Hero/Navbar; ResolvedIR; EmitPlan; HTML/CSS/JS; `compile()`; Decision Runtime changes; new graph schema; second framework (`GraphEngine` class-as-framework).

---

## Exit criteria

- One deterministic NDG per job from raw / `source.node` inputs
- Invariants: single parent (except root), no orphans, no cycles, stable ids/order, idempotent rebuild
- Validation report with fingerprint + builder version
- Phase 9 packs consume `ndg.node` when present
- Suites 1–9 remain green
- No Decision commits; no semantic labeling

---

## Rollback

Disable NDG materialization; Phase 9 may fall back to transitional `source.node` (fingerprint must mark degraded).
