# Compatibility Rules

**Suite:** compiler-contract-suite `@1.0.0`  
**Phase:** 1

## Additive evolution (default)

- New **optional** properties may be added in a MINOR release.
- Consumers **must ignore unknown properties** they do not understand.
- Producers **must not** require unknown-to-consumer fields for basic validity of older consumers (except after MAJOR).

## Breaking changes

Require **MAJOR** bump and migration notes:

- Removing a property
- Renaming a property
- Changing a property’s type or enum membership in an incompatible way
- Making an optional property required
- Changing Shared Node Identity rules incompatibly
- Narrowing Decision `status` or `winner` forms incompatibly

## `$schema` / contract id

- Each schema has a stable `contractId` string.
- `contractId` renames are MAJOR.

## Decision Record special rule (RFC-002)

- Decision Record schema evolution is **additive by default**.
- Status values `proposed | arbitrated | overridden | fallen-back | rejected` are normative for 1.x; removing any is MAJOR.
