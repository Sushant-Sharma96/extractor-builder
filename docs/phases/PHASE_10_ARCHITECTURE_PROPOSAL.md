# Phase 10 Architecture Proposal

| Field | Value |
|-------|--------|
| **Document type** | Architecture review / proposal only |
| **Date** | 2026-07-18 |
| **Status** | **Authorized & implemented** — see `PHASE_10_COMPLETION_REPORT.md` |
| **Code / phases created** | **None** |
| **Authority consulted** | RFC-001 (`COMPILER_ARCHITECTURE_AUDIT`), RFC-002 (`COMPILER_DECISION_SYSTEM`), `IMPLEMENTATION_MASTER_PLAN`, `PLUGIN_CAPABILITY_CONTRACT`, `KNOWLEDGE_BUNDLE_ARCHITECTURE`, `ARCHITECTURE_FREEZE_AUDIT`, Phases 1–9 plans/reports, `NormalizedDesignGraph` contract |
| **Role** | Lead compiler architect review |

---

## Executive Verdict

**Do not implement Master Plan “Phase 10 — Normalization Engine” as a narrow rename of Phase 9 helpers.**

Phase 9 did **not** deliver normalization in the compiler sense. It delivered deterministic **per-node feature bags** and **low-level recognition Candidates** on an ad-hoc `source.node` Fact convention.

The most scalable next phase is:

> **Phase 10 — Canonical Design Graph Materialization**  
> (contract identity: **`NormalizedDesignGraph`** → Workspace Facts)

This is the missing **structural Single Source of Truth** for all later engines. Without it, Layout, Tokens, Components, Semantic packs, Responsive, Animation, and multiple exporters will each reinvent identity, visibility, hierarchy, and provenance — the classic compiler failure mode.

**Roadmap stance:** Keep the *intent* of Master Plan Phase 10. **Rename, sharpen ownership, and reorder mental model.** Treat Phase 9 recognition as *consumers* of the graph (re-home later), not as a substitute for it.

---

# 1. Current Architecture Review

## 1.1 What is solid (do not redesign)

| Layer | Status | Role |
|-------|--------|------|
| Contracts & IR spine | Done | Multi-stage IR vocabulary exists (`NormalizedDesignGraph`, specialized envelopes, `ResolvedIR`, `EmitPlan`) |
| Kernel | Done | Lifecycle, fingerprint, composition root |
| Workspace | Done | Passive blackboard (Facts / Hypotheses / Decisions / Evidence / Traces) |
| Decision Runtime | Done | Sole rank / arbitrate / commit |
| Policy | Done | Thresholds, gates, `pattern_name_cap` |
| Plugins | Done | Capability-scoped proposers |
| Knowledge | Done | Immutable ontology |
| Rule Packs | Done | Candidate generators only |
| Feature extract + low-level recognition | Done | Evidence + Hypotheses; no commits |

Ownership freeze from Phases 1–8 remains sound. Decision monopoly and Knowledge immutability must not be reopened.

## 1.2 What exists today in the data plane

```text
RawDesignDocument          ← contract exists; production ingress not unified in compiler/
     │
     ▼ (today: informal)
Fact kind: source.node     ← Phase 9 convention (not NDG)
     │
     ▼
features.normalize/extract ← bag helpers (NOT graph construction)
     │
     ▼
Evidence + recognition.* Hypotheses
     │
     ▼
Workspace (passive)
     │
     ✗ no NormalizedDesignGraph Facts as job SSOT
     ✗ no LayoutIR / SemanticIR / ResolvedIR production
     ✗ no EmitPlan / HTML
```

## 1.3 Critical distinction (naming collision)

| Term in codebase/docs | What it actually is | What it is not |
|-----------------------|---------------------|----------------|
| `compiler/features/normalize.js` | Field-alias cleanup for one node assertion | Graph construction, ID stability, visibility policy, edge materialization |
| Master Plan “Normalization Engine” | Intended producer of **NormalizedDesignGraph Facts** | Feature extraction |
| Phase 9 “Feature Extraction” | Deterministic signals for Evidence | Canonical compile graph |
| Phase 9 “Recognition” | Probabilistic block-like Candidates | Semantic Engine / HTML tags |

**Conclusion:** Phase 9 covered *feature normalization of bags*, not *design-graph normalization*.

## 1.4 Contract already answers “what graph?”

`NormalizedDesignGraph` (Phase 1) already defines:

- Stable `nodes[]` with `id`, `sourceNodeId`, `visible`, `box`, paints/geometry/attributes as **data**
- `edges[]` with `parent` / `order` / `other`
- Explicit non-goal: **not** semantic conclusions

The architecture does **not** need a second parallel graph contract named “CanonicalDesignGraph” in schemas. It needs a phase that **materializes** the existing contract as the job’s structural Facts — preferably under a clearer *phase* name to avoid colliding with Phase 9’s `normalize`.

---

# 2. Problems with the Current Roadmap

## 2.1 Phase ordering inversion

RFC-001 ideal order:

```text
Ingress → Normalization → Graph → Enrichment (Layout/Token/…) → Semantic → Lowering → Emit
```

Master Plan executed:

```text
… → Rule Packs → Feature/Recognition (Phase 9) → Normalization (Phase 10) → Layout …
```

**Problem:** Recognition currently consumes loose node Facts. When NDG arrives, packs either:

1. Keep dual inputs (raw + NDG) — duplicated paths, fingerprint drift, bugs; or  
2. Must be re-homed onto NDG — rework that should have been anticipated.

This is recoverable, but the roadmap should admit the inversion and treat Phase 10 as **substrate repair**, not “continue recognition.”

## 2.2 Duplicated / overlapping responsibilities (latent)

| Overlap risk | Why |
|--------------|-----|
| Phase 9 feature bags vs NDG `geometry`/`attributes` | Same physical properties stored twice with different identities |
| Recognition “stack/grid” vs Layout Engine questions | Structural cues vs layout *interpretation* — must stay separated, but share one graph |
| “Normalization” name vs features.normalize | Docs and onboarding will keep confusing implementers |
| Component Engine graph vs NDG hierarchy | Component edges must be *derived from* NDG identity space, not a second ID system |

## 2.3 Unnecessary / misnamed phases

| Roadmap item | Assessment |
|--------------|------------|
| Standalone “Normalization Engine” *name* | **Misnamed** relative to Phase 9; keep work, change title/ownership framing |
| Separate “Graph Builder” *after* Normalization | **Usually unnecessary** — NDG materialization *is* the graph builder |
| Jumping to Layout (11) before graph | **Premature** — Layout without stable ids/visibility/order is heuristic soup |
| Feeding Features → HTML | **Architecturally wrong** — skips Decisions, ResolvedIR, multi-exporter |

## 2.4 Missing compiler stage (the real gap)

Between ingress and all intelligence:

**Missing:** one **job-scoped, immutable, provenance-linked structural graph** that every engine is required to read.

Without it, the compiler has a constitution (1–8) and sensors (9), but no **AST**.

## 2.5 Scalability risks if Phase 10 is skipped or diluted

- Layout, Responsive, Animation each invent local trees  
- Exporters (HTML, React, Flutter, email) diverge on identity  
- Golden corpora cannot pin structural equivalence  
- Partition/scale (Master Plan Phase 28) has nothing stable to cut  
- “Deterministic compilation” fails when visibility/wrapper collapse differs per engine  

---

# 3. Alternative Designs

### Alternative A — Master Plan as written (“Normalization Engine”)

Implement visibility pruning, empty wrappers, stable ids, geometry Facts → NDG.

- **Pros:** Aligns with contracts; unblocks 11–13.  
- **Cons:** Name collides with Phase 9; easy to under-scope into “just copy features into Facts.”

### Alternative B — Skip Phase 10; Layout next

- **Pros:** Faster path to visible layout work.  
- **Cons:** Layout becomes the de facto graph; ownership collapses; emit couples early. **Reject.**

### Alternative C — Features → HTML (direct)

- **Pros:** Demo velocity.  
- **Cons:** Destroys Decision protocol, multi-hypothesis, multi-exporter, confidence, provenance. **Reject.**

### Alternative D — New “Canonical Design Graph” contract *instead of* NDG

- **Pros:** Cleaner marketing name.  
- **Cons:** Schema duplication vs Phase 1 `NormalizedDesignGraph`; suite churn without semantic gain. **Reject as new contract.** Accept “Canonical” as *phase* language only.

### Alternative E — Merge Normalization + Layout into one mega-phase

- **Pros:** One milestone.  
- **Cons:** XL blast radius; mixes Facts (deterministic) with Decisions (interpretive); violates Fact vs Decision law. **Reject.**

### Alternative F — Recommended: Canonical Design Graph Materialization (NDG Facts)

One phase that:

1. Ingests `RawDesignDocument` (or adapter-produced raw Facts)  
2. Builds **NormalizedDesignGraph**  
3. Writes **immutable graph Facts + node Facts** into Workspace with provenance  
4. Publishes IrSlice `NormalizedDesignGraph` (passive store only)  
5. Defines the **only** structural SSOT for subsequent engines  
6. Explicitly **re-homes** Phase 9 packs to read NDG (migration task, same phase or immediate follow-on)

---

# 4. Trade-offs

| Choice | Gains | Costs |
|--------|-------|-------|
| Build NDG now | Scalable substrate; simplifies 11–19; fixes Phase 9 inversion | Delays “cool” Layout/Semantic demos |
| Keep Phase 9 packs on `source.node` forever | No migration | Permanent dual representation |
| Collapse wrappers aggressively | Cleaner trees | Risk of silently dropping meaning (must trace drops) |
| Preserve all invisible nodes | Max fidelity | Noise for Layout/Semantic; budgets hurt |
| Call phase “Canonical Design Graph” | Clarity vs Phase 9 normalize | Must map 1:1 to existing NDG contract to avoid schema fork |
| Defer recognition re-home | Faster NDG ship | Temporary dual-path debt |

**Architect preference:** Accept short migration cost; refuse permanent dual SSOT.

---

# 5. Recommended Architecture

## 5.1 Recommended next phase

| Field | Recommendation |
|-------|----------------|
| **Phase number** | 10 (keep sequencing number; change substance/name) |
| **Recommended title** | **Canonical Design Graph Materialization** |
| **Contract produced** | `NormalizedDesignGraph` (+ Fact projections) |
| **Module sketch (future)** | `compiler/graph/` or `compiler/ndg/` — **not** another Rule Pack framework |
| **Nature** | Deterministic Fact producer / graph builder |
| **Not** | Semantic engine, Layout interpreter, HTML generator, Decision Runtime |

## 5.2 Answers to required questions

### Q1. Should “Normalization Engine” exist as a standalone phase? Did Phase 9 already cover it?

**Yes, a standalone structural phase must exist. Phase 9 did not cover it.**

Phase 9 owns:

- Per-node feature bags  
- Evidence / low-level recognition Candidates  

Phase 10 must own:

- Job-wide identity space  
- Parent/order edges  
- Visibility / wrapper / empty-node policy with **traced** drops  
- Provenance `sourceNodeId` ↔ compile `id`  
- Stable NDG artifact for fingerprinting and goldens  

Calling it only “Normalization Engine” is acceptable historically, but **“Canonical Design Graph Materialization”** better matches compiler reality and avoids collision with `features.normalize`.

### Q2. Should there be a Canonical Design Graph? Ownership?

**Yes — as the conceptual name for the materialized `NormalizedDesignGraph`.**

| Owns | Must NOT own |
|------|----------------|
| Stable node/edge identity | Semantic roles, landmarks, Hero/Navbar |
| Visibility & structural collapse policy (deterministic, traced) | Layout mode *interpretation* Decisions (`layout.mode` winners) |
| Geometry/paint/attributes as **data** | HTML/CSS/JS emission |
| Provenance to raw source ids | Ranking, arbitration, confidence calibration |
| IrSlice registration for NDG stage | Knowledge mutation; Fact mutation by later engines |

### Q3. Should Feature Extraction feed HTML directly? Or another representation?

**Never Features → HTML directly.**

Required intermediate stack:

```text
Raw → Canonical/NDG Facts → (engines propose) Hypotheses
    → Decision Runtime → ResolvedIR → EmitPlan → Artifacts (HTML/…)
```

Features and Recognition are **sensors/proposers**, not compile truth. HTML is one exporter among many; binding it to feature bags makes every other exporter a rewrite.

### Q4. What is the compiler’s Single Source of Truth?

**Layered SSOT — not one blob.**

| Layer | SSOT for | Not SSOT for |
|-------|----------|--------------|
| **RawDesignDocument** | Ingress fidelity / replay | Compile identity after collapse |
| **NormalizedDesignGraph Facts** | Structure, geometry data, shared ids | Meaning, tags, interaction authorization |
| **Committed Decisions + ResolvedIR** | Interpretive compile truth authorized for lowering | Replacing raw audit history |
| **EmitPlan / Artifacts** | Codegen plan / bytes | Re-litigating upstream questions |
| Features / Evidence / Recognition | Derived signals & proposals | Anything authoritative |

**Primary answer for “what should Phase 10 establish?”:**  
**Canonical / Normalized Design Graph Facts are the structural SSOT.**  
**ResolvedIR remains the interpretive SSOT for emit.**

### Q5. Which future phases become simpler if this phase exists?

- **11 Layout** — questions attach to stable subjects; dual-run shadow becomes meaningful  
- **12 Components** — instance/override edges share id space  
- **13 Tokens** — bind to node ids, not stringly paths  
- **14 Semantic** — packs query graph + features; abstain/generic becomes principled  
- **15 Responsive / 17 Animation** — strategies reference the same subjects  
- **18 Assets / 19 Lowering / multi-exporter** — one identity map into provenance  
- **23–25 Validation / Quality / Explainability** — structural diffs become first-class  
- **26–28 Corpus / Calibration / Scale** — partition and goldens need NDG equality  

### Q6. Which future bugs are prevented?

- Divergent trees per engine (“Layout saw node X; Semantic never did”)  
- Unstable ids across reruns breaking goldens and caching  
- Silent drop of invisible/wrapper nodes without provenance  
- Recognition/Layout disagreeing because they normalized differently  
- Emit inventing DOM structure not grounded in shared subjects  
- Fingerprint lying (same “features,” different hierarchy)  
- Multi-exporter drift (HTML vs React trees)  

### Q7. From scratch, would you still build the same Phase 10?

**Same substance, different packaging and order:**

From scratch:

1. Contracts (incl. NDG)  
2. Kernel / Workspace / Decision / Policy / Plugin / Knowledge  
3. **Canonical Design Graph materialization** *(before rich recognition)*  
4. Feature extraction **as graph queries / Fact projections**  
5. Recognition Rule Packs  
6. Layout → … → Lowering → Emit  

Given the world as built: **still do graph materialization next**, then migrate Phase 9 consumers onto it. Do **not** pretend Phase 9 already was Phase 10.

---

# 6. Module Ownership

| Module | Owns | Does not own |
|--------|------|--------------|
| **Canonical / NDG builder** (Phase 10) | Build NDG; emit Facts + IrSlice; provenance; deterministic collapse policy | Decisions; semantics; emit; Knowledge writes |
| **Workspace** | Store Facts / IrSlices passively | Graph algorithms |
| **Kernel** | Schedule builder; pin fingerprint fields for NDG checksum/version | Domain transforms |
| **features/** (Phase 9) | Pure extractors; may *read* NDG node records later | Graph identity policy |
| **Rule Packs** | Candidates from graph Facts | Mutating NDG Facts |
| **Decision Runtime** | Arbitration only | Creating structural Facts |
| **Source adapters** (future/data plane) | RawDesignDocument production | Compiler meaning / layout invention |

**Integration style:** Prefer a **deterministic Kernel-invoked Fact producer** (engine/plugin with Fact *create* capability carefully scoped), not “just another recognition pack.” Rule Packs today are forbidden from Fact writes — that boundary should stay. Phase 10 needs an explicit, capability-controlled **Fact producer** path already anticipated by Workspace/Plugin models, not a second framework.

---

# 7. Responsibilities (Phase 10 scope boundary)

## In scope

- Ingest raw design document / raw node Facts  
- Assign stable compile ids; retain `sourceNodeId`  
- Materialize parent/order edges  
- Apply deterministic visibility / empty-wrapper / duplicate-wrapper policy with Evidence or Provenance for drops  
- Project geometry/paint/attributes as data on nodes  
- Write `NormalizedDesignGraph` IrSlice + per-node Facts  
- Guarantee idempotent rebuild under same fingerprint inputs  
- Document Fact kinds for downstream engines  
- Migration plan: Phase 9 packs read NDG subjects  

## Out of scope

- `layout.mode` / flex-vs-absolute Decisions  
- Semantic roles, landmarks, Hero/Navbar packs  
- Token binding Decisions  
- Responsive / animation strategy  
- HTML/CSS/JS / EmitPlan  
- Changing Decision Runtime ranking  
- AI / vision  

---

# 8. Compiler Pipeline (target after Phase 10)

```text
Policy bind + Knowledge pin + RulePack pin
        │
        ▼
RawDesignDocument (ingress SSOT)
        │
        ▼
┌─────────────────────────────────────────┐
│ Phase 10: Canonical Design Graph        │
│ → NormalizedDesignGraph Facts + IrSlice │
│   (structural SSOT)                     │
└─────────────────────────────────────────┘
        │
        ├─► Feature Extraction (re-homed) → Evidence
        ├─► Recognition packs → Hypotheses (still Candidates only)
        ├─► Layout / Component / Token / … engines → Hypotheses
        │
        ▼
Decision Runtime → committed Decisions + Traces
        │
        ▼
ResolvedIR (interpretive SSOT for lowering)
        │
        ▼
EmitPlan → ArtifactSet (HTML/CSS/JS/… exporters)
        │
        ▼
Quality / Provenance / Package
```

**Invariant:** No exporter reads Raw or Features as authority when NDG + ResolvedIR exist.

---

# 9. Future Phase Impact

| Phase | Impact of recommended Phase 10 |
|------:|--------------------------------|
| 9 (done) | Becomes graph consumer; keep packs; change inputs |
| 11 Layout | **Unblocked properly**; subjects = NDG ids |
| 12–13 Component/Token | Share identity; reduce false merges |
| 14 Semantic | Pattern packs attach to regions of NDG, not raw chaos |
| 15–17 Responsive/A11y/Motion | Strategy Decisions reference stable subjects |
| 19 Lowering | Provenance node↔emit becomes mechanical |
| Multi-exporter | One graph → many lowers |
| Scale/Partition | Cut NDG subgraphs, not ad-hoc trees |

**Roadmap edits suggested (documentation only, when authorized):**

1. Rename Phase 10 title to **Canonical Design Graph Materialization**.  
2. Add explicit exit criterion: **Phase 9 packs can run on NDG Facts alone**.  
3. Mark “Graph Builder” as **not a separate later phase**.  
4. Keep Layout as Phase 11 — do not merge.

---

# 10. Migration Impact

| Area | Impact |
|------|--------|
| Contracts | **Low** — NDG schema already exists; may need Fact-kind conventions only (MINOR) |
| Phase 9 packs | **Medium** — switch `source.node` → NDG node Facts; keep questions/evidence kinds |
| `compiler/features` | **Low** — extractors accept NDG node records; avoid duplicating graph policy |
| Kernel fingerprint | **Low–Medium** — include NDG checksum / builder version |
| Decision Runtime | **None** (must remain untouched) |
| Production `server/build.js` | **None in Phase 10** — no `compile()` wiring required yet |
| Goldens | **Gain** — structural fixtures become possible |

**Dual-run recommendation:** Temporarily allow `source.node` degraded mode (Master Plan rollback idea), but fingerprint must mark degraded so goldens fail closed when NDG is required.

---

# 11. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Silent meaning loss during wrapper collapse | High | Every drop → Provenance/Evidence; fixtures assert traces |
| Phase 10 becomes “copy features into Facts” without edges | High | Exit criteria require parent/order edges + id stability tests |
| Dual SSOT (`source.node` + NDG) forever | High | Time-box migration; policy flag; delete degraded path |
| Fact-writer capability abuse | Medium | Narrow plugin declaration; Kernel-only invocation; still no Decision writes |
| Name confusion with features.normalize | Medium | Phase title “Canonical Design Graph”; ban calling Phase 9 “normalization” in new docs |
| Premature Layout creep into Phase 10 | High | Forbid `layout.mode` commits in Phase 10 acceptance |

---

# 12. Recommendation

## Authorize next (when implementation is allowed)

**Phase 10 — Canonical Design Graph Materialization**

- Produce **`NormalizedDesignGraph`** as Workspace Facts + IrSlice  
- Establish **structural SSOT** for the compiler  
- Keep interpretive SSOT as **ResolvedIR** (later)  
- Do **not** feed Features to HTML  
- Do **not** skip this for Layout  
- Do **not** treat Phase 9 as having completed normalization  
- Plan Phase 9 input migration onto the graph  

## Explicit disagreements with a naïve reading of the roadmap

| Naïve reading | Architect position |
|---------------|--------------------|
| “Phase 10 = Normalization Engine as leftover housekeeping” | Phase 10 is the **AST** of the compiler — first-class, not housekeeping |
| “Phase 9 already normalized” | **False** — bags ≠ graph |
| “Canonical Design Graph needs a new schema” | **False** — use existing `NormalizedDesignGraph` |
| “Next exciting phase should be Layout or Semantic” | **Premature** without structural SSOT |
| “Features can drive emit” | **Forbidden** by RFC-002 lowering rules |

## Success picture

After Phase 10, the compiler can say:

> Every later engine reads the **same** nodes, edges, visibility, and provenance.  
> Ambiguity remains in Hypotheses.  
> Truth for structure is the graph.  
> Truth for meaning awaits Decisions.  
> Truth for bytes awaits ResolvedIR → EmitPlan.

That is the scalable architecture for HTML, responsive, animation, optimization, and multiple exporters.

---

## Document control

| Item | Value |
|------|--------|
| Implementation | **Forbidden by this task** |
| Phase 10 execution plan / code | **Not created** |
| Follow-up | Human authorization required before `PHASE_10_EXECUTION_PLAN.md` or any module work |
