# RFC_CONSOLIDATION.md

| Field | Value |
|-------|--------|
| **Document** | Consolidated Future RFC Recommendations |
| **Date** | 2026-07-18 |
| **Sources** | `ARCHITECTURE_LOCK_CONTRACT.md`, Phase 11b.1–16 completion reports, Final Architecture Audit |
| **Rule** | Deferred RFCs are **not** implemented here; Foundation stays frozen |

---

## Status legend

| Status | Meaning |
|--------|---------|
| **Implemented** | Done in-tree |
| **Deferred** | Valid; do not implement without RFC / plan |
| **Duplicate** | Covered by another FR id |
| **Superseded** | Problem fixed or replaced by later FR |

---

## Foundation

| Id | Title | Status | Priority | Notes |
|----|-------|--------|----------|-------|
| FR-03 | Collapse dual `registerEngine` / `registerPlugin` | Deferred | P1 | Extension surface confusion |
| FR-04 | Pipeline runner (non-emit) | Deferred | P1 | Caller-ordered waves fragile for ResolvedIR+ |
| FR-07 | Process plugin sandbox | Deferred | P3 | try_catch only today |
| FR-08 | Slice-scoped Evidence/Hypothesis ids on re-solve | **Implemented** | — | Phase 11b.1 |
| TD-01 (audit) | Sync fingerprint schema | **Implemented** | — | Superseded by 11b.1 sync; harness green |
| Final audit active LayoutIR pin | Active LayoutIR pin | **Implemented** | — | 11b.1 |

---

## Workspace

| Id | Title | Status | Priority | Notes |
|----|-------|--------|----------|-------|
| FR-01 | Unify RuleContext IrSlice reads | Deferred | P1 | Packs blank IrSlice → Fact dual view |
| FR-13-01 | No Workspace pin for TokenIR / ComponentIR | Deferred | P3 | Fingerprint slice ids only |
| FR-14-03 | No Workspace pin for SemanticIR | Deferred | P3 | Duplicate class of FR-13-01 |
| FR-15-03 | No Workspace pin for ResponsiveIR | Deferred | P3 | Duplicate class of FR-13-01 |
| FR-16-03 | No Workspace pin for AccessibilityIR | Deferred | P3 | Duplicate class of FR-13-01 |
| **WS-PIN-GEN** | Generalize IrSlice pins beyond Layout | Deferred | P2 | **Canonical** merge of FR-13-01 / 14-03 / 15-03 / 16-03 |

Mark FR-13-01, FR-14-03, FR-15-03, FR-16-03 as **Duplicate** of **WS-PIN-GEN** for planning; keep ids for provenance.

---

## Policy

| Id | Title | Status | Priority | Notes |
|----|-------|--------|----------|-------|
| FR-15-01 | Breakpoint widthHints provisional | Deferred | P3 | Move defaults to Policy/Knowledge |
| (implicit) | A11y contrast thresholds | Deferred | P3 | See FR-16-01 |
| Profile corpus pixel vs semantic | Deferred | Medium | Final audit / Master Plan risk R15 |

---

## Knowledge

| Id | Title | Status | Priority | Notes |
|----|-------|--------|----------|-------|
| FR-14-01 | Name-heuristic landmark bias | Deferred | P3 | Pattern packs / Knowledge content |
| FR-13-02 | Token frequency heuristics | Deferred | P4 | Pack/Policy thresholds |
| Knowledge content thin | Deferred | — | Bundles minimal by design |

---

## Registry

| Id | Title | Status | Priority | Notes |
|----|-------|--------|----------|-------|
| FR-15-02 | Audit missing IR stages before engines | Deferred | P2 | `responsive-ir` was gap; asset/behavior still placeholders |
| FR-16-02 | `a11y.role` registry wording vs neutrality | Deferred | P4 | Docs MINOR only |
| Dead `asset-ir` / `behavior-ir` | Deferred | P2 | Keep until engines; ResolvedIR must tolerate absence |
| Dead questions `html.tag`, `asset.degrade`, `behavior.authorize_js` | Deferred | P3 | Emit / Behavior owned |

---

## Documentation

| Id | Title | Status | Priority | Notes |
|----|-------|--------|----------|-------|
| FR-06 | Rename `features.normalize` | Deferred | P2 | Naming collision with NDG |
| Lock Contract header “through 11b” | Deferred | P4 | Stale vs CURRENT_TRUTH; status file wins |
| Final audit “Current Truth index” | **Implemented** | — | `CURRENT_TRUTH.md` exists |
| FR-14-02 | `html.tag` remains emit-owned | Deferred | P2 | Document at Emit kickoff |

---

## Product

| Id | Title | Status | Priority | Notes |
|----|-------|--------|----------|-------|
| FR-02 | Collapse dual constraint hypothesis paths | Deferred | P1 | Pack + facts plugin both propose |
| FR-05 | Retire `source.node` structural dual | Deferred | P1 | Transitional SSOT |
| FR-16-01 | Contrast observations stub | Deferred | P3 | WCAG gates later |
| Multi-frame artboard polish | Deferred | — | Master Plan Phase 15 out-of-scope |

---

## Grouping for ResolvedIR planning

### Must remain deferred (do not block start)

- WS-PIN-GEN and pin duplicates  
- FR-06, FR-07, FR-13-02, FR-14-01, FR-15-01, FR-16-01, FR-16-02  
- Dead asset/behavior until those phases  

### Consider before ResolvedIR *completes* (not before start)

| Id | Why |
|----|-----|
| FR-04 | Orchestration of many slices into ResolvedIR |
| FR-01 | Packs may need IrSlice reads when composing |
| FR-02 / FR-05 | Determinism of workspace evidence vs IR checksums |

### Implemented (closed)

| Id |
|----|
| FR-08 |
| Fingerprint schema sync (TD-01) |
| LayoutIR active/baseline pins |
| CURRENT_TRUTH index |

---

## Superseded / closed audit items

| Old item | Fate |
|----------|------|
| Final audit “fingerprint schema drift” | **Superseded** — fixed in 11b.1 |
| Final audit “no active LayoutIR pin” | **Superseded** — fixed in 11b.1 |
| “Component not started” in Final audit | **Superseded** — Phases 12–16 complete |

---

## Count

| Status | Count (approx.) |
|--------|-----------------|
| Implemented | 4+ |
| Deferred | ~20 |
| Duplicate (pin family) | 4 → 1 canonical |
| Superseded | 3+ |
