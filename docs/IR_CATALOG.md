# IR_CATALOG.md

| Field | Value |
|-------|--------|
| **Document** | Complete IR inventory (implemented + registered) |
| **Date** | 2026-07-18 |
| **Authority** | Contracts registries + engine modules; status via `CURRENT_TRUTH.md` |

---

## Implemented specialized / structural IRs

### NDG (NormalizedDesignGraph)

| Field | Value |
|-------|--------|
| **IR Name** | NormalizedDesignGraph |
| **Stage id** | `normalized-design-graph` |
| **Owner** | NDG Engine (`compiler/ndg/`) |
| **Produced By** | `facts.ndg.materialize` / `job.materializeNormalizedDesignGraph` |
| **Consumed By** | Layout, Constraint, Component, Token, Semantic, Responsive, Accessibility; Features/Recognition packs |
| **Mutable / Immutable** | **Immutable** after publish |
| **Workspace Published** | Yes (Fact `ndg.graph` + IrSlice) |
| **Fingerprint Fields** | `ndgChecksum`, `ndgBuilderVersion`, `ndgGraphId` |
| **Current Status** | **Live** |

---

### LayoutIR₀

| Field | Value |
|-------|--------|
| **IR Name** | LayoutIR₀ (arrangement) |
| **Stage id** | `layout-ir` |
| **Owner** | Layout Engine (`compiler/layout/`) |
| **Produced By** | `facts.layout.project` / `job.projectLayoutIR` |
| **Consumed By** | Constraint solver; Component / Semantic / Responsive (optional); Accessibility (optional) |
| **Mutable / Immutable** | **Immutable**; never mutated to become IR₁ |
| **Workspace Published** | Yes + **baseline LayoutIR pin** |
| **Fingerprint Fields** | `layoutIrChecksum`, `layoutBuilderVersion`, `layoutSliceId`, `baselineLayoutIrSliceId`, `activeLayoutIrSliceId` |
| **Current Status** | **Live** |

---

### LayoutIR₁

| Field | Value |
|-------|--------|
| **IR Name** | LayoutIR₁ (constraint-solved) |
| **Stage id** | `layout-ir` (same stage; new slice + solve payload) |
| **Owner** | Layout constraint subsystem (`compiler/layout/constraint/`) |
| **Produced By** | `facts.layout.constraint` / `job.solveLayoutConstraints` |
| **Consumed By** | Downstream engines preferring active pin; future ResolvedIR |
| **Mutable / Immutable** | **Immutable** new slice; IR₀ retained |
| **Workspace Published** | Yes + **active pin** (baseline retained) |
| **Fingerprint Fields** | `solvedLayoutIrChecksum`, `solvedLayoutSliceId`, `constraintSolverVersion`, `solverFingerprint`, `activeLayoutIrSliceId` |
| **Current Status** | **Live** (no separate ConstraintIR) |

---

### ComponentIR

| Field | Value |
|-------|--------|
| **IR Name** | ComponentIR |
| **Stage id** | `component-ir` |
| **Owner** | Component Engine |
| **Produced By** | `facts.component.project` / `job.projectComponentIR` |
| **Consumed By** | Future ResolvedIR / Emit (not yet) |
| **Mutable / Immutable** | **Immutable** |
| **Workspace Published** | Yes |
| **Fingerprint Fields** | `componentIrChecksum`, `componentBuilderVersion`, `componentSliceId` |
| **Current Status** | **Live** |

---

### TokenIR

| Field | Value |
|-------|--------|
| **IR Name** | TokenIR |
| **Stage id** | `token-ir` |
| **Owner** | Token Engine |
| **Produced By** | `facts.token.project` / `job.projectTokenIR` |
| **Consumed By** | Future ResolvedIR / Emit |
| **Mutable / Immutable** | **Immutable** |
| **Workspace Published** | Yes |
| **Fingerprint Fields** | `tokenIrChecksum`, `tokenBuilderVersion`, `tokenSliceId` |
| **Current Status** | **Live** |

---

### SemanticIR

| Field | Value |
|-------|--------|
| **IR Name** | SemanticIR |
| **Stage id** | `semantic-ir` |
| **Owner** | Semantic Engine |
| **Produced By** | `facts.semantic.project` / `job.projectSemanticIR` |
| **Consumed By** | Accessibility (read-only Evidence); future ResolvedIR / Emit |
| **Mutable / Immutable** | **Immutable** |
| **Workspace Published** | Yes |
| **Fingerprint Fields** | `semanticIrChecksum`, `semanticBuilderVersion`, `semanticSliceId` |
| **Current Status** | **Live** |

---

### ResponsiveIR

| Field | Value |
|-------|--------|
| **IR Name** | ResponsiveIR |
| **Stage id** | `responsive-ir` |
| **Owner** | Responsive Engine |
| **Produced By** | `facts.responsive.project` / `job.projectResponsiveIR` |
| **Consumed By** | Future ResolvedIR / Emit |
| **Mutable / Immutable** | **Immutable** |
| **Workspace Published** | Yes |
| **Fingerprint Fields** | `responsiveIrChecksum`, `responsiveBuilderVersion`, `responsiveSliceId` |
| **Current Status** | **Live** |

---

### AccessibilityIR

| Field | Value |
|-------|--------|
| **IR Name** | AccessibilityIR |
| **Stage id** | `a11y-ir` |
| **Owner** | Accessibility Engine |
| **Produced By** | `facts.accessibility.project` / `job.projectAccessibilityIR` |
| **Consumed By** | Future ResolvedIR / Emit |
| **Mutable / Immutable** | **Immutable** |
| **Workspace Published** | Yes |
| **Fingerprint Fields** | `accessibilityIrChecksum`, `accessibilityBuilderVersion`, `accessibilitySliceId` |
| **Current Status** | **Live** |

---

## Registered but not implemented (placeholders)

| IR / Stage | Owner (intended) | Status |
|------------|------------------|--------|
| AssetIR (`asset-ir`) | Future Asset Engine | **Registered only** |
| BehaviorIR (`behavior-ir`) | Future Behavior Engine | **Registered only** |
| ResolvedIR (`resolved-ir`) | Future Resolved phase | **Contract + fixture only** |
| EmitPlan (`emit-plan`) | Future Emit | **Contract + fixture only** |
| ArtifactSet (`artifact-set`) | Future Emit | **Contract + fixture only** |
| RawDesignDocument | Input | **Contract**; ingest path live via NDG |

---

## Envelope note

All specialized live IRs publish under `SpecializedIrEnvelope` with stage-specific `stageId` and opaque domain `payload`. Domain field catalogs remain deferred (by design).

---

## Pin inventory

| Pin | Exists | Scope |
|-----|--------|-------|
| LayoutIR baseline / active | **Yes** | Workspace LayoutIR pin API |
| Component / Token / Semantic / Responsive / A11y | **No** | Fingerprint `*SliceId` only |

See RFC consolidation FR-13-01 / FR-14-03 / FR-15-03 / FR-16-03.
