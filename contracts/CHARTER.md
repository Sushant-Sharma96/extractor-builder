# Contract Suite Charter (Phase 1)

| Field | Value |
|-------|--------|
| **Suite ID** | `compiler-contract-suite` |
| **Initial version** | `1.0.0` |
| **Phase** | 1 — Contract & IR Spine |
| **Authority** | PHASE_01_EXECUTION_PLAN.md |

## Purpose

Provide a single, versioned vocabulary for compile-job data shapes used by Kernel (Phase 2+), Workspace, engines, lowering, validation, and corpora.

## Catalog outline (frozen for Phase 1)

1. Shared Node Identity rules  
2. RawDesignDocument  
3. NormalizedDesignGraph  
4. Fact / Hypothesis / Candidate / Evidence  
5. Decision Record  
6. Question Type Registry  
7. IR Stage Registry + specialized envelopes + ResolvedIR  
8. EmitPlan + ArtifactSet  
9. Policy Profile + Compile Job Fingerprint  
10. QualityReport + ProvenanceBundle  
11. Versioning / Compatibility / Consistency rulebooks  
12. Fixture pack + validation harness  

## Non-goals

Kernel runtime, engines, rule packs, Knowledge content, HTML emit, snapshot formats, scoring/arbitration algorithms.
