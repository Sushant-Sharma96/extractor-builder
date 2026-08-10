# DOCUMENTATION_INDEX.md — Foundation Freeze v1

| Field | Value |
|-------|--------|
| **Date** | 2026-07-18 |
| **SSOT for status** | `CURRENT_TRUTH.md` |

---

## Constitution & freeze

| Document | Purpose | Authority | Status | Superseded? |
|----------|---------|-----------|--------|-------------|
| `CURRENT_TRUTH.md` | Live status SSOT | Status | **Current** | — |
| `ARCHITECTURE_LOCK_CONTRACT.md` | Freeze constitution | Freeze | **Current** | — |
| `FINAL_ARCHITECTURE_AUDIT.md` | Post-11b audit | Hardening guide | **Current** | Supersedes 1–7 freeze *as latest audit* |
| `ARCHITECTURE_FREEZE_AUDIT.md` | Pre-Phase-8 freeze | Historical | Archive | Partially by FINAL audit + Lock |
| `FINGERPRINT_CONTRACT_AUDIT.md` | Fingerprint sync | Contract | **Current** | — |
| `API_STABILITY_REPORT.md` | API classes | Freeze | **Current** | — |
| `BACKWARD_COMPATIBILITY_POLICY.md` | Compat rules | Freeze | **Current** | — |
| `EXTENSION_POINT_AUDIT.md` | Allowed/forbidden extensions | Freeze | **Current** | — |
| `ARCHITECTURE_METRICS.md` | Counts | Informational | **Current** | — |
| `DOCUMENTATION_INDEX.md` | This index | Navigation | **Current** | — |

---

## RFCs & plans

| Document | Purpose | Authority | Status |
|----------|---------|-----------|--------|
| `COMPILER_DECISION_SYSTEM.md` | RFC-002 | Reasoning primary | Current |
| `COMPILER_ARCHITECTURE_AUDIT.md` | RFC-001 | Historical / ideal | Current (roadmap superseded) |
| `IMPLEMENTATION_MASTER_PLAN.md` | Phase roadmap | Plan | Foundation Freeze v1 header |
| `PLUGIN_CAPABILITY_CONTRACT.md` | Plugin model | Contract | Current |
| `KNOWLEDGE_BUNDLE_ARCHITECTURE.md` | Knowledge model | Contract | Current |
| `COMPILER_DECISION_SYSTEM.md` / related | Decision | RFC-002 | Current |

---

## Phase completion & proposals (1–11b.1)

| Document | Purpose | Status |
|----------|---------|--------|
| `phases/PHASE_01_*` … `PHASE_11B_*` | Delivery / design | Historical + complete |
| `phases/PHASE_11B1_COMPLETION_REPORT.md` | Hardening completion | **Current** |
| `phases/PHASE_11B_CONSTRAINT_VALIDATION_REPORT.md` | Constraint validation | Current |
| Older “Stop. Phase N not implemented” footers | Handoff at write-time | **Archive — ignore for status** |

---

## Early audits

| Document | Status |
|----------|--------|
| `AUDIT_PHASE_1_TO_4.md` | Archive |
| `PRE_PHASE5_HARDENING_REPORT.md` | Archive |
| `PRE_PHASE6_INTEGRATION_AUDIT.md` | Archive |

---

## Contracts

| Path | Purpose |
|------|---------|
| `contracts/schemas/` | JSON Schemas |
| `contracts/registries/` | IR stages, questions |
| `contracts/validation/harness.js` | CI validation |
| `contracts/CATALOG.md` | Schema catalog |

---

## Precedence (short)

`CURRENT_TRUTH` → `ARCHITECTURE_LOCK_CONTRACT` → `FINAL_ARCHITECTURE_AUDIT` → RFC-002 → Master Plan → Phase completion reports → Proposals.
