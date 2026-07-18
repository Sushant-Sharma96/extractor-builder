'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// ISOLATED, FLAG-GATED enhancer — enable with env LOVABLE_VAR_COMPLETION=1.
//
// Purpose: fix dangling CSS custom properties. Some `var(--x)` references survive
// in the generated CSS while their DEFINITION was dropped (or never captured),
// which silently breaks typography/body (e.g. --default-font-family). This module
// RESTORES those definitions using the value the ORIGINAL site defined
// (model.rootCss) — the real source of truth.
//
// Safety contract:
//   • ADDITIVE ONLY — appends a scoped :where(.et-scope){…} block; never edits or
//     removes an existing rule/declaration.
//   • Does NOT touch build.js; runs as a post-processor.
//   • Flag OFF (default) ⇒ never invoked ⇒ byte-for-byte identical output.
// ─────────────────────────────────────────────────────────────────────────────

const DEF_RE = /(?:^|[;{]\s*)(--[A-Za-z0-9_-]+)\s*:\s*([^;}]+)/g;
const USE_RE = /var\(\s*(--[A-Za-z0-9_-]+)\s*(,?)/g;

function collectDefs(css, into) {
  DEF_RE.lastIndex = 0;
  let m;
  while ((m = DEF_RE.exec(css || ''))) if (!into.has(m[1])) into.set(m[1], m[2].trim());
  return into;
}

// { globalCss, sections:[{css}], rootCss } → { globalCss, restored[], warnings[], danglingCount }
function completeVars({ globalCss = '', sections = [], rootCss = '' }) {
  const sourceDefs = collectDefs(rootCss, new Map());              // original site's values (truth)
  const outDefs = collectDefs(globalCss, new Map());              // already defined in output
  sections.forEach((s) => collectDefs(s.css || '', outDefs));
  const allUsedCss = globalCss + '\n' + sections.map((s) => s.css || '').join('\n');

  const usedNoFallback = new Set();
  const usedAll = new Set();
  USE_RE.lastIndex = 0;
  let u;
  while ((u = USE_RE.exec(allUsedCss))) { usedAll.add(u[1]); if (!u[2]) usedNoFallback.add(u[1]); }

  const dangling = [...usedAll].filter((v) => !outDefs.has(v));
  const restored = [];        // [name, value]
  const warnings = [];        // referenced, no fallback, and not recoverable
  const seen = new Set();
  for (const v of dangling) {
    if (sourceDefs.has(v)) { restored.push([v, sourceDefs.get(v)]); seen.add(v); }
    else if (usedNoFallback.has(v)) warnings.push(v);
  }
  // transitively pull in any source-defined vars the restored values reference
  for (let i = 0; i < restored.length; i++) {
    const re = /var\(\s*(--[A-Za-z0-9_-]+)/g; let mm;
    while ((mm = re.exec(restored[i][1]))) {
      const dep = mm[1];
      if (!outDefs.has(dep) && !seen.has(dep) && sourceDefs.has(dep)) { seen.add(dep); restored.push([dep, sourceDefs.get(dep)]); }
    }
  }

  let out = globalCss;
  if (restored.length) {
    out += `\n/* --- var-completion: restored ${restored.length} referenced-but-missing definition(s) --- */\n`
      + `:where(.et-scope) {\n${restored.map(([p, val]) => `  ${p}: ${val};`).join('\n')}\n}\n`;
  }
  return { globalCss: out, restored: restored.map(([p]) => p), warnings, danglingCount: dangling.length };
}

module.exports = { completeVars };
