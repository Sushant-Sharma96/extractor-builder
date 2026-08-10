# Validation Harness Spec (Phase 1)

**Suite:** compiler-contract-suite `@1.0.0`

## Purpose

Verify Phase 1 contract artifacts without Kernel, engines, or network.

## Checks

1. Suite version is `1.0.0`.
2. All required schema files are present.
3. IR stage registry is enumerable; every predecessor id is a known stage.
4. Question type registry has extension policy + initial questions.
5. Decision Record schema requires all RFC-002 §2.2 fields; status enum complete.
6. Every positive fixture in `fixtures/manifest.json` validates against its schema.
7. Decision fixtures exist for **winner**, **abstain**, and **overridden**.
8. Decision fixtures JSON round-trip identically.
9. EmitPlan and ProvenanceBundle fixtures reference the winner Decision id.
10. Policy Profile fixture has `valuesAuthoritative: false`.
11. Negative fixtures fail validation.
12. Fact and Hypothesis use distinct `contractId` values.

## How to run

```bash
npm run test:contracts
```

Equivalent:

```bash
node contracts/validation/harness.js
```

## Exit code

- `0` — all checks pass (Phase 1 validation green)
- non-zero — one or more failures
