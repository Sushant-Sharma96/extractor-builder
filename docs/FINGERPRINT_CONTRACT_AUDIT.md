# FINGERPRINT_CONTRACT_AUDIT.md — Phase 11b.1

| Field | Value |
|-------|--------|
| **Date** | 2026-07-18 |
| **Status** | **Synced** |

---

## Problem (pre-11b.1)

`compiler/kernel/fingerprint.js` emitted NDG/layout/solver/plugin fields while `contracts/schemas/job-fingerprint.json` listed a small subset with `additionalProperties: false` — live fingerprints were **schema-invalid**.

---

## Resolution

1. Expanded `job-fingerprint.json` to all named implementation fields.  
2. Added `baselineLayoutIrSliceId` + `activeLayoutIrSliceId` (Active LayoutIR pin).  
3. Updated fixture `job-fingerprint.valid.json`.  
4. Exported `FINGERPRINT_NAMED_FIELDS` + `assertNoHiddenFingerprintFields`.  
5. Contracts harness asserts schema ↔ implementation sync + live `buildFingerprint` validation.

---

## Named fields (canonical)

```
contractId, suiteVersion, contractSuiteVersion,
policyProfileId, policyProfileVersion,
knowledgeBundleId, knowledgeBundleVersion, knowledgeChecksum,
ruleSetVersion, rulePacks, seed, plugins,
ndgChecksum, ndgBuilderVersion, ndgGraphId,
layoutIrChecksum, layoutBuilderVersion, layoutSliceId,
baselineLayoutIrSliceId, activeLayoutIrSliceId,
constraintSolverVersion, solvedLayoutIrChecksum, solvedLayoutSliceId,
solverFingerprint,
componentIrChecksum, componentBuilderVersion, componentSliceId
```

Optional: `extra` (escape hatch only). Phase 12 added component fields (schema synced).

---

## CI expectations

- `npm run test:contracts` must pass `fingerprint.schema-sync` and `fingerprint.live-validate`.  
- Adding a fingerprint field without schema update **fails CI**.

---

## Pin semantics in fingerprint

| Field | Meaning |
|-------|---------|
| `layoutSliceId` / `baselineLayoutIrSliceId` | LayoutIR₀ |
| `solvedLayoutSliceId` | LayoutIR₁ id when present |
| `activeLayoutIrSliceId` | Pin: solved if present, else baseline |

Workspace also stores pins via `setLayoutIrPin` (metadata; IrSlices untouched).
