# Plugin Capability Contract

| Field | Value |
|-------|--------|
| **Status** | **Frozen architecture** — awaiting Phase 6 implementation |
| **Date** | 2026-07-18 |
| **Authority** | RFC-002 §6, §8, §11; IMPLEMENTATION_MASTER_PLAN Phase 6; Pre-Phase-6 Integration Audit recommendations |
| **Supersedes for plugins** | Informal Phase 2 engine-registry skeleton (declaration subset only) |
| **Non-goals of this document** | Code, algorithms, source paths, harnesses, real engines, Phase 6 implementation |

---

## 1. Purpose

Future engines (Layout, Semantic, Animation, AI proposers, Accessibility, …) must attach to the compiler **without rewriting the Kernel**.

This contract freezes:

1. What every plugin **must declare**
2. How **capability enforcement** works
3. What **execution permissions** exist
4. How **failures / crashes** are handled
5. Plugin **lifecycle**
6. **Compatibility** rules

This is architecture only. Phase 6 implements the contract; later phases supply real engines.

---

## 2. Architectural Placement

```text
Policy Profiles ──► allow / deny plugins; budgets; gateMode
        │
        ▼
   Compiler Kernel ──► load · validate · register · schedule · isolate · dispose
        │
        ├── Workspace (passive) ◄── plugin reads/writes under capabilities
        │
        └── Decision Runtime ──► only component that commits DecisionRecords
                 ▲
                 │ Hypotheses / Candidates / Evidence (never winners chosen by plugin)
```

**Invariants (frozen):**

| Actor | May | Must not |
|-------|-----|----------|
| Plugin | Read/write Workspace kinds it declares; propose Candidates/Hypotheses/Evidence/derived Facts | Choose winners; mutate immutable Facts; bypass Workspace; call Emit; own thresholds |
| Workspace | Store under capability checks | Score, rank, arbitrate |
| Decision Runtime | Rank, arbitrate, commit Decisions + Traces | Be replaced by a plugin “finalizer” |
| Kernel | Schedule, enforce caps, isolate crashes, fingerprint versions | Perform domain reasoning |
| Policy | Configure allowlists and budgets | Execute plugin logic |

---

## 3. Mandatory Declaration

Every plugin **must** declare the following fields. Missing required fields → registration rejected.

### 3.1 Identity & classification

| Field | Type (logical) | Meaning |
|-------|----------------|---------|
| `id` | string | Stable plugin identity (no UI ontology tokens in id) |
| `version` | semver string | Plugin artifact version; enters job fingerprint |
| `engineType` | enum | Logical class: `facts` \| `hypothesis` \| `proposer` \| `validator` \| `feature` \| `other` |
| `phaseAffinity` | enum | Scheduling hint: `early` \| `mid` \| `late` \| `lowering` |
| `determinism` | enum | `pure` \| `seeded` \| `nondeterministic` |

### 3.2 Workspace I/O surface

| Field | Type (logical) | Meaning |
|-------|----------------|---------|
| `reads` | list of StoreKind / fact-kind / question refs | What the plugin may **read** from Workspace |
| `writes` | list of StoreKind / kind tokens | What the plugin may **write** (create or append-allowed kinds) |
| `creates` | list of artifact kinds | Kinds the plugin is allowed to **introduce** (subset/clarify of writes) |
| `destroys` | list of artifact kinds | Kinds the plugin may request **invalidation/removal** for (never silent Fact mutate) |
| `consumes` | list of inputs | Logical inputs required from prior waves (Facts, committed Decisions, IR slices) |
| `produces` | list of outputs | Logical outputs (Hypotheses, Evidence, derived Facts, IrSlices) — **not** Decision winners |

### 3.3 Fact & IR constraints

| Field | Type (logical) | Meaning |
|-------|----------------|---------|
| `requiredFacts` | list of fact kinds / ids patterns | Hard prerequisites; scheduler blocks until present (or fail per policy) |
| `optionalFacts` | list of fact kinds | Soft inputs; absence reduces hypothesis quality, does not auto-crash |
| `emittedIR` | list of IR `stageId`s | Specialized IR envelopes the plugin may write (must be Phase 1 registry ids) |

### 3.4 Questions & policy binding

| Field | Type (logical) | Meaning |
|-------|----------------|---------|
| `acceptedQuestions` | list of question ids | Decision questions this plugin may propose Candidates for |
| `allowedPolicies` | list of profileIds or `*` | Policies under which the plugin may run |
| `requiredCapabilities` | list of capability tokens | Host/platform capabilities the plugin needs (e.g. `seed`, `geometry`, `network:denied`) |
| `incompatiblePlugins` | list of plugin ids | Mutual exclusion; Kernel must not co-schedule both |

### 3.5 Budgets & resilience

| Field | Type (logical) | Meaning |
|-------|----------------|---------|
| `estimatedCost` | number or cost class | Relative CPU/work claim for scheduling / budget accounting |
| `estimatedMemory` | bytes or class | Memory claim |
| `timeout` | duration | Soft timeout; Kernel enforces |
| `retries` | integer ≥ 0 | Bounded retries on transient failure (never unbounded) |
| `crashIsolation` | enum | `process` \| `realm` \| `try_catch` \| `none` — required isolation level |
| `rollbackSupport` | enum | `none` \| `workspace_tx` \| `invalidate_only` — what the plugin can undo on failure |

### 3.6 Declaration completeness rule

- `writes` and `creates` must be consistent (`creates ⊆ writes` logically).
- `destroys` may not include immutable Fact **mutation**; destruction means **invalidation protocol** or derived-fact supersession only.
- `emittedIR` stageIds must exist in the Phase 1 IR registry.
- `acceptedQuestions` should align with Phase 1 question registry when questions are known.
- `determinism: nondeterministic` plugins are **disabled** under golden / determinism-strict policies unless Policy explicitly allows.

---

## 4. Capability Enforcement

### 4.1 Principle

**Declared capabilities are the only permissions.**  
Undeclared operations are denied by the Kernel (or Workspace capability gate acting for the Kernel).

### 4.2 Example — allowed vs denied

**Plugin A** declares:

```text
id: engine.layout.interpret
reads:  [ Hypothesis, Fact, Evidence ]
writes: [ Fact, Hypothesis ]          # derived facts + hypotheses only
creates: [ Hypothesis, Fact ]
destroys: []                          # may not invalidate in v1
```

**Plugin B** declares:

```text
id: engine.semantic.tags
reads:  [ Fact, Hypothesis ]
writes: [ Hypothesis, Evidence ]
creates: [ Hypothesis, Evidence ]
```

| Attempt | Result |
|---------|--------|
| A writes `Hypothesis` | **ALLOW** (declared) |
| A writes `Fact` (derived, via protocol) | **ALLOW** if `Fact` ∈ writes and immutability protocol obeyed |
| A writes `DecisionRecord` | **DENY** — not in writes; Decisions owned by Decision Runtime |
| B writes `DecisionRecord` | **DENY** — capability missing |
| B reads `Hypothesis` | **ALLOW** |
| B writes `ResolvedIR` / commits winners | **DENY** — bypass of Runtime forbidden |
| Any plugin mutates existing Fact in place | **DENY** — immutability |

### 4.3 Decision write monopoly

Only the **Decision Runtime** (Kernel-invoked) may write:

- `DecisionRecord`
- `DecisionTrace` (as authoring path)

Plugins:

- **may** write Hypotheses / Candidates / Evidence that Runtime later consumes  
- **must not** declare `writes: [DecisionRecord]` in shipping profiles  
- if a declaration includes Decision writes → **registration rejected** (architecture invariant)

### 4.4 Strip / reject policy

On illegal write attempt:

1. Operation aborted  
2. Plugin marked `capability_violation` for the job  
3. No partial illegal artifact retained  
4. Recovery follows Policy (`fail_closed` vs disable-plugin-and-continue)

---

## 5. Execution Permissions

### 5.1 Positive permissions

A scheduled plugin may:

1. **Read** Workspace artifacts listed in `reads` (and committed Decisions if declared).
2. **Write** only kinds in `writes` / `creates` under Workspace APIs.
3. **Emit** IrSlices only for `emittedIR` stageIds.
4. **Propose** for `acceptedQuestions` only.
5. **Run** only when current Policy ∈ `allowedPolicies` (or `*`) and Policy `allowedEngineIds` allows `id`.
6. **Use** host capabilities listed in `requiredCapabilities` when Kernel grants them.

### 5.2 Absolute prohibitions

| Prohibition | Rationale |
|-------------|-----------|
| Write artifacts outside declared permissions | Capability model |
| Mutate immutable data (Facts in place) | Phase 3 invariant |
| Bypass Workspace (private pipes to other plugins) | RFC-002 §6 |
| Bypass Decision Runtime (self-commit winners / ResolvedIR) | RFC-002 §2 / §11.3 |
| Own or invent global thresholds | Policy Profiles own values |
| Perform HTML/CSS/JS codegen | Emit is lowering, not a peer reasoner |
| Reach into another plugin’s private memory | Isolation |
| Unbounded retries / unbounded re-entry | Recovery bounded by Kernel + Policy |

### 5.3 Permission check order (logical)

```text
Policy allowlist
  → Compatibility (versions)
  → Capability declaration present
  → Operation kind ∈ reads|writes|creates|destroys as appropriate
  → Immutability / cross-ref rules
  → Budget / timeout remaining
  → Execute
```

Any step fail → deny (no silent success).

---

## 6. Failure Contract

### 6.1 Crash / timeout / throw

```text
Plugin crash / timeout / uncaught error
        ↓
Kernel receives failure (isolated boundary)
        ↓
Workspace preserved (no silent wipe)
        ↓
Committed Decisions preserved
        ↓
Committed Traces preserved
        ↓
Policy decides:
   • continue — disable plugin for job; quality penalty; reduced hypothesis set
   • abort    — job FAILED / gate fail-closed
```

### 6.2 Guarantees

| Guarantee | Required |
|-----------|----------|
| Plugin crash ≠ Kernel process death | Yes (`crashIsolation` ≠ effective `none` for shipping) |
| Workspace not discarded solely due to plugin crash | Yes |
| Prior committed Decisions remain readable | Yes |
| Prior Decision Traces remain readable | Yes |
| Illegal partial writes from crashed plugin rolled back or never committed | Yes (`rollbackSupport` / transactional write protocol) |
| Failure kind recorded for recovery taxonomy | Yes (align RFC-002 §8) |

### 6.3 Recovery stances (policy-owned)

| Failure | Default stance (logical) |
|---------|--------------------------|
| Timeout, non-critical plugin | Disable plugin; continue |
| Timeout, critical path | Retry ≤ `retries`; then fallback / abort per Policy |
| Capability violation | Treat as plugin fault; disable; fail-closed under strict Policy |
| Crash with `rollbackSupport: none` | Drop uncommitted outputs; keep prior commits |
| Crash with `workspace_tx` | Abort transaction; Workspace consistent |

### 6.4 What failure must not do

- Invent winners to “recover”
- Delete other plugins’ committed work without invalidation protocol
- Bypass gates
- Mutate Policy thresholds

---

## 7. Lifecycle

```text
Load → Validate → Register → Execute → Commit → Dispose
```

| Phase | Owner | Meaning |
|-------|-------|---------|
| **Load** | Kernel | Discover plugin artifact / declaration; parse declaration object |
| **Validate** | Kernel (+ Policy/Contract suite) | All mandatory fields; IR stage ids; no Decision write claims; ontology ban on ids; compatibility |
| **Register** | Kernel engine registry | Freeze declaration; index by `id`+`version`; include in fingerprint inputs |
| **Execute** | Kernel scheduler | Grant capability-scoped Workspace handle; run within timeout/budget; isolation boundary |
| **Commit** | Plugin via Workspace APIs only | Persist allowed artifacts; **not** Decision winners. Decisions committed only by Decision Runtime in arbitration waves |
| **Dispose** | Kernel | Release isolation realm; clear ephemeral handles; no dangling writes |

### 7.1 Re-entrancy

If `requiredCapabilities` / declaration includes re-entry after invalidation:

- Kernel may re-Execute **bounded** times  
- Prior Hypotheses may be superseded only via declared protocols  
- Never unbounded “debate loops”

### 7.2 Commit clarity

“Commit” in the plugin lifecycle means **Workspace persistence of allowed artifacts**.  
It does **not** mean arbitration commit. Arbitration remains Decision Runtime exclusive.

---

## 8. Compatibility

### 8.1 Version axes

| Axis | Rule |
|------|------|
| **Plugin `version`** | Semver; exact version recorded in job fingerprint |
| **Compiler / Kernel version** | Plugin may declare min/max host version (logical extension of `requiredCapabilities`) |
| **Contract suite version** | Must match job `contractSuiteVersion` (or declared compatible range); mismatch → reject |
| **Policy compatibility** | Current `profileId` must be in `allowedPolicies` (or `*`); Policy `allowedEngineIds` must allow plugin; determinism policy may exclude `nondeterministic` |

### 8.2 Incompatibility graph

- If A lists B in `incompatiblePlugins` (or vice versa), Kernel must not enable both on the same job.
- Resolution: Policy preference order, else fail registration/schedule with explicit error.

### 8.3 Fingerprint inclusion

Job determinism fingerprint **must** include:

- enabled plugin `id` + `version` set (ordered stably)
- Policy profile id/version
- Contract suite version
- Knowledge / rule-set versions when present (later phases)

Same inputs + same plugin set ⇒ same Decisions (for `pure` / `seeded` plugins).

---

## 9. Relationship to Existing Spine (Phases 1–5)

| Existing surface | Relationship to this contract |
|------------------|-------------------------------|
| Phase 2 `engine-registry` skeleton | Superset target; Phase 6 brings full declaration + enforcement |
| Phase 3 Workspace capabilities | Enforcement point for `reads`/`writes` |
| Phase 4 Decision Runtime | Sole Decision/Trace author; plugins feed Hypotheses |
| Phase 5 Policy Profiles | `allowedEngineIds`, budgets, gateMode, determinism gates |

No redesign of Phases 1–5 ownership is authorized by this document.

---

## 10. Explicit Non-Goals (this freeze)

- Implementing Phase 6 harness or fake Animation/AI engines  
- Real Layout/Semantic/Pattern product behavior  
- Process sandbox implementation details (OS-specific)  
- Network plugin marketplaces  
- Allowing plugins to own Policy or Emit  

---

## 11. Acceptance Criteria for Future Phase 6 Implementation

Phase 6 may claim compliance only when:

1. Full declaration schema matches §3  
2. Capability enforcement denies undeclared writes (including Decision monopoly)  
3. Crash isolation preserves Workspace / Decisions / Traces  
4. Lifecycle Load→…→Dispose is observable  
5. Compatibility checks reject suite/policy/determinism mismatches  
6. Fake proposer plugins cannot commit ResolvedIR or winners  
7. Nondeterministic plugins disabled under golden profiles  

---

## 12. Freeze Statement

This document **freezes** the Plugin Capability Contract architecture.

Amendments require explicit RFC/plan change — not silent implementation drift.

**Phase 6 is not started by this document.**

---

**End of Plugin Capability Contract (architecture freeze).**
