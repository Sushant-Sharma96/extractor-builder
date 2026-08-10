# Phase 1 Review Package

| Field | Value |
|-------|--------|
| **Document type** | Review-only artifact |
| **Suite** | `compiler-contract-suite` `@1.0.0` |
| **Authority** | `docs/phases/PHASE_01_EXECUTION_PLAN.md` |
| **Related** | `docs/phases/PHASE_01_COMPLETION_REPORT.md`, `contracts/REVIEW_RECORD.md` |
| **Scope of this doc** | Map deliverables → plan; inventory schemas/registries/fixtures/tests; justify deviations |
| **Does not** | Change contracts, modify implementation, authorize or begin Phase 2 |

**Reviewer action:** Use this package + `npm run test:contracts`, then sign `contracts/REVIEW_RECORD.md` if exit criteria are accepted.

---

## 1. Review intent

Phase 1 must prove the **Contract & IR Spine** exists as versioned, fixture-testable artifacts—not a running Kernel. This package is the checklist for that review.

---

## 2. Deliverable map (Execution Plan §3 → artifacts)

### §3.1 Core compile-input / graph

| Plan deliverable | Implemented? | Artifact |
|------------------|--------------|----------|
| RawDesignDocument contract | Yes | `contracts/schemas/raw-design-document.json` |
| NormalizedDesignGraph contract | Yes | `contracts/schemas/normalized-design-graph.json` |
| Shared Node Identity rules | Yes | `contracts/rules/shared-node-identity.md` |

### §3.2 Reasoning contracts

| Plan deliverable | Implemented? | Artifact |
|------------------|--------------|----------|
| Fact | Yes | `contracts/schemas/fact.json` |
| Hypothesis | Yes | `contracts/schemas/hypothesis.json` |
| Candidate | Yes | `contracts/schemas/candidate.json` |
| Evidence | Yes | `contracts/schemas/evidence.json` |
| Decision Record (RFC-002 §2.2) | Yes | `contracts/schemas/decision-record.json` + `contracts/matrices/rfc002-decision-record-fields.md` |
| Question type registry | Yes | `contracts/registries/question-types.json` |

### §3.3 IR stage contracts

| Plan deliverable | Implemented? | Artifact |
|------------------|--------------|----------|
| IR stage registry | Yes | `contracts/registries/ir-stages.json` (12 stages) |
| Specialized IR envelopes | Yes* | `contracts/schemas/specialized-ir-envelope.json` (`stageId` enum covers layout/component/token/asset/behavior/semantic/a11y) |
| ResolvedIR | Yes | `contracts/schemas/resolved-ir.json` |
| EmitPlan | Yes | `contracts/schemas/emit-plan.json` |
| ArtifactSet | Yes | `contracts/schemas/artifact-set.json` |

\*See §5 Deviations.

### §3.4 Policy, quality, provenance

| Plan deliverable | Implemented? | Artifact |
|------------------|--------------|----------|
| Policy Profile (slots; values non-authoritative) | Yes | `contracts/schemas/policy-profile.json` |
| Compile Job Fingerprint | Yes | `contracts/schemas/job-fingerprint.json` |
| QualityReport | Yes | `contracts/schemas/quality-report.json` |
| ProvenanceBundle | Yes | `contracts/schemas/provenance-bundle.json` |

### §3.5 Governance

| Plan deliverable | Implemented? | Artifact |
|------------------|--------------|----------|
| Versioning rules | Yes | `contracts/rules/versioning.md` |
| Compatibility rules | Yes | `contracts/rules/compatibility.md` |
| Consistency rules | Yes | `contracts/rules/consistency.md` |
| Fixture pack | Yes | `contracts/fixtures/` + `manifest.json` |
| Phase 1 Contract Catalog | Yes | `contracts/CATALOG.md` |
| Review record template | Yes | `contracts/REVIEW_RECORD.md` |
| Charter / suite metadata | Yes | `contracts/CHARTER.md`, `contracts/suite.json` |

### §3.6 Explicit non-deliverables (confirmed absent)

Kernel, Workspace, engines, Knowledge content, rule packs, authoritative policy values, HTML/CSS/JS emit, snapshot formats, scoring/arbitration algorithms — **not implemented**.

---

## 3. Task coverage (Execution Plan §5)

| Task | Outcome |
|------|---------|
| 1.1 Charter | `CHARTER.md` + `suite.json` |
| 1.2 Shared identity | `rules/shared-node-identity.md` |
| 1.3 RawDesignDocument | schema + fixture |
| 1.4 NormalizedDesignGraph | schema + fixture |
| 1.5 Fact / Hypothesis / Candidate / Evidence | schemas + fixtures |
| 1.6 Decision Record | schema + winner/abstain/overridden fixtures + matrix |
| 1.7 Question registry | `registries/question-types.json` |
| 1.8 IR registry + envelopes + ResolvedIR | registry + envelope + ResolvedIR |
| 1.9 EmitPlan + ArtifactSet | schemas + fixtures |
| 1.10 Policy + Fingerprint | schemas + fixtures (`valuesAuthoritative: false`) |
| 1.11 QualityReport + Provenance | schemas + fixtures |
| 1.12 Versioning / compatibility / consistency | three rule docs |
| 1.13 Fixture pack + harness spec | manifest + `HARNESS_SPEC.md` + `harness.js` |
| 1.14 Catalog freeze | `CATALOG.md` + completion report; **human exit sign-off still open** |

---

## 4. Inventories for reviewers

### 4.1 Schemas (`contracts/schemas/`)

| contractId | File |
|------------|------|
| RawDesignDocument | `raw-design-document.json` |
| NormalizedDesignGraph | `normalized-design-graph.json` |
| Fact | `fact.json` |
| Evidence | `evidence.json` |
| Candidate | `candidate.json` |
| Hypothesis | `hypothesis.json` |
| DecisionRecord | `decision-record.json` |
| SpecializedIrEnvelope | `specialized-ir-envelope.json` |
| ResolvedIR | `resolved-ir.json` |
| EmitPlan | `emit-plan.json` |
| ArtifactSet | `artifact-set.json` |
| PolicyProfile | `policy-profile.json` |
| CompileJobFingerprint | `job-fingerprint.json` |
| QualityReport | `quality-report.json` |
| ProvenanceBundle | `provenance-bundle.json` |
| *(supporting defs)* | `common.json` |

### 4.2 Registries

| Registry | File | Contents |
|----------|------|----------|
| IR stages | `contracts/registries/ir-stages.json` | 12 stages: raw → NDG → 7 specialized → resolved → emit-plan → artifact-set; predecessors + illegal examples |
| Question types | `contracts/registries/question-types.json` | 10 initial ids; extension policy (`<namespace>.<name>`) |

### 4.3 Fixtures (`contracts/fixtures/`)

**Positive (17):**

| File | contractId / case |
|------|-------------------|
| `raw-design-document.valid.json` | RawDesignDocument |
| `normalized-design-graph.valid.json` | NormalizedDesignGraph |
| `fact.valid.json` | Fact |
| `evidence.valid.json` | Evidence |
| `candidate.valid.json` | Candidate |
| `hypothesis.valid.json` | Hypothesis |
| `decision-record.winner.json` | DecisionRecord — **winner** |
| `decision-record.abstain.json` | DecisionRecord — **abstain** |
| `decision-record.overridden.json` | DecisionRecord — **overridden** |
| `specialized-ir-envelope.layout.json` | SpecializedIrEnvelope |
| `resolved-ir.valid.json` | ResolvedIR |
| `emit-plan.valid.json` | EmitPlan |
| `artifact-set.valid.json` | ArtifactSet |
| `policy-profile.valid.json` | PolicyProfile |
| `job-fingerprint.valid.json` | CompileJobFingerprint |
| `quality-report.valid.json` | QualityReport |
| `provenance-bundle.valid.json` | ProvenanceBundle |

**Negative (2):**

| File | Expect |
|------|--------|
| `negative/decision-missing-status.json` | schema fail (missing `status`) |
| `negative/fact-as-empty.json` | schema fail (incomplete Fact) |

### 4.4 Validation tests

| Item | Detail |
|------|--------|
| Command | `npm run test:contracts` → `node contracts/validation/harness.js` |
| Spec | `contracts/validation/HARNESS_SPEC.md` |
| Last reported result | **34 passed, 0 failed** |
| Checks | suite version; schema presence; IR enumerable/predecessors; question registry; RFC-002 Decision fields + status enum; all positive fixtures; decision cases; round-trip; EmitPlan/Provenance↔Decision consistency; policy non-authoritative; negatives fail; Fact≠Hypothesis |

---

## 5. Deviations (non-architectural)

| Deviation | What was done | Why non-architectural |
|-----------|---------------|------------------------|
| **D1 — Shared SpecializedIrEnvelope** | One schema with `stageId` enum for all seven specialized stages, instead of seven separate schema files | Plan required **envelopes + identity linkage**, not seven domain catalogs. Same stage ids appear in the IR registry. No new IR stages, no domain fields, no Kernel/engine logic. Packaging choice only. |
| **D2 — Draft-07 subset harness (no Ajv)** | In-repo validator covering required/type/enum/const/oneOf/items/additionalProperties | Plan required **fixture-testable** contracts and a harness **spec**, not a specific schema library. Semantics under test match Phase 1 needs. No change to contract meanings. |
| **D3 — `common.json` supporting defs** | Shared NodeRef-oriented definitions file | Convenience for authors; not a new Master Plan contract kind; does not alter RFC vocabulary. |
| **D4 — Review sign-off pending** | Artifacts complete; `REVIEW_RECORD.md` unsigned | Process gate, not an architectural change. Blocks Phase 2 by plan, not by missing spine. |

No deviation introduces new RFC concepts, Kernel behavior, or compile-path wiring.

---

## 6. Exit criteria status (for sign-off)

| Criterion | Status |
|-----------|--------|
| Contracts exist and are catalogued | Met |
| Decision Record: winner / abstain / override | Met |
| IR stages enumerable | Met |
| Fixtures + harness verifiable | Met (`test:contracts` green) |
| No runtime coupling (rollback = revise schemas) | Met |
| **Contracts review-approved** | **Pending** — sign `contracts/REVIEW_RECORD.md` |

---

## 7. Suggested review sequence (≤30 min)

1. Skim this package §§2–5.  
2. Spot-check `decision-record.json` against `matrices/rfc002-decision-record-fields.md`.  
3. Confirm EmitPlan requires `decisionId` on tag choices; Policy has `valuesAuthoritative: false`.  
4. Run `npm run test:contracts`.  
5. Confirm §3.6 non-deliverables remain absent.  
6. Sign or reject via `contracts/REVIEW_RECORD.md`.

---

## 8. Phase 2 boundary

**Do not begin Phase 2** until this review package is accepted and `REVIEW_RECORD.md` is signed.

Phase 2 may consume `compiler-contract-suite@1.0.0` as frozen vocabulary; it must not redefine Decision Record fields or EmitPlan’s lowering-only posture.

---

**End of Phase 1 Review Package.**
