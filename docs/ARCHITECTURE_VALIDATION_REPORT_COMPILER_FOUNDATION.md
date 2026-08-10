# ARCHITECTURE_VALIDATION_REPORT.md

| Field | Value |
|-------|--------|
| **Document** | Architecture Validation & Integration Readiness Review |
| **Date** | 2026-07-18 |
| **Scope** | Foundation Freeze v1 + Engines through Phase 16 |
| **Code changes** | **None** (audit only) |
| **Authority** | `CURRENT_TRUTH.md` for status; RFC-002 for reasoning |

---

## Verdict (summary)

| Question | Answer |
|----------|--------|
| Is Foundation complete? | **Yes** (Freeze v1 held; engines through A11y delivered) |
| Ownership intact? | **Yes** |
| Circular dependencies? | **None found** |
| Fingerprint synchronized? | **Yes** (39 named fields; harness green) |
| Ready for ResolvedIR? | **READY FOR RESOLVEDIR** (with conditions below) |

Companion docs: `IR_CATALOG.md`, `ENGINE_DEPENDENCY_MAP.md`, `RFC_CONSOLIDATION.md`, `INTEGRATION_READINESS_REPORT.md`.

---

## 1. Engine validation matrix

| Engine | Owner module | Kernel API | Facts plugin | Rule pack | Produced IR | Inputs | Consumed IRs (optional) | Decision questions | Fingerprint | Publish path |
|--------|--------------|------------|--------------|-----------|-------------|--------|-------------------------|--------------------|-------------|--------------|
| **NDG** | `compiler/ndg/` | `materializeNormalizedDesignGraph` | `facts.ndg.materialize` | (none domain) | NormalizedDesignGraph | Raw / `source.node` | — | — | `ndgChecksum`, `ndgBuilderVersion`, `ndgGraphId` | Fact + IrSlice |
| **Layout** | `compiler/layout/` | `projectLayoutIR` | `facts.layout.project` | `layout.interpret` | LayoutIR₀ | NDG | — | `layout.mode`, sizing, overflow, stacking, childParticipation | `layoutIrChecksum`, `layoutBuilderVersion`, `layoutSliceId`, pins | Fact + IrSlice + pin |
| **Constraint** | `compiler/layout/constraint/` | `solveLayoutConstraints` | `facts.layout.constraint` | `layout.constraint` | LayoutIR₁ (new slice) | LayoutIR₀ + NDG | LayoutIR₀ | `layout.constraint.relax` | `solvedLayoutIrChecksum`, `solvedLayoutSliceId`, `constraintSolverVersion`, `solverFingerprint`, active pin | Fact + IrSlice + pin update |
| **Component** | `compiler/components/` | `projectComponentIR` | `facts.component.project` | `component.detect` | ComponentIR | NDG | Layout (prefer) | `component.instanceTreatment`, `.reuse`, `.variant` | `componentIrChecksum`, `componentBuilderVersion`, `componentSliceId` | Fact + IrSlice |
| **Token** | `compiler/tokens/` | `projectTokenIR` | `facts.token.project` | `token.detect` | TokenIR | NDG | — | `token.bind`, `token.merge` | `tokenIrChecksum`, `tokenBuilderVersion`, `tokenSliceId` | Fact + IrSlice |
| **Semantic** | `compiler/semantic/` | `projectSemanticIR` | `facts.semantic.project` | `semantic.detect` | SemanticIR | NDG | Layout (prefer) | `semantic.role`, `semantic.region` | `semanticIrChecksum`, `semanticBuilderVersion`, `semanticSliceId` | Fact + IrSlice |
| **Responsive** | `compiler/responsive/` | `projectResponsiveIR` | `facts.responsive.project` | `responsive.detect` | ResponsiveIR | NDG | Layout (prefer) | `responsive.strategy`, `responsive.breakpoint` | `responsiveIrChecksum`, `responsiveBuilderVersion`, `responsiveSliceId` | Fact + IrSlice |
| **Accessibility** | `compiler/accessibility/` | `projectAccessibilityIR` | `facts.accessibility.project` | `accessibility.detect` | AccessibilityIR | NDG | Semantic (Evidence), Layout | `a11y.name`, `a11y.role` | `accessibilityIrChecksum`, `accessibilityBuilderVersion`, `accessibilitySliceId` | Fact + IrSlice |

### Per-engine checks

| Check | NDG | Layout | Constraint | Component | Token | Semantic | Responsive | A11y |
|-------|-----|--------|------------|-----------|-------|----------|------------|------|
| Ownership clear | ✓ | ✓ | ✓ (subsystem of Layout) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Lifecycle collect→…→materialize | ✓ | ✓ | ✓ (solve path) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Pack proposes only | n/a | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Never Decision commit | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Immutable published slice | ✓ | ✓ | ✓ (new IR₁) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Exporter-neutral | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Does not mutate NDG | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Does not mutate peer IRs | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (Semantic read-only) |

---

## 2. Pipeline validation

```text
Raw → NDG → LayoutIR₀ → LayoutIR₁ → ComponentIR → TokenIR
    → SemanticIR → ResponsiveIR → AccessibilityIR
    → ResolvedIR (future) → EmitPlan (future) → Artifacts
```

Optional evidence packs (Features / Recognition / interpret packs) may run between NDG and domain project steps; they do not own structure.

| Concern | Result |
|---------|--------|
| Circular dependency | **None** — DAG: NDG → specialized; A11y → Semantic (read); Constraint → Layout₀ only |
| Ownership violation | **None** found in module boundaries |
| Duplicated responsibility | **Minor residual** — FR-02 dual constraint propose paths; FR-05 `source.node` transitional dual (tracked) |
| Engine bypass | **Possible by caller** — Kernel is caller-ordered (no `compile()`); FR-04 |
| Hidden coupling | **Low** — shared `layout/collect` helpers; A11y reads Semantic checksum only |

---

## 3. Registry validation (summary)

See also `IR_CATALOG.md`.

| Registry | Status |
|----------|--------|
| IR stages | 13 stages; predecessors consistent (harness OK) |
| Specialized envelope enum | Matches live specialized stages including `responsive-ir`, `a11y-ir` |
| Question ids | 22 questions; engine-used set complete |
| Facts plugins | One per engine (+ constraint); unique ids |
| Rule packs | 10 packs; unique `packId`s |

| Finding | Kind |
|---------|------|
| `asset-ir`, `behavior-ir` registered, **no engine** | Dead registration (intentional placeholders) |
| `html.tag`, `asset.degrade`, `behavior.authorize_js` | Dead questions until Emit / Behavior |
| Lock Contract text still says “no Phase 12” in header | Doc lag vs `CURRENT_TRUTH` (status wins) |

---

## 4. Fingerprint validation

| IR family | Checksum | BuilderVersion | SliceId | Schema | Fixture | Tests |
|-----------|----------|----------------|---------|--------|---------|-------|
| NDG | ✓ | ✓ | via graphId | ✓ | ✓ | ✓ |
| Layout₀ | ✓ | ✓ | ✓ + pins | ✓ | ✓ | ✓ |
| Layout₁ | ✓ | solver version | ✓ | ✓ | ✓ | ✓ |
| Component | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Token | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Semantic | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Responsive | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Accessibility | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Harness: `fingerprint.schema-sync — 39 named fields`, `fingerprint.live-validate` green. No hidden fields (`assertNoHiddenFingerprintFields`).

---

## 5. Documentation audit

| Document | Role | Consistency |
|----------|------|-------------|
| `CURRENT_TRUTH.md` | **Authoritative status** | Matches Phase 16 complete; next = ResolvedIR path |
| `ARCHITECTURE_LOCK_CONTRACT.md` | Freeze constitution | Invariants hold; **header scope text stale** (still “through 11b”) |
| Master Plan | Roadmap | Ahead of status in places; status wins |
| Phase completion / migration notes | Delivery proof | Present for 11b–16 |
| This validation set | Pre-ResolvedIR gate | New |

**CURRENT_TRUTH was not modified** — no inconsistency requiring a status edit was found.

---

## 6. Explicit recommendation

### **READY FOR RESOLVEDIR**

Conditions (not blockers for starting design/implementation of ResolvedIR):

1. ResolvedIR must **compose** published IrSlices + Decisions — not re-own Layout/Semantic/etc.  
2. Prefer explicit input slice ids / pins; only Layout has Workspace pins today.  
3. Keep FR-01…FR-07 and pin-generalization RFCs **deferred** unless ResolvedIR design requires them.  
4. Do **not** start EmitPlan / `compile()` in the same phase without a separate gate.  
5. Ignore dead `asset-ir` / `behavior-ir` until those engines exist (or document ResolvedIR predecessor rule as “present slices only”).

---

## 7. What this review did not do

- No code changes  
- No redesign  
- No ownership changes  
- No ResolvedIR implementation  
- No CURRENT_TRUTH rewrite  
