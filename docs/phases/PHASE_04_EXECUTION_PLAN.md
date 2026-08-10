# Phase 4 Execution Plan — Decision Runtime

| Field | Value |
|-------|--------|
| **Phase** | 4 — Decision Runtime |
| **Status** | Authorized (Phase 3 accepted) |
| **Depends on** | Phase 1 contracts, Phase 2 Kernel, Phase 3 Workspace |
| **Unlocks** | Phase 5 — Policy Profiles (authoritative thresholds) |
| **Authority** | IMPLEMENTATION_MASTER_PLAN Phase 4; RFC-002 §§2,5,7,8 |

---

## Goals

Install the **Decision Runtime**: the only component that turns Hypotheses/Candidates into committed Decision Records (winner, abstain, or override).

Orchestration only — **no domain intelligence** (no Navbar/Hero/Layout/Semantic discovery).

## In scope

- Decision session lifecycle (open → collect → rank → arbitrate → commit/close)  
- Candidate + evidence registration (explicit and/or from Workspace Hypotheses)  
- Ranking framework (priority bands + confidence scores)  
- Confidence combine API (framework; not calibration)  
- Arbitration protocol (margin / accept / abstain / safe-generic fallback)  
- Override handling  
- Status transitions (`proposed` → `arbitrated` | `overridden` | `fallen-back` | `rejected`)  
- Commit Decision Records into Workspace  
- Decision traces  
- Kernel `arbitrate` hook → Decision Runtime  
- Recovery hooks surface (bounded re-entry placeholder)  
- Synthetic tests (no Knowledge/Rules)

## Out of scope

- Knowledge / Rule / Pattern packs  
- Layout / Semantic / Component engines  
- Authoritative product policy threshold tables (Phase 5)  
- HTML/CSS/JS emit; convert API wiring  
- Provenance mutation  
- Fact creation  

## Thresholds note

Runtime may read PolicyProfile threshold **slots**. Until Phase 5, if `valuesAuthoritative !== true`, use documented **non-authoritative defaults** for synthetic tests only.

## Exit criteria

- Synthetic session: winner, abstain, override with traces  
- Facts immutable; Workspace passive  
- Kernel/Workspace tests still pass  
- No domain ontology in Decision Runtime  

## Rollback

Restore Kernel `arbitrate` stub; leave Workspace unchanged.
