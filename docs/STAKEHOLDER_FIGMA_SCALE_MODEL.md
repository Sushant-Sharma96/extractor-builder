# Product model — URL → HTML/CSS (scale for 100+ files)

| Field | Value |
|-------|--------|
| **Status** | Operating model (Standards Promotion + dual-path) |
| **User promise** | Paste Figma URL → get HTML + CSS (always) |
| **QA bar (shippable)** | **flex / grid** layout regions — not page-level `position: absolute` |
| **Path B role** | Internal **fidelity oracle** + eng `emitMode=pixel` preview only |
| **Internal goal** | Best-effort quality without per-section hand fixes |

---

## 1. User flow (does not change)

```text
User pastes Figma URL  →  Generate  →  HTML + CSS (+ preview)
```

- No user-facing pixel/standard mode picker (product uses **`auto`** only).  
- No “gate failed → empty response.”  
- Internal eng may pass `emitMode=pixel` (absolute oracle) or `standard` for tooling.

**One line:** Same simple product; smarter pipeline underneath.

---

## 2. What happens inside (invisible to basic user)

```text
URL
 → fetch / cache Figma
 → classify alCoverage per subtree
 → Path A (AL): native flex
 → freeform: unlock → Standards Promotion Engine
      detect regions (header / cards / banner)
      promote to flex/grid + hover stamps
      oracle vs fidelity (qaReady)
 → Path B seal only for unresolved leftovers / pixel preview
 → always emit HTML + CSS
 → scorecard (qaReady, promoted regions)
 → preview / download
```

| Internal choice | User / QA gets |
|-----------------|----------------|
| Path A (Auto Layout) | Flex/grid HTML/CSS |
| Standards Promotion (freeform) | Flex/grid regions when detectors succeed — **QA shippable** |
| `emitMode=pixel` | Scaled absolute (eng fidelity oracle — **not** QA deliverable) |
| Unresolved freeform | Path B island + `qaRisk` / oracle fail on scorecard |

### Why Path B still exists (not the product)

IBM Lifecycle and similar freeform frames need a **pixel-true snapshot** so flex promotion can be checked. Path B (`.et-path-b` + `scale()`) is that oracle. **QA rejects page-level absolute** — product `auto` must promote layout regions to flex/grid.

### Path B composition contract (oracle / pixel only)

A Path B subtree is a **fixed-aspect, intrinsic-sized block** (`.et-path-b` + `.et-path-b__stage`). Inside: absolute at native Figma size; CSS `transform: scale(100cqw / nativeWidth)`.

### `alCoverage` (calibrated)

`layout-bearing` = container with ≥2 layout-participating visible children.  
`alCoverage = (# AL layout-bearing) / (# layout-bearing)` (0 if none → promote via Standards Engine).  
Threshold = `FIGMA_AL_COVERAGE_THRESHOLD` (default **0.8**).

---

## 3. Quality scorecard (every convert)

| Field | Meaning |
|-------|---------|
| `alwaysReturnsHtmlCss: true` | Contract: you always get code |
| `qaReady` | Standards engine: layout regions promoted; root not Path B |
| `grade` | A / B / C |
| `productionReady` | `qaReady` **or** pure Path A (AL coverage + no demote) |
| `standards.regions[]` | Promoted header / cards / banner |
| `routeA` / `routeB` / `alCoverageAvg` | Dual-path summary |
| `demoteReasons[]` | Per-subtree `{ code, message, name }` |
| `warnings[]` | STANDARDS_PROMOTION, DUAL_PATH_B, etc. |

---

## 4. How this scales

| Do once in pipeline | Effect on all URLs |
|---------------------|--------------------|
| Standards Promotion Engine | Freeform → flex/grid when regions detected |
| Path B fidelity oracle | Visual check without shipping absolute to QA |
| Scorecard `qaReady` | Stakeholders see pass/fail without DevTools |
| Designer Auto Layout | Highest Path A rate long-term |

**Build vs buy:** No React library converts absolute → flex. Locofy/Anima are full products, not embeddable engines. We **build** the Standards Engine on our fidelity tree.

LLM never in the compile path.
