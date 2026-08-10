# LIVE TESTING GO / NO-GO AUDIT

| Field | Value |
|-------|--------|
| **Date** | 2026-07-18 |
| **Scope** | Production readiness for real Figma URL live testing |
| **Code changed** | **None** |

---

# ❌ LIVE TESTING NOT APPROVED

After reading this report, certainty is:

**You cannot paste a real Figma URL, run the architecture `compile()`, and obtain a browser-ready website from that compiler path.**

The architecture compiler ends at **EmitPlan**. HTML/CSS/JS artifact generation from EmitPlan **does not exist**.

---

## 1. Pipeline existence (stages)

| Stage | Exists? | Connects? | Evidence |
|-------|---------|-----------|----------|
| Raw → NDG | Yes | Yes | `compiler/ndg/`, `job.materializeNormalizedDesignGraph` |
| Layout | Yes | Yes | `job.projectLayoutIR` |
| Constraint | Yes | Yes | `job.solveLayoutConstraints` |
| Component | Yes | Yes | `job.projectComponentIR` |
| Token | Yes | Yes | `job.projectTokenIR` |
| Semantic | Yes | Yes | `job.projectSemanticIR` |
| Responsive | Yes | Yes | `job.projectResponsiveIR` |
| Accessibility | Yes | Yes | `job.projectAccessibilityIR` |
| ResolvedIR | Yes | Yes | `job.projectResolvedIR` |
| EmitPlan | Yes | Yes | `job.projectEmitPlan` |
| **HTML/CSS/JS Artifacts** | **No** | **N/A** | No module; `CURRENT_TRUTH.md` line 33–34, 102 |
| **Browser-ready output** | **No** | **N/A** | `compile()` returns internal objects only |

**Skipped stage (blocking):** Artifact emission after EmitPlan.

---

## 2. HTML / CSS / JS emission — BLOCKER

### Finding

The compiler **does not** produce HTML, CSS, JavaScript, ArtifactSet, ZIP, or an output folder from EmitPlan.

### Code evidence

1. **`compiler/compile.js`** (lines 152–176) returns only:
   - `ok`, `graphId`, `fingerprint`, `steps`, `resolved`, `emitPlan`, `job`, `kernel`
   - No files written; no `fs`, no ZIP, no HTML strings.

2. **`compiler/emit/index.js`**: “Does not emit HTML/CSS/React.”

3. **`compiler/kernel/index.js`**: `invariants.emitsHtml === false`; comment “no HTML emit”.

4. **No consumer** of EmitPlan outside publish/tests:
   - Grep: no `ArtifactSet` materializer under `compiler/`
   - Grep: `server/` does **not** call `compiler/compile` or `projectEmitPlan`

5. **`docs/CURRENT_TRUTH.md`**: “HTML/CSS/JS Artifacts | **Not implemented**”

### Verdict

**BLOCKER (Critical)** — emission stage missing.

---

## 3. `compile()` verification

| Claim | Actual |
|-------|--------|
| Runs Raw → … → EmitPlan | **Yes** (orchestration of Kernel jobs) |
| Generates Artifacts | **No** |
| Returns browser output | **No** — returns IR metadata + job handle |

Evidence: `compiler/compile.js` entire return block (152–176).

---

## 4. EmitPlan consumption

| Question | Answer |
|----------|--------|
| Who consumes EmitPlan? | **Nobody** (only producers + unit tests) |
| What generates HTML? | **Nothing** in architecture compiler |
| What generates CSS? | **Nothing** in architecture compiler |
| What generates JS? | **Nothing** in architecture compiler |

**BLOCKER (Critical)** — plan produced, never lowered.

---

## 5. Product pipeline (Figma URL → website)

### Can this run *via the architecture compiler* today?

**NO.**

### Why (exact)

1. `compile()` requires a **document object**, not a Figma URL (`compiler/compile.js` L33–36).
2. No wire from `server/index.js` `/api/figma/convert` → `compiler/compile`.
3. No EmitPlan → HTML lowering module.

### Note (out of audit path, but factual)

The **legacy product** path `server/figma-build.js` + `/api/figma/convert` can still emit HTML via `figmaBuild.emit(...)`. That path **does not** use NDG → … → EmitPlan → architecture `compile()`. It is **not** validation of the frozen architecture compiler.

This audit’s criterion is the architecture compiler stack. That stack cannot deliver the required live test.

---

## 6. Cache

| Capability | Present? | Evidence |
|------------|----------|----------|
| Incremental compilation | **No** | No compile-cache module |
| IR reuse across jobs | **No** | Each `compile()` creates new Kernel job / Workspace |
| Fingerprint lookup → skip work | **No** | Fingerprint is recorded, not used as cache key for skip |
| Checksum lookup cache | **No** | Checksums for determinism only |
| Slice / graph cache | **No** | Workspace is per-job; no persistent compile store |

**Same Figma URL compiled twice (architecture `compile()`):**

### **A) Everything recompiles**

Evidence: `compile()` always calls materialize/project methods sequentially with no “if fingerprint known, return cached artifacts” branch (`compiler/compile.js` L53–150).

(Workspace put is idempotent for identical slice identity within one job — not cross-run incremental compile.)

---

## 7. Token / Component / Semantic / Responsive / Accessibility → final output

| Engine | Reaches final HTML/CSS/JS? |
|--------|----------------------------|
| TokenIR | **No** — unused for emission (emission absent) |
| ComponentIR | **No** — published only; no expand/emit consumer |
| SemanticIR | **No** — no emission |
| ResponsiveIR | **No** — no CSS generation |
| AccessibilityIR | **No** — no HTML generation |

They participate in IR composition into ResolvedIR → EmitPlan **plan fields**, but **do not affect browser output** because there is no output.

---

## 8. Dead engines (Asset / Behavior)

| Blocks live testing? |
|----------------------|
| **NO** |

ResolvedIR tolerates missing `asset-ir` / `behavior-ir`. They are not the blocker. Emission absence is.

---

## 9. Documentation consistency

| Document | Says | Agrees with code? |
|----------|------|-------------------|
| `CURRENT_TRUTH.md` | Artifacts **Not implemented**; next = Product Validation | **Yes** |
| `COMPILER_PIPELINE.md` | Pipeline ends at EmitPlan | **Yes** |
| `PHASE_17_19_COMPLETION_REPORT.md` | “No HTML generation started” | **Yes** |
| `INTEGRATION_READINESS_REPORT.md` | READY FOR RESOLVEDIR (not live site testing) | **Yes** |
| Phrase “Compiler Complete” | Means IR+plan+orchestrate complete, **not** site emission | Consistent if read with CURRENT_TRUTH snapshot |

**Inconsistency (wording only, Medium):** “Compiler Complete” can be misread as “browser-ready.” `CURRENT_TRUTH` clarifies Artifacts not implemented — no doc false claim that HTML exists.

---

## 10. Tests

| Suite | Validates |
|-------|-----------|
| `test:compile` / `test:emit` / `test:resolved` | IR composition + plan + orchestration |
| Engine suites | Domain IR correctness |
| Contracts harness | Schemas/fixtures |

**Do not** validate HTML/CSS/JS output or Figma URL → browser. Tests intentionally assert **no** HTML/CSS in IR payloads.

---

## BLOCKERS (ranked)

### Critical

| # | Blocker | Reason | Impact | Module / File | Suggested fix | Effort |
|---|---------|--------|--------|---------------|---------------|--------|
| C1 | No HTML/CSS/JS artifact emitter | EmitPlan never lowered | Cannot open a site from architecture compile | Missing `compiler/` emit-lowering (or equivalent); `compiler/compile.js` stops at L150 | Implement ArtifactSet emitter consuming EmitPlan + ResolvedIR + Decisions; extend `compile()` to write output | L–XL |
| C2 | EmitPlan has zero consumers | Produced and stored only | Engines never reach UI | No file; consumers absent | Same as C1 — first consumer of EmitPlan | L–XL |
| C3 | `compile()` returns IR objects only | No artifact generation step | Product cannot “press Compile” on this API for a website | `compiler/compile.js` L152–176 | Return/write ArtifactSet + output path after emission | M (after C1) |

### High

| # | Blocker | Reason | Impact | Module / File | Suggested fix | Effort |
|---|---------|--------|--------|---------------|---------------|--------|
| H1 | No Figma URL → architecture `compile()` bridge | `compile()` needs `document`; server uses `figmaBuild.emit` | Live Figma test won’t exercise architecture compiler | `server/index.js` vs `compiler/compile.js` | Ingest Figma → RawDesignDocument → `compile()` → emit | M–L |
| H2 | Token/Component/Semantic/Responsive/A11y unused in output | No emission | “Core engines participate in website” fails | Domain IRs live; lowering missing | Implemented by C1 consuming those slices | included in C1 |

### Medium

| # | Blocker | Reason | Impact | Module / File | Suggested fix | Effort |
|---|---------|--------|--------|---------------|---------------|--------|
| M1 | No incremental/compile cache | Every run full recompute | Slow live loops; not a functional site blocker | `compiler/compile.js` | Optional cache keyed by fingerprint | M |
| M2 | “Compiler Complete” ambiguity | Status string vs product expectation | False confidence for live testing | `docs/CURRENT_TRUTH.md` | Clarify “IR complete; emission pending” in status line | S |

### Low

| # | Blocker | Reason | Impact | Module / File | Suggested fix | Effort |
|---|---------|--------|--------|---------------|---------------|--------|
| L1 | Asset/Behavior engines absent | Placeholders only | Does not block basic live site if emission exists | registries only | Later phases | — |

---

## FINAL DECISION

# ❌ LIVE TESTING NOT APPROVED

**Do not begin real Figma URL live testing against the architecture compiler tomorrow expecting a browser-ready website.**

Minimum unlock: implement **EmitPlan → ArtifactSet (HTML/CSS/JS)** and wire it through `compile()`, then bridge Figma ingest (High).

No code was implemented in this audit.
