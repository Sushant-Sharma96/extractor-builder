# Phase 5 Execution Plan — Policy Profiles & Minimal Gates

| Field | Value |
|-------|--------|
| **Phase** | 5 — Policy Profiles & Minimal Gates |
| **Status** | Authorized (Pre-Phase-5 Hardening GREEN; Phases 1–4 frozen) |
| **Depends on** | Phase 1 PolicyProfile contract; Phase 2 Kernel bind/gates; Phase 4 Decision Runtime threshold slots |
| **Unlocks** | Phase 6 — Plugin Capability Contract |
| **Authority** | IMPLEMENTATION_MASTER_PLAN Phase 5; RFC-002 §§1.2, 7.3–7.4, 8.2; RFC-001 policy modes |

---

## Goals

Make product modes real as **authoritative configuration**.

Policy Profiles define values. They do **not** execute logic, detect components, rank, score, choose winners, or emit artifacts.

Decision Runtime remains the only arbitration component and **consumes** resolved profiles.

## In scope

- PolicyProfile definitions (`pixel-faithful`, `semantic-lean`, `static-ok`, placeholder `interactive-required`)
- Profile loading, versioning, validation
- Threshold tables (RFC-002 §7.3 knobs)
- Profile inheritance (optional `extends`)
- Profile resolution → frozen enforceable object
- Policy compatibility checks (suite / profile version)
- Authoritative threshold values (`valuesAuthoritative: true`)
- Serialization / registry
- Gate mode on QualityReport stubs (`fail_closed` vs `best_effort`)
- Decision Runtime consumption of resolved profiles
- Tests

## Out of scope

- Rule Engine, Knowledge Base, Pattern Engine
- Layout / Semantic / Component engines
- HTML / CSS / JS generators
- Convert API wiring
- Full quality metrics implementation
- Phase 6 plugin contract

## Exit criteria

- Policy corpus: ≥3 shipping profiles + interactive-required placeholder
- Same synthetic decision inputs differ by profile as expected
- Authoritative profiles reject missing thresholds
- Kernel/Decision/Workspace/contracts suites remain green
- No reasoning or emit inside Policy module

## Rollback

Default to single non-authoritative profile; disable registry resolution.

## Non-goals of this document

Architecture redesign. New RFC concepts.
