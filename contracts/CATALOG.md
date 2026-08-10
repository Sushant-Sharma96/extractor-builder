# Phase 1 Contract Catalog

**Suite ID:** `compiler-contract-suite`  
**Suite version:** `1.0.0`  
**Phase:** 1 — Contract & IR Spine  

## Index

| Artifact | Path |
|----------|------|
| Suite metadata | `contracts/suite.json` |
| Charter | `contracts/CHARTER.md` |
| Shared Node Identity | `contracts/rules/shared-node-identity.md` |
| Versioning rules | `contracts/rules/versioning.md` |
| Compatibility rules | `contracts/rules/compatibility.md` |
| Consistency rules | `contracts/rules/consistency.md` |
| IR stage registry | `contracts/registries/ir-stages.json` |
| Question type registry | `contracts/registries/question-types.json` |
| RFC-002 Decision matrix | `contracts/matrices/rfc002-decision-record-fields.md` |
| Review record template | `contracts/REVIEW_RECORD.md` |
| Validation harness | `contracts/validation/harness.js` |
| Harness spec | `contracts/validation/HARNESS_SPEC.md` |
| Fixture manifest | `contracts/fixtures/manifest.json` |

## Schemas (`contracts/schemas/`)

| contractId | File |
|------------|------|
| common (defs) | `common.json` |
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

## IR stages (enumerable)

See `registries/ir-stages.json`: raw → NDG → specialized envelopes → ResolvedIR → EmitPlan → ArtifactSet.

## Handoff

Phase 2 (Compiler Kernel) may assume this catalog at `suiteVersion` `1.0.0` and must not redefine Decision Record field meanings (see PHASE_01_EXECUTION_PLAN §9).
