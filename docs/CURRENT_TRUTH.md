# CURRENT_TRUTH.md — Compiler Foundation SSOT

| Field | Value |
|-------|--------|
| **Document** | Single source of truth for foundation status |
| **Architecture version** | **Foundation Freeze v1** (Phase 11b.1) |
| **Date** | 2026-07-18 |
| **Compiler status** | **Product Integrated** |
| **Precedence** | This file + `ARCHITECTURE_LOCK_CONTRACT.md` win on *status*; RFC-002 wins on *reasoning* conflicts with Master Plan |

---

## Current phase

| Item | Value |
|------|--------|
| **Completed through** | Product Integration — EmitPlan → HTML/CSS/JS via legacy emitter adapter |
| **Next authorized** | **Live Figma URL validation** (pixel comparison) |
| **Not started** | Asset/Behavior engines, pixel tuning |

---

## Current pipeline (implemented)

```text
Raw / source.node
  → NDG
  → LayoutIR₀ (+ optional LayoutIR₁)
  → ComponentIR → TokenIR → SemanticIR → ResponsiveIR → AccessibilityIR
  → ResolvedIR
  → EmitPlan
  → compile() orchestration
  → artifacts (figma-build adapter) → HTML/CSS/JS + output dir
```

Entry: `require('./compiler/compile').compile({ document, outDir?, … })`.

Figma product path: `POST /api/figma/convert` → fetch → **`compile()`** → disk (no emit-only bypass).

---

## Current ownership (frozen)

| Concern | Owner |
|---------|--------|
| Contracts / IR stage ids / question ids | `contracts/` |
| Job lifecycle, fingerprint, budgets | **Kernel** |
| Artifact store | **Workspace** |
| Rank / arbitrate / commit / traces | **Decision Runtime only** |
| Thresholds / allowlists | **Policy** |
| Plugin capabilities | **Plugin infrastructure** |
| Immutable ontology | **Knowledge** |
| Candidates only | **Rule Packs** |
| Structural graph | **NDG** |
| Layout + Constraint | **Layout** |
| Domain specialized IRs | Component / Token / Semantic / Responsive / Accessibility |
| Composition | **ResolvedIR** |
| Lowering plan | **EmitPlan** |
| Orchestration | **`compile()`** |
| Code emission (HTML/CSS/JS) | **Product adapter** `compiler/artifacts` + **`server/figma-build`** |

---

## Current frozen modules

Kernel · Workspace · Decision · Policy · Plugin · Knowledge · Rule Pack infra · Features · NDG · Layout · Constraint · Components · Tokens · Semantics · Responsive · Accessibility

Resolved / Emit / compile / artifacts adapter are **integration layers** — they do not reopen Foundation ownership.

---

## Active RFCs

| RFC | Path | Role |
|-----|------|------|
| **RFC-002 (primary)** | `docs/COMPILER_DECISION_SYSTEM.md` | Decision monopoly, Workspace, Capability DAG |
| **RFC-001** | `docs/COMPILER_ARCHITECTURE_AUDIT.md` | Historical ideal pipeline |

Conflict rule: **RFC-002 wins** on reasoning vs Master Plan / RFC-001.

---

## Authoritative documents (precedence)

1. `docs/CURRENT_TRUTH.md` (this file) — **status**  
2. `docs/ARCHITECTURE_LOCK_CONTRACT.md` — **freeze constitution**  
3. `docs/FINAL_PRODUCT_INTEGRATION_REPORT.md` — product integration  
4. `docs/ARCHITECTURE_VALIDATION_REPORT.md` / `INTEGRATION_READINESS_REPORT.md`  
5. RFC-002 → RFC-001  
6. `docs/IMPLEMENTATION_MASTER_PLAN.md`  
7. Phase completion reports  

---

## Implementation status snapshot

| Area | Status |
|------|--------|
| Foundation (1–11b.1) | Live / frozen |
| Domain engines (12–16) | Live |
| ResolvedIR | Live |
| EmitPlan (neutral plan) | Live |
| `compile()` | Live through artifacts |
| Fingerprint ↔ schema sync | Live |
| HTML/CSS/JS Artifacts | **Live** (adapter + figma-build) |
| Figma URL → compiler | **Live** |

---

## Document cleanup note

Older phase reports may still say “Stop. Phase N not implemented” as **historical handoff text**. Treat them as archives. **Current status is only this file.**
