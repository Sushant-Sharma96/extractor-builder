# Backlog

## Snapshot / request lifecycle (Figma offline cache)

**Status:** Documented only — do **not** implement until Figma verification is possible and explicitly approved.

**Context (2026-07-18):** An aborted client Generate on `:3002` left `saveSnapshotAtomic` running server-side. The temp dir kept downloading CDN fills for a long time; `metadata.json` / final rename never ran. Orphan `.tmp-*` dirs are not loadable as CACHE HIT. Rate-limited `refresh=true` failed before save and did not finalize a snapshot.

### Items (no implementation yet)

| ID | Item | Problem | Intended direction (when approved) |
|----|------|---------|--------------------------------------|
| SL-1 | **AbortController** | Long REST / CDN work has no shared cancel signal tied to the HTTP request. | Thread an `AbortSignal` through `figmaGet`, image export, SVG fetch, and `downloadToFile` / `saveSnapshotAtomic`. |
| SL-2 | **Request cancellation** | Client disconnect / abort does not stop the Express `/api/figma/convert` handler; work continues in the background. | On `req` close/abort, abort the signal and short-circuit convert + snapshot save. |
| SL-3 | **Temp cleanup** | On failure, `rmrf(tmpDir)` can fail silently; interrupted saves leave `.tmp-{pid}-{ts}` dirs. | Always remove incomplete temp on abort/error; log cleanup failures; never promote unvalidated temp. |
| SL-4 | **Orphan snapshot cleanup** | Leftover `.tmp-*` (and possibly `.old-*`) accumulate under `output/figma-cache` and confuse investigation. | Startup or periodic sweep: delete orphan temps older than N minutes / not owned by a live pid; never delete a validated final snapshot without explicit refresh. |
| SL-5 | **Background download cancellation** | Fill/PNG CDN downloads inside `saveSnapshotAtomic` continue after the client is gone, burning time and disk. | Honor AbortSignal in download loops; stop enqueueing further assets; clean temp when cancelled mid-save. |

### Explicit non-goals (for now)

- No code changes for the items above until Figma verification can run (usable token / rate limit cleared) and review approves implementation.
- Do not treat incomplete temp or legacy `.figma-cache/*.json` as CACHE HIT without a separate, approved migration design.

### Resume when

Figma verification becomes possible → finish offline HIT/MISS verification first → then revisit this backlog for implementation approval.
