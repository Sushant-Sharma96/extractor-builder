# INTEGRATION_READINESS_REPORT.md

| Field | Value |
|-------|--------|
| **Document** | Integration readiness for ResolvedIR |
| **Date** | 2026-07-18 |
| **Prerequisite** | Architecture Validation Review (no code changed) |

---

## Explicit recommendation

# READY FOR RESOLVEDIR

Foundation Freeze v1 is intact. Domain engines through Accessibility are feature-complete for their approved scopes. ResolvedIR may begin **as a composition / commitment phase**, without reopening ownership of prior engines.

**Do not** start EmitPlan or `compile()` in the same gate without a separate readiness review.

---

## 1. Is Foundation complete?

| Area | Complete? |
|------|-----------|
| Contracts + harness | Yes |
| Kernel / Workspace / Decision / Policy / Plugin / Knowledge / RulePack | Yes |
| Features / Recognition | Yes (low-level) |
| NDG → Layout → Constraint | Yes |
| Fingerprint ↔ schema sync | Yes |
| LayoutIR pins | Yes |
| Freeze invariants | Held |

**Answer: Yes** — Foundation Freeze v1 is complete for its declared scope. Later engines extended fingerprint/stages additively without ownership redesign.

---

## 2. Is every engine independent?

| Meaning | Answer |
|---------|--------|
| Separate module + plugin + pack + Kernel API | **Yes** |
| No peer IR mutation | **Yes** |
| Shared NDG root only | **Yes** |
| Soft optional Layout/Semantic consumption | **Yes** (degrade paths exist) |
| Single automatic pipeline runner | **No** (by design; FR-04 deferred) |

**Answer: Yes for ownership independence.** Product-quality A11y still benefits from SemanticIR, but Accessibility does not require it to publish.

---

## 3. Can ResolvedIR safely begin?

| Gate | Status |
|------|--------|
| Upstream IRs publishable & immutable | ✓ |
| Decision monopoly clear | ✓ |
| Stage `resolved-ir` registered | ✓ |
| Predecessor rule documented | ✓ (`at-least-one-specialized-plus-ndg-context`) |
| Emit still separate | ✓ |
| No circular deps into ResolvedIR | ✓ |

**Answer: Yes — start ResolvedIR design/implementation.**

### Safe ResolvedIR charter (recommended)

1. **Own** commitment envelope linking selected IrSlices + DecisionRecords.  
2. **Do not own** Layout/Semantic/Token heuristics.  
3. **Tolerate missing** `asset-ir` / `behavior-ir` until those engines exist.  
4. **Accept** caller-supplied slice ids; Layout pins are the only first-class active pointers today.  
5. **Remain** exporter-neutral (no HTML/CSS/ARIA strings in ResolvedIR if following prior pattern — Emit owns lowering).

---

## 4. Remaining risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Caller wrong job order / missing Decision waves | Medium | Document recommended order; optional FR-04 later |
| Dual Evidence paths (constraint pack + plugin) | Medium | FR-02 deferred; ResolvedIR should key off IR checksums + Decisions, not Evidence noise |
| `source.node` dual SSOT | Medium | FR-05 deferred; prefer NDG |
| No pins for non-Layout IRs | Low–Medium | Pass explicit `sliceId`s into ResolvedIR; WS-PIN-GEN later |
| Dead asset/behavior predecessors in registry | Low | Treat as optional predecessors |
| Heuristic debt (tokens, landmarks, breakpoints, contrast) | Low for architecture | Pack/Policy/Knowledge evolution |
| Lock Contract header stale vs CURRENT_TRUTH | Low | Doc cleanup; status file wins |

---

## 5. Which RFCs should remain deferred?

### Defer through ResolvedIR *start*

All of: FR-01, FR-02, FR-03, FR-05, FR-06, FR-07, FR-13-02, FR-14-01, FR-14-02, FR-15-01, FR-15-02 (partial), FR-16-01, FR-16-02, WS-PIN-GEN family, product contrast.

### Revisit during ResolvedIR *design* (still not auto-implement)

| Id | Trigger |
|----|---------|
| FR-04 | If multi-slice job orchestration becomes error-prone |
| FR-01 | If ResolvedIR packs need IrSlice reads |
| WS-PIN-GEN | If ResolvedIR needs first-class “active” Component/Semantic/… pointers |
| FR-15-02 | Confirm predecessor rule for absent asset/behavior |

### Do not reopen

| Item |
|------|
| Foundation Freeze ownership |
| ConstraintIR peer engine |
| Decision monopoly |
| Mutating prior IrSlices |

---

## 6. Documentation readiness

| Doc | Ready for ResolvedIR kickoff? |
|-----|-------------------------------|
| `CURRENT_TRUTH.md` | Yes — next authorized = ResolvedIR path |
| `ARCHITECTURE_VALIDATION_REPORT.md` | Yes |
| `IR_CATALOG.md` | Yes |
| `ENGINE_DEPENDENCY_MAP.md` | Yes |
| `RFC_CONSOLIDATION.md` | Yes |
| Master Plan Phase for Resolved/Emit | Use as roadmap; status file wins on conflicts |

---

## 7. Stop line

```text
✓ Foundation validated
✓ All engines validated
✓ IR catalog created
✓ RFCs consolidated
✓ Integration readiness documented
✓ Recommendation: READY FOR RESOLVEDIR

✗ ResolvedIR not started
✗ EmitPlan not started
✗ compile() not started
✗ No code modified in this review
```

---

## Companion documents

1. `docs/ARCHITECTURE_VALIDATION_REPORT.md`  
2. `docs/IR_CATALOG.md`  
3. `docs/ENGINE_DEPENDENCY_MAP.md`  
4. `docs/RFC_CONSOLIDATION.md`  
5. `docs/INTEGRATION_READINESS_REPORT.md` (this file)  
