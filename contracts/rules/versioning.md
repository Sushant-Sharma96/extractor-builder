# Contract Suite Versioning Rules

**Suite:** compiler-contract-suite  
**Phase:** 1

## Version identity

- The suite uses **semver**: `MAJOR.MINOR.PATCH` (initial: `1.0.0`).
- `suite.json` `suiteVersion` is authoritative for the whole catalog.
- Individual schema files declare `"suiteVersion"` matching the suite when published together.

## What bumps what

| Change | Bump |
|--------|------|
| Add optional field; add question type; add IR stage with extension process | **MINOR** |
| Documentation-only / fixture-only clarifications that do not change validation | **PATCH** |
| Remove/rename required field; change enum meaning; change Decision status vocabulary incompatibly; change NodeRef rules incompatibly | **MAJOR** |

## Pinning

- Compile Job Fingerprint **must** record `contractSuiteVersion`.
- Golden corpus entries **must** pin the suite version they were authored against.

## Publication

- A suite release is atomic: all contracts in the catalog share one `suiteVersion`.
- Partial unpublished drafts must not be referenced by Kernel or goldens.
