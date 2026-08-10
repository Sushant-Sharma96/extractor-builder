# Phase 6 Execution Plan — Plugin Capability Contract

| Field | Value |
|-------|--------|
| **Phase** | 6 — Plugin Capability Contract |
| **Status** | Authorized (contract frozen; Pre-Phase-6 audit YELLOW) |
| **Depends on** | Phases 1–5; `docs/PLUGIN_CAPABILITY_CONTRACT.md` |
| **Unlocks** | Phase 7 — Knowledge Bundle |
| **Authority** | RFC-002 §11; Master Plan Phase 6; Plugin Capability Contract |

## Goals

Infrastructure only: declaration, registry, capability-scoped execution, isolation, failure contract, fingerprint plugin set, generic scheduler.

## In scope

Full declaration validation; registry; scoped context (no raw Workspace); lifecycle; crash/timeout/retry/rollback; compatibility; fingerprint; schedule by phaseAffinity/cost; fake infrastructure plugins in tests only.

## Out of scope

Layout/Semantic/Rule/Knowledge/Pattern/AI/Animation/A11y/Behavior/Emit; convert/compile redesign; Phase 7.

## Exit criteria

Capability deny paths; Decision monopoly; crash preserves Workspace/Decisions/Traces; suites 1–5 green; `test:plugin` green.
