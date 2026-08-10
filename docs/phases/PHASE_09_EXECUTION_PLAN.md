# Phase 9 Execution Plan — Feature Extraction & Recognition Infrastructure

| Field | Value |
|-------|--------|
| **Phase** | 9 — Pattern Recognition Infrastructure |
| **Status** | Authorized (Phase 8 complete) |
| **Depends on** | Phases 1–8; PLUGIN_CAPABILITY_CONTRACT; KNOWLEDGE_BUNDLE_ARCHITECTURE; ARCHITECTURE_FREEZE_AUDIT |
| **Unlocks** | Phase 10 — Normalization Engine (Facts) |
| **Authority** | RFC-002 §4–§5; Master Plan Phase 9; PHASE_08_COMPLETION_REPORT handoff |

---

## Goals

Introduce **deterministic Feature Extraction** and **low-level Recognition** as Rule Packs.

Pipeline:

```text
Raw Design Nodes (Facts)
  → Feature Extraction
  → Evidence
  → Recognition Candidates (Hypotheses)
  → Workspace (passive)
  → Decision Runtime (later — untouched)
```

This phase does **not** classify complete UI components (Hero, Navbar, Carousel, …).

---

## In scope

- Deterministic feature extraction module (`compiler/features/`)
- Feature Extraction Rule Pack
- Recognition Rule Pack (button-like, card-like, container-like, text/image block, divider, section, grid, stack, list, generic block)
- Evidence / Hypothesis / Candidate emission only
- Knowledge ontology entries for recognition feature_defs / patterns (read-only)
- Question registry extension: `recognition.*` namespace
- Tests + phase docs

---

## Out of scope

Hero / Navbar / Accordion / Carousel / Tabs / Footer / landing-page detection; Layout Engine; Semantic Engine; AI/LLM/Vision; HTML/CSS/JS emit; Emit pipeline; Decision Runtime changes; `compile()`; Phase 10 Normalization Engine.

---

## Integration rules

- Feature Extraction and Recognition are **Rule Packs** on Phase 8 / Phase 6 infrastructure — **no second framework**
- Knowledge remains read-only; rules cite ontology ids
- Workspace remains passive (Facts / Evidence / Hypotheses / Candidates; no scoring/ranking)
- Decision Runtime untouched (no arbitration, no ranking changes)
- Name-only confidence capped by policy `pattern_name_cap`
- Ambiguity retained as multi-candidate Hypotheses
- Near-miss recorded as Evidence (not Decisions)

---

## Fact convention (Phase 9)

Node-shaped Facts use `kind: "source.node"` with assertion fields suitable for deterministic extraction. Full Normalization Engine remains Phase 10.

---

## Exit criteria

- Raw node-shaped Facts → structured Features → Evidence
- Recognition produces multi-candidate Hypotheses with Evidence refs
- Name-only scores capped by policy
- Traces / diagnostics show evidence kinds
- Suites 1–8 remain green
- No semantic / UI-component / HTML generation introduced

---

## Rollback

Disable recognition / feature-extract Rule Packs.
