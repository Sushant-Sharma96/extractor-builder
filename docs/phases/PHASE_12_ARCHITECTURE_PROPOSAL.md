# Phase 12 Architecture Proposal — Component Engine

| Field | Value |
|-------|--------|
| **Phase** | 12 — Component Engine |
| **Date** | 2026-07-18 |
| **Status** | **Implemented** — see `PHASE_12_COMPLETION_REPORT.md` |
| **Foundation** | Foundation Freeze v1 — **locked**; do not reopen |
| **Pattern** | Sibling module + Facts plugin + Rule Pack + Kernel verb |
| **Lifecycle** | Canonical engine lifecycle (below) — required for Phase 12+ engines |

---

## Executive Summary

**Component Engine** extracts **instance / master / variant / override** structure from NDG (and optional LayoutIR₁ context), publishes **ComponentIR**, and proposes Hypotheses where treatment is interpretive.

It is **not** a design-system package exporter, not Semantic, not HTML/React codegen.

Reuse: Phase 6 plugins, Workspace, Decision Runtime, Knowledge (priors only), fingerprints, existing `component-ir` stage.

---

## Canonical engine lifecycle

Every specialized domain engine (Phase 12+) follows this sequence. Stages are **functions/modules**, not new Kernel frameworks or IR stages.

```text
collect → detect → project → publish → materialize
```

| Stage | Responsibility | Component Engine |
|-------|----------------|------------------|
| **collect** | Read frozen inputs (NDG, pins, Decisions, Policy); never mutate | Load NDG; optional active LayoutIR₁; Decisions/Evidence maps |
| **detect** | Pure domain signals → Evidence-shaped observations / candidates | Definitions, instances, variants, overrides, orphans |
| **project** | Build immutable IR payload (+ checksum) in memory | ComponentIR payload |
| **publish** | Write IrSlice + Facts via Facts plugin capabilities | `facts.component.project` |
| **materialize** | Orchestrate collect→…→publish for Kernel/job | `materializeComponentIR` / `job.projectComponentIR()` |

**Intentionally not separate stages**

| Omitted as engine stage | Why |
|-------------------------|-----|
| Rank / arbitrate / commit | **Decision Runtime** owns these (Foundation Freeze) |
| Constraint solve | **Layout** subsystem only |
| Emit / HTML | Later lowering phases |

**Rule Packs** attach at **detect** (propose Evidence/Hypotheses). They do not replace **project/publish**.

This lifecycle is the **canonical pattern** for Token, Semantic, Responsive, and later engines.

---

## Compiler Contract (Component Engine)

Artifacts **produced or proposed** by this engine. Ownership of commit / NDG / Layout unchanged.

| Contract kind | Ids / kinds | Produced by | Notes |
|---------------|-------------|-------------|--------|
| **Decision Questions** | `component.instanceTreatment`, `component.reuse`, `component.variant` (optional) | Proposed by Rule Pack; **committed by Decision Runtime** | MINOR registry adds at implement |
| **Evidence Types** (refs) | `component.signal`, `component.instance`, `component.override`, `component.orphan`, `component.degraded` | Pack / detect | `kind: feature\|other` |
| **Hypothesis Types** | Same questions as above; candidates e.g. keep / flatten / abstain | Rule Pack `component.detect` | Never Decisions |
| **Fact Types** | `component.ir` (slice pointer + report); optional `component.def` / `component.instance` node Facts if useful | Facts plugin | Do not mutate NDG Facts |
| **IR Types** | IrSlice `stageId: component-ir` (ComponentIR) | Facts plugin publish | Already in IR registry |

**Not produced:** LayoutIR, NDG, ConstraintNetwork, ResolvedIR, EmitPlan, HTML/CSS.

---

## 1. What is a Component?

In this compiler, a **Component** is a **reuse unit** observed in the design graph:

| Concept | Meaning |
|---------|---------|
| **Definition** | Master / main component node (or synthetic definition id) |
| **Instance** | Node that references a definition |
| **Variant** | Named property set on a definition (when present in NDG attrs) |
| **Override** | Instance-local deviation from the definition |

Component ≠ Semantic pattern (Hero/Navbar). Component ≠ Layout mode. Component ≠ Token.

---

## 2. What it owns

| Owns | Notes |
|------|--------|
| Component Facts (`component.def`, `component.instance`, …) | From NDG attributes / edges |
| ComponentIR projection | Immutable IrSlice `component-ir` |
| Evidence of instance links / overrides | Traceable |
| Hypotheses for interpretive treatment | e.g. flatten vs keep instance |
| Optional emit-reuse **Candidates** | Hints only — never forced emit |

---

## 3. What it must NEVER own

| Never | Owner |
|-------|--------|
| NDG hierarchy mutation / flatten without Decision+trace | NDG + Decision |
| Layout modes / constraints | Layout |
| html.tag / landmarks / Hero | Semantic (14) |
| Breakpoints | Responsive (15) |
| Token binding | Token (13) |
| Decision commit | Decision Runtime |
| HTML / CSS / React / EmitPlan | Lowering (19+) |
| New plugin framework / ConstraintIR-style peer IR | Forbidden |

---

## 4. Inputs

| Input | Required? | Role |
|-------|-----------|------|
| **NDG** | **Yes** | Structural SSOT; component attrs (`componentId`, `mainComponent`, variants, …) |
| **Active LayoutIR** (prefer LayoutIR₁) | Recommended | Composition context; Evidence only |
| Committed Decisions | When present | Prior winners |
| Policy | Yes | pixel-faithful → prefer keep instances; budgets |
| Knowledge | Optional | Priors for common component motifs |
| Features / Recognition | Optional | Evidence only — never structural authority |

---

## 5. Outputs

| Output | Kind | Writer |
|--------|------|--------|
| Component Evidence | Evidence | Pack / facts path |
| Component Hypotheses | Hypothesis | Rule Pack |
| Decisions | DecisionRecord | **Decision Runtime only** |
| **ComponentIR** | IrSlice `component-ir` | Facts plugin |
| Report | Diagnostic in Fact assertion | Facts plugin |

No HTML/CSS.

---

## 6. ComponentIR?

**Yes** — already registered (`component-ir`). Use `SpecializedIrEnvelope`.

Payload (exporter-neutral, minimal):

```text
ComponentIR.payload {
  graphId
  builderVersion
  definitions: [{ defId, sourceNodeId, name?, variantAxes? }]
  instances: [{ nodeId, defId, variant?, overrideKeys?, decisionIds?, evidenceIds? }]
  orphans: [{ nodeId, reason }]      // suspected instance without resolvable def
  flattenPlan: []                    // only after Decision; else empty
}
```

Immutable per slice. Re-project on change; do not mutate.

---

## 7. Relationship with NDG

- **Read-only.**  
- Component links come from NDG Facts/attrs — never invent a second hierarchy.  
- Flattening that changes effective tree for emit is a **Decision**, recorded; NDG itself stays unchanged.

---

## 8. Relationship with LayoutIR₁

- **Consumer, not owner.**  
- Prefer Workspace **active LayoutIR pin**.  
- Use layout modes only as Evidence (e.g. instance root is `flow-row`).  
- Must not write LayoutIR or run Constraint.

---

## 9. Relationship with Decision Runtime

| Concern | Owner |
|---------|--------|
| Detect ambiguous instance / false reuse | Component proposers |
| Rank / abstain / commit | **Decision Runtime** |
| Suggested questions (MINOR registry adds) | `component.instanceTreatment`, `component.reuse`, optionally `component.variant` |

Hard rule: no private flatten without Decision + Trace.

---

## 10. Relationship with Knowledge

- Optional priors (common button/card component shapes) as Evidence weight hints.  
- No Knowledge mutation.  
- No embedding React/Vue recipes in ontology.

---

## 11. Relationship with Semantic Engine

- ComponentIR is **input/evidence** for Semantic (reuse boundaries).  
- Semantic owns roles/landmarks/`html.tag`.  
- Component must not answer `semantic.*` questions.

---

## 12. Relationship with Responsive Engine

- Responsive may later respect component boundaries.  
- Phase 12 does **not** own breakpoints or responsive strategy.

---

## 13. Rule Packs

| Pack | Role |
|------|------|
| `component.detect` (proposers) | Evidence + Hypotheses from NDG (+ optional Layout) |

Writes: Evidence, Hypothesis only. Same Phase 8 rules.

---

## 14. Facts Plugin

| Plugin | Role |
|--------|------|
| `facts.component.project` | Publish ComponentIR IrSlice + Fact `component.ir` |

Reads: Fact, IrSlice, Decision, Evidence.  
Writes: Fact, IrSlice.  
Mirror Layout project pattern.

---

## 15. Pipeline placement

```text
NDG → (Features/Recognition) → Layout → Constraint → LayoutIR₁
    → Component Engine → ComponentIR
    → (Token) → Semantic → …
```

- **Requires NDG.**  
- **Should follow LayoutIR₁** when available (Master Plan: layout-aware composition).  
- May run after LayoutIR₀ if policy allows degraded mode (mark Evidence `degraded: true`).  
- Kernel: `job.projectComponentIR()` (same style as `projectLayoutIR`).

---

## 16. Fingerprint additions

Additive named fields (schema sync required at implement time):

| Field | Meaning |
|-------|---------|
| `componentIrChecksum` | ComponentIR checksum |
| `componentBuilderVersion` | Builder version |
| `componentSliceId` | Slice id |

No hidden fields.

---

## 17. Tests (`test:component` / `test:phase12`)

- Definition + instance detection from NDG  
- Variant / override Facts  
- Orphan instance reporting  
- Decision integration (keep vs flatten)  
- No NDG mutation  
- ComponentIR immutability / idempotent rebuild  
- Fingerprint fields  
- Policy behaviour (pixel-faithful keep instances)  
- Regression: layout/constraint suites still green  

---

## 18. Risks

| Risk | Mitigation |
|------|------------|
| Over-flattening | Default keep instance; flatten only via Decision |
| False reuse | Evidence + abstain; pixel-faithful conservative |
| Treating Recognition as Component | Explicit: recognition ≠ component |
| Nesting under `layout/` | **Forbidden** — sibling `compiler/components/` |
| Emitting React | Out of scope |

---

## Module sketch (implementation later)

```text
compiler/components/
  constants.js, collect.js, detect.js, project.js,
  publish.js, materialize.js, declaration.js, report.js, index.js
compiler/rulepack/packs/component-detect/
```

---

# Fast Architecture Review

| Check | Result |
|-------|--------|
| ✓ Fits Foundation Freeze v1 | Yes — sibling engine, existing plugin/pack/Workspace/Decision |
| ✓ Ownership clean | Yes — Component ≠ Layout ≠ Semantic ≠ NDG |
| ✓ No invariant broken | Yes — no Decision steal, no NDG mutate, no new framework |
| ✓ No redesign required | Yes — mirrors Layout/NDG pattern |
| ✓ Risks | Over-flatten / false reuse — mitigated by Decision + policy |
| ✓ Recommendations | (1) Prefer LayoutIR₁ via active pin (2) MINOR question ids under `component.*` (3) Fingerprint schema sync at implement (4) Do not start Token/Semantic in Phase 12 |

**Foundation-breaking issue?** **None.** Proceed to execution plan.

---

## Go for implementation planning

**YES** — Phase 12 execution plan authorized; foundation remains locked.
