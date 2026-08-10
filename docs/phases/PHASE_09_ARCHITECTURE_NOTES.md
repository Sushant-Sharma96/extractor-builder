# Phase 9 Architecture Notes — Feature Extraction & Recognition

| Field | Value |
|-------|--------|
| **Phase** | 9 |
| **Status** | Notes only — complements PHASE_09_EXECUTION_PLAN / COMPLETION_REPORT |
| **Authority** | RFC-002; Master Plan Phase 9; PLUGIN_CAPABILITY_CONTRACT; KNOWLEDGE_BUNDLE_ARCHITECTURE; PHASE_08_* |

---

## Ownership (unchanged from Phases 1–8)

| Module | Owns | Does not own |
|--------|------|--------------|
| **features/** | Pure deterministic extract/normalize helpers | Semantics, decisions, emit |
| **Rule Packs** | Evidence / Hypothesis / Candidate proposals | Decisions, Fact mutation, Knowledge mutation |
| **Plugin (Phase 6)** | Capability enforcement + lifecycle | Domain rules |
| **Knowledge** | Immutable ontology ids | Rule execution |
| **Workspace** | Passive store | Scoring / ranking |
| **Decision Runtime** | Rank / arbitrate / commit | Feature extraction |
| **Policy** | `pattern_name_cap` and other thresholds | Recognition logic |
| **Kernel** | Register / pin / invoke packs | Domain intelligence |

---

## Data flow

```text
Fact (kind: source.node)
        │
        ▼
compiler/features  (pure: normalize → extract)
        │
        ▼
Rule Pack feature.extract
        │  Evidence (kind: feature) + Hypothesis (recognition.features)
        ▼
Workspace (passive)
        │
        ▼
Rule Pack recognition.basic
        │  Evidence + multi-candidate Hypothesis (recognition.blockKind)
        ▼
Workspace → (later) Decision Runtime
```

No second plugin framework. Packs register via Phase 6 / Phase 8 APIs only.

---

## What “recognition” means here

**Probabilistic, low-level, structural only.**

Allowed labels (candidates, not Decisions):

- button-like, card-like, container-like
- text-block, image-block, divider
- section, grid, stack, list
- generic-block

Not allowed: Hero, Navbar, Accordion, Carousel, Tabs, Footer, landing-page, page understanding.

---

## Feature set (deterministic)

Node type, frame/text/rectangle/image/vector signals, auto-layout, constraints, padding/spacing/gap, fill/stroke/radius/shadow/opacity, typography/font/weight/alignment, dimensions/position/visibility/overflow/effects/border/corner, hierarchy (parent/children/siblings), absolute vs relative positioning.

Nothing semantic. Nothing visual reasoning. Nothing AI.

---

## Policy interaction

When a recognition cue is **name-only**, localScore is capped at Policy `thresholds.pattern_name_cap`. Structural cues may propose higher localScores but remain proposals only.

Near-misses are Evidence (`kind: other`, `ref: near_miss`) — never commits.

---

## Knowledge

Recognition ontology bundle (`recognition-ontology`) supplies `feature_def` and `pattern` entry ids. Rules **read** and **cite**; never mutate.

Composition root `recognition-composed` layers base UI ontology + recognition ontology for jobs that need both.

---

## Questions

Registry namespace `recognition` (MINOR extension):

- `recognition.features` — feature-bag extraction hypothesis
- `recognition.blockKind` — low-level block-like recognition candidates

---

## Forbidden

- Changing Decision Runtime / Kernel ownership / Plugin capability model
- Fact / Knowledge mutation from rules
- Hero/Navbar/… detection
- Layout / Semantic / AI engines
- HTML/CSS/JS emit / `compile()`
