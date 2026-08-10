# Cross-Contract Consistency Rules

**Suite:** compiler-contract-suite `@1.0.0`  
**Phase:** 1

1. **Subjects use Shared Node Identity** — Decision / Hypothesis `subject` NodeRefs must obey `rules/shared-node-identity.md`.
2. **Facts are immutable** — two Facts with the same `factId` must be byte-identical in authoritative fields; harness treats mismatch as failure.
3. **EmitPlan interpretive choices reference Decisions** — any `tagChoice` / `roleChoice` entry must include `decisionId` referencing a Decision Record whose `status` is `arbitrated`, `overridden`, or `fallen-back` (not merely `proposed`).
4. **EmitPlan must not detect patterns** — no fields whose meaning is pattern detection; open string refs to pattern ids are allowed only inside Decision evidence/candidates, not as EmitPlan detection output.
5. **ResolvedIR commitment** — slices marked `committed: true` are the only slices EmitPlan may treat as authorized input for interpretive lowering (enforced fully in Kernel/Phase 19; represented here).
6. **Provenance linkage** — each provenance binding that cites a `decisionId` must use an id that exists in the job’s Decision set when both are present in a combined fixture.
7. **Fingerprint completeness** — a Job Fingerprint must include `contractSuiteVersion`, `policyProfileId`, and slots for `knowledgeBundleVersion` and `ruleSetVersion` (nullable until those systems exist).
8. **QualityReport axes** — score object keys are reserved names from RFC-001 §7; unknown axis keys are additive (MINOR) but Phase 1 fixtures only use the reserved set.
9. **Question types** — Decision `question` must be a string; if it uses a dotted namespace present in the Question Type Registry, it should match a registered id or an explicitly allowed extension pattern (`<namespace>.<name>`).
10. **No Kernel APIs in contracts** — schemas must not require scheduler, engine process, or HTTP fields.
