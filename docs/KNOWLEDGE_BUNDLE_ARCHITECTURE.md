# Knowledge Bundle Architecture

| Field | Value |
|-------|--------|
| **Status** | **Frozen architecture** — awaiting Phase 7 implementation |
| **Date** | 2026-07-18 |
| **Authority** | RFC-002 §3–§4; IMPLEMENTATION_MASTER_PLAN Phase 7; PLUGIN_CAPABILITY_CONTRACT.md; Phases 1–6 spine |
| **Non-goals of this document** | Code, loaders, rules, reasoning, AI, Layout, Semantic, Pattern matching engines, Phase 7 implementation |

---

## 1. Purpose

Externalize **reusable UI ontology** as a versioned, immutable, queryable artifact: the **Knowledge Bundle** (`K@semver`).

Knowledge supplies **typed reusable facts** (pattern identities, relations, priors, obligations, emit *hints*) that plugins may **consult**.

Knowledge does **not** think, rank, score, arbitrate, or commit.

---

## 2. Architectural Placement

```text
Knowledge Bundle (immutable, versioned)
        │
        ▼  Kernel loads / pins / fingerprints
   Knowledge Registry (read-only views)
        │
        ▼  capability-scoped handle
   Plugins (Phase 6) ──► Hypotheses / Evidence / Candidates into Workspace
        │
        ▼
   Decision Runtime ──► sole Decision + Trace committer
```

| Actor | Role toward Knowledge |
|-------|------------------------|
| **Kernel** | Load, validate, pin, fingerprint, dispose; never interpret patterns |
| **Knowledge Registry** | Address entries by id; enforce immutability and isolation |
| **Plugins** | Consume read-only knowledge views under declared `requiredCapabilities` / reads |
| **Workspace** | Does **not** store the bundle; may store *derived* Facts/Hypotheses that *cite* knowledge ids |
| **Decision Runtime** | May see knowledge ids only as **evidence refs** on Candidates — never loads or mutates bundles |
| **Policy** | May enable/disable packs, cap name-only confidence, select profile-specific hint tables |

---

## 3. Absolute Prohibitions (frozen)

Knowledge **never**:

| Forbidden | Rationale |
|-----------|-----------|
| Ranks candidates | Decision Runtime owns ranking |
| Scores hypotheses (job-global) | Confidence Engine / Runtime; plugins may attach *local* scores when proposing, not Knowledge |
| Arbitrates / chooses winners | Decision Runtime monopoly |
| Commits `DecisionRecord` / `DecisionTrace` | Runtime monopoly |
| Mutates Workspace directly | Plugins write under capabilities; Knowledge is read-only data |
| Bypasses plugins | No Kernel→Workspace writes from Knowledge |
| Bypasses Runtime | No ResolvedIR / winner commits from Knowledge |
| Embeds customer-specific CSS recipes | Not reusable ontology |
| Encodes undocumented tribal emit rules | Must be Decisions or explicit Policy |

---

## 4. Knowledge Bundle Format

### 4.1 Logical package identity

```text
KnowledgeBundle {
  contractId: "KnowledgeBundle"
  bundleId: string                 // stable name, e.g. "compiler-ui-ontology"
  version: semver                  // K@1.2.3 → version "1.2.3"
  suiteVersion: string             // Phase 1 contract suite compatibility
  createdAt: string                // provenance (ISO), informational
  description: string?
  layers: KnowledgeLayer[]         // ordered composition (§12)
  dependencies: BundleDependency[] // (§10)
  entries: KnowledgeEntry[]        // addressable units
  relations: KnowledgeRelation[]   // graph edges
  packs: PackRef[]                 // logical pack ids (rules attach later — Phase 8)
  priors: PriorEntry[]             // optional statistical priors
  checksum: string?                // content hash of canonical serialization
}
```

### 4.2 Entry kinds (logical catalog — content deferred)

| Kind | Purpose |
|------|---------|
| `pattern` | Named UI pattern identity + aliases + conflict/obligation *hooks* |
| `motif` | Structural motif (repeated peer, equal gap, …) |
| `obligation` | Semantic / a11y obligation templates |
| `emit_hint` | Default tag/role *hints* per policy profile (never auto-commit) |
| `negative_pattern` | Explicit “not X” guidance for proposers |
| `prior` | Corpus-derived base rate (optional) |
| `feature_def` | Named evidence feature ids shared across packs |

### 4.3 Pattern entry (logical shape)

Aligned with RFC-002 §3.3 — **declarative only**:

```text
PatternEntry {
  entryId: "pattern:navigation.bar"
  kind: "pattern"
  aliases: string[]
  matcherRefs: string[]          // ids of rules/matchers — not executable here
  requiredEvidence: string[]
  optionalEvidence: string[]
  conflictsWith: string[]        // other entryIds
  obligations: string[]          // obligation entryIds
  emitHintsByPolicy: { [profileId]: EmitHint }
  priorRef: string?              // prior entryId
  examples: { corpusId: string }[]
}
```

**Matchers are references**, not executed by the Knowledge layer. Execution belongs to future Rule/Pattern engines (Phases 8–9) running as **plugins**.

### 4.4 Relation edges

```text
KnowledgeRelation {
  from: entryId
  to: entryId
  type: "specializes" | "contains" | "requires" | "conflicts" | "suggests"
}
```

---

## 5. Bundle Versioning

| Rule | Statement |
|------|-----------|
| Identity | `bundleId` + `version` (semver) uniquely identify a freeze |
| Notation | `K@major.minor.patch` (e.g. `K@1.0.0`) |
| Immutability | Published `(bundleId, version)` **never** mutates; edits ⇒ new version |
| Compatibility | `suiteVersion` must be compatible with job contract suite |
| Breaking changes | Major bump when entry ids removed/renamed or relation semantics change |
| Additive | Minor/patch for new entries, priors, non-breaking hints |

---

## 6. Bundle Fingerprint Participation

Compile job fingerprint **already** has `knowledgeBundleVersion` (Phase 2 slot).

### 6.1 Required fingerprint fields (logical)

```text
fingerprint.knowledgeBundleId
fingerprint.knowledgeBundleVersion
fingerprint.knowledgeChecksum?     // optional strict goldens
```

### 6.2 Determinism rule

Same inputs + same Policy + same plugins + same **pinned Knowledge Bundle version** ⇒ same Decisions  
(for pure/seeded plugin set).

### 6.3 Drift policy

| Mode | Behavior |
|------|----------|
| **Pin required** (goldens / release) | Missing or mismatched `K@version` → fail-closed |
| **Best-effort** | Warn in QualityReport; continue only if Policy allows |

Kernel records the pin; Knowledge does not self-fingerprint.

---

## 7. Bundle Lifecycle

```text
Discover → Load → Validate → Register → Pin → Serve → Dispose
```

| Phase | Owner | Meaning |
|-------|-------|---------|
| **Discover** | Kernel / host | Locate bundle artifact (path, registry uri) — *not specified as code here* |
| **Load** | Loader (Phase 7 impl) | Parse canonical serialization into memory |
| **Validate** | Validator | Schema, checksum, deps, suite compatibility, immutability seals |
| **Register** | Knowledge Registry | Index by `entryId`; freeze views |
| **Pin** | Kernel job bind | Attach exact `K@version` to job + fingerprint |
| **Serve** | Registry | Read-only queries to authorized plugins |
| **Dispose** | Kernel | Drop job-scoped handles; global registry may retain immutable cache |

No “Execute” or “Commit” phase for Knowledge — it is not an engine.

---

## 8. Loader (architectural role only)

The **Loader**:

- Accepts a bundle URI / bytes / package path  
- Produces a validated immutable `KnowledgeBundle` object  
- Resolves **dependencies** and **layers** into a composed view (§10–§12)  
- Refuses partial loads when `pin required`  

The Loader **does not**:

- Run matchers  
- Write Workspace  
- Call Decision Runtime  
- Apply Policy thresholds  

*Implementation deferred to Phase 7. This document freezes the role only.*

---

## 9. Registry

### 9.1 Responsibilities

| Operation | Meaning |
|-----------|---------|
| `register(bundle)` | Accept validated immutable bundle |
| `get(bundleId, version)` | Exact pin retrieval |
| `resolve(entryId)` | Lookup entry in **pinned** composed view for a job |
| `list(kind?)` | Enumerate entry ids |
| `relations(entryId)` | Outgoing/incoming edges |
| `checksum(bundle)` | Return content hash |

### 9.2 Job-scoped view

Each job receives a **pinned snapshot handle**:

```text
KnowledgeHandle {
  bundleId, version, checksum
  get(entryId) → frozen entry | null
  query(kind, filter?) → frozen entries
  // no put / no mutate / no Workspace
}
```

Plugins never receive a mutable registry or another job’s handle.

---

## 10. Compatibility

| Axis | Rule |
|------|------|
| **Contract suite** | `bundle.suiteVersion` compatible with job `contractSuiteVersion` |
| **Compiler / Kernel** | Optional `minCompilerVersion` / `maxCompilerVersion` on bundle manifest |
| **Policy** | Entries/hints may be filtered by `profileId`; forbidden packs disabled |
| **Plugins** | Plugin `requiredCapabilities` may include `knowledge:K@semver` or `knowledge:entry:*` |
| **Dependencies** | Dependent bundles must resolve to compatible versions (§11) |

Incompatibility → reject pin (fail-closed under golden Policy) or disable knowledge for job.

---

## 11. Bundle Dependencies

```text
BundleDependency {
  bundleId: string
  versionRange: semver-range    // e.g. "^1.0.0"
  required: boolean
}
```

| Rule | Statement |
|------|-----------|
| Resolution | Loader selects a single concrete version per `bundleId` |
| Diamond | Same `bundleId` must converge to one version; conflict → fail load |
| Transitive | Dependencies of dependencies loaded; cycles → reject |
| Optional | `required: false` may omit with QualityReport warning |

---

## 12. Bundle Layering & Composition

### 12.1 Layers

Bundles compose as **ordered layers** (low → high precedence):

```text
base ontology
  → domain pack (marketing | app | …)
    → org overlay
      → job overlay (rare; explicit)
```

### 12.2 Composition merge

| Artifact | Merge rule |
|----------|------------|
| Entries by `entryId` | Higher layer **overrides** lower (replace, not field-patch, unless entry declares `merge: deep`) |
| Relations | Union; conflicting `conflicts` edges preserved |
| Priors | Higher layer replaces prior for same `entryId` |
| Packs | Union of pack refs; Policy may disable |

Composed result is a **new immutable view** with derived checksum — base bundles remain unchanged.

### 12.3 Isolation of composition

Composition happens in the Loader/Registry **before** Serve. Plugins see only the pinned composed view, not sibling jobs’ overlays.

---

## 13. Provenance

Every bundle and every served view carries provenance:

```text
KnowledgeProvenance {
  bundleId, version, checksum
  sourceUri?
  loadedAt
  composedFrom: { bundleId, version, checksum }[]
  policyProfileId?          // if hints filtered
  jobId?                    // when pinned to job
}
```

Workspace Hypotheses/Evidence that cite knowledge **should** record:

```text
evidence.ref = "knowledge:pattern:navigation.bar@K1.0.0"
```

ProvenanceBundle (Phase 1 contract) may later bind Decisions → knowledge entry ids — **writers are plugins/Runtime**, not Knowledge itself.

---

## 14. Bundle Validation

Validation gates (logical):

1. Manifest required fields present  
2. Semver well-formed  
3. `suiteVersion` known/compatible  
4. All `entryId` unique within composed view  
5. Relation endpoints resolve  
6. `creates`/`conflicts` ids exist  
7. Checksum matches canonical bytes (when provided)  
8. No Decision/Trace write claims (Knowledge has no write surface)  
9. Dependency graph acyclic and resolvable  
10. No forbidden ontology hardcoding as executable code blobs  

Failure → reject Register/Pin.

---

## 15. Bundle Immutability

| Guarantee | Statement |
|-----------|-----------|
| Byte immutability | Published version bytes never change |
| Object immutability | In-memory entries deep-frozen after Validate |
| No Workspace back-channel | Knowledge APIs are get/query only |
| Cache safety | Registry may cache by `(bundleId, version, checksum)` |

Hot-edit of a loaded bundle is **architecturally illegal**. Upgrade = new version + new pin.

---

## 16. Bundle Isolation

| Boundary | Rule |
|----------|------|
| Job A vs Job B | Distinct pins/handles; no shared mutable view |
| Plugin vs Plugin | Read-only; no private knowledge mutation |
| Knowledge vs Workspace | Separate stores; citations by id only |
| Knowledge vs Runtime | Runtime never imports Loader; only sees evidence refs on records |
| Multi-tenant process | Prefer checksum-addressed immutable cache; never job-mutable globals |

---

## 17. Bundle Upgrade Strategy

| Strategy | When |
|----------|------|
| **Pin exact** | Goldens, release gates, customer repro |
| **Range allow** | Dev jobs with Policy `knowledgeUpgrade: minor` |
| **Fail on major** | Default for production profiles |
| **Shadow compare** | Optional: run job under K@n and K@n+1; compare Decision diffs off hot path |
| **Rollback** | Re-pin previous `K@version`; disable new entry ids; packs that require missing entries no-op |

Upgrades never silently rewrite historical Decision corpora — corpora declare the `K@version` they were minted under.

---

## 18. How Plugins Consume Knowledge

### 18.1 Declaration

Plugins that need knowledge declare, for example:

```text
requiredCapabilities: ["knowledge:read"]
consumes: ["knowledge:pattern:*", "knowledge:motif:*"]
```

Policy / Kernel grants a **KnowledgeHandle** into the plugin execution context (alongside scoped Workspace), **read-only**.

### 18.2 Allowed consumption pattern

```text
Plugin Execute
  → knowledge.get("pattern:…") / query
  → combine with Workspace Facts (capability-scoped)
  → write Hypothesis / Evidence / Candidates citing knowledge ids
  → Commit to Workspace (plugin lifecycle)
Decision Runtime
  → ranks / arbitrates / commits Decision + Trace
```

### 18.3 Forbidden consumption pattern

```text
Knowledge → putDecision
Knowledge → mutate Fact
Plugin → mutate Knowledge entry
Plugin → treat emit_hint as committed winner without Runtime
```

### 18.4 Capability alignment

- Missing knowledge capability → Kernel denies handle injection  
- Undeclared knowledge read → deny (same spirit as Workspace undeclared read)  
- Knowledge does not expand plugin `writes`  

---

## 19. Relationship to Later Phases

| Phase | Uses Knowledge as |
|-------|-------------------|
| **7** | Format, loader, registry, pin, fingerprint (minimal/empty bundle OK) |
| **8** | Rule packs reference `matcherRefs` / pattern ids |
| **9+** | Pattern recognition plugins query motifs/patterns; still Candidates only |
| Emit | May read `emit_hint` **after** Decisions — hints never replace Decisions |

---

## 20. Explicit Non-Goals (this freeze)

- Implementing Loader / Registry code  
- Rule Engine or pack execution  
- Pattern matching algorithms  
- Layout / Semantic / AI engines  
- Populating production pattern libraries  
- Changing Phases 1–6 ownership  

---

## 21. Acceptance Criteria for Future Phase 7

Phase 7 may claim compliance only when:

1. Bundle format matches §4 (even if entries empty)  
2. Version pin appears in job fingerprint  
3. Registry serves frozen read-only handles  
4. Validation rejects corrupt / incompatible bundles  
5. Plugins can obtain knowledge only via scoped handle  
6. Knowledge cannot write Workspace or Decisions  
7. Suites 1–6 remain green  

---

## 22. Freeze Statement

This document **freezes** the Knowledge Bundle Architecture.

Amendments require explicit RFC/plan change — not silent implementation drift.

**Phase 7 is not started by this document.**

---

**End of Knowledge Bundle Architecture (architecture freeze).**
