# ARCHITECTURE_METRICS.md — Foundation Freeze v1

| Field | Value |
|-------|--------|
| **Date** | 2026-07-18 |
| **Phase** | 11b.1 |
| **Method** | Counted from live tree |

---

## Counts

| Metric | Count | Notes |
|--------|------:|-------|
| Contract schemas | 16 | `contracts/schemas/*.json` |
| IR stages | 12 | Registry (many unimplemented as modules) |
| Question types | 16 | Registry |
| Fingerprint named fields | 24 | Synced with schema (excl. optional `extra`) |
| Rule Packs | 5 | Under `compiler/rulepack/packs` |
| Facts plugins (layout/ndg) | 3 | ndg, layout.project, layout.constraint |
| Compiler test suites | 11 | `compiler/test/*.test.js` |
| Docs markdown (under `docs/`) | ~47+ | Includes phase docs |
| Policy profiles | 4 | pixel-faithful, static-ok, semantic-lean, interactive-required |
| Knowledge bundles | 5 | Under `compiler/knowledge/bundles` |

---

## Kernel surface (approximate)

| Category | Examples |
|----------|----------|
| Job domain verbs | `materializeNormalizedDesignGraph`, `projectLayoutIR`, `solveLayoutConstraints`, `executeRulePack`, `invokeDecisionRuntime` |
| Lifecycle | `runEmpty`, `abort`, `attachWorkspace` |
| Registries | plugins, rule packs, knowledge, engines (legacy) |

---

## Workspace APIs

Store kinds: Fact, Hypothesis, Decision, Evidence, IrSlice, Provenance, Trace  

**11b.1 addition:** LayoutIR pin metadata (`setLayoutIrPin` / `getLayoutIrPin` / `listLayoutIrPins`) — not a StoreKind; not an IR.

---

## Evidence / Hypothesis refs (layout constraint)

Observed refs include: `layout.signal`, `layout.constraint.conflict`, `layout.constraint.relaxed`, `layout.constraint.unsat`, `layout.constraint.fallback`.

---

## Validation suites (npm)

`test:contracts`, `test:kernel`, `test:workspace`, `test:decision`, `test:policy`, `test:plugin`, `test:knowledge`, `test:rulepack`, `test:features`, `test:ndg`, `test:layout`, `test:constraint` / `test:phase11b`

---

## Interpretation

High contract/IR registry coverage vs **implemented** modules (NDG + Layout only among specialized IRs) is intentional roadmap, not over-claim — unimplemented stages must not be treated as live engines.
