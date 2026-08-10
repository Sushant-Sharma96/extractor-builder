# Shared Node Identity Rules

**Suite:** compiler-contract-suite `@1.0.0`  
**Phase:** 1

## Representation

- A **NodeRef** is a string id stable within a compile job.
- Format: opaque string; recommended pattern `src:<sourceNodeId>` for source-aligned nodes, or `ir:<stage>:<localId>` for stage-local nodes that are not 1:1 with source.
- All graphs (NDG, LayoutIR, ComponentIR, …) that refer to the same design entity **must** use the same NodeRef when the entity is shared.

## References

- Decision `subject` is either one NodeRef, an array of NodeRefs, or a structured subject `{ "nodes": NodeRef[], "edges"?: string[] }`.
- Provenance bindings use the same NodeRef vocabulary.
- Cross-graph edges store `from` / `to` as NodeRefs.

## Facts vs Decisions

- **Facts** assert source-derived or normalization-derived truth about NodeRefs.
- **Facts are immutable** once published under a `factId`: field values must not change in place.
- Corrections publish a **new** Fact id and optionally an invalidation record referencing the prior `factId`.
- Interpretations (tags, patterns, flow reinterpretation) are **never** Facts; they are Hypotheses / Decision Records.

## Forbidden

- Multiple conflicting ids for the same entity without an explicit alias map Fact.
- Treating layer names as NodeRefs.
