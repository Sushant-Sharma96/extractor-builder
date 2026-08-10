#!/usr/bin/env node
'use strict';

/**
 * Phase 0 of docs/COMPILER_REDESIGN_ROADMAP.md — a static analysis that
 * cross-references every field NDG's ingest.js captures against every
 * read-site across the active render path (compiler/artifacts + compiler/
 * emit). Exists to catch the "ingested but never emitted" bug class
 * mechanically, at build/CI time, instead of a human noticing a rendered
 * discrepancy (this exact pattern shipped 3 separate bugs in one session:
 * gradient text, object-fit, box-shadow — all found only by inspection).
 *
 * A field with zero references outside ndg/ is not necessarily a bug — it
 * may be genuinely structural-only (consumed by ndg/build.js's collapse
 * logic, never meant to reach a CSS declaration). Those are named in
 * STRUCTURAL_ONLY below with a reason; anything NOT in that list with zero
 * references is flagged as a real gap.
 *
 * Usage: node scripts/verify-ingest-consumption.js
 * Exit code 0 if every field is either consumed or allowlisted; 1 otherwise.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const INGEST_FILE = path.join(REPO_ROOT, 'compiler/ndg/ingest.js');
// Every subsystem that legitimately reads a WorkingNode field somewhere in
// the real pipeline — not just the final render path. A field consumed only
// by, say, compiler/layout/interpret.js (turning a raw fact into a derived
// one) still counts as "consumed" for THIS check's purposes: this script
// answers "is this raw field read by anything at all," a narrower and
// different question from "does its semantic intent reach final CSS" (that
// second, stronger invariant — e.g. the interp.sizing bug, Research Part
// 9.0 — is checked at runtime by Phase 11's verifyIR(), not here).
const CONSUMER_DIRS = [
  'compiler/artifacts',
  'compiler/emit',
  'compiler/layout',
  'compiler/skeleton',
  'compiler/geometry',
  'compiler/freeform-layout',
  'compiler/components',
  'compiler/tokens',
  'compiler/responsive',
  'compiler/rulepack',
  'compiler/features',
  'compiler/workspace',
].map((d) => path.join(REPO_ROOT, d));

// Fields with a confirmed, deliberate reason for having no reader outside
// ndg/ today. Each entry names the actual consumer (if any) and why it's
// not expected to reach compiler/artifacts or compiler/emit.
const STRUCTURAL_ONLY = {
  isMask: 'ndg/build.js hasPaintSignal()/skeleton — protects mask shapes from structural collapse; not yet a visual mask-image/clip-path emitter (Roadmap Section 6.5, HIGH priority gap, tracked separately, not a silent bug)',
  maskType: 'same as isMask',
  rectangleCornerRadii: 'ndg/build.js hasPaintSignal() — collapse-eligibility signal only (Roadmap Section 6.3, HIGH priority gap, tracked separately)',
  cornerSmoothing: 'no CSS primitive exists (Roadmap Section 6.3) — intentionally not a codegen target',
  strokeCap: 'only meaningful for SVG path strokes, not plain CSS borders (Roadmap Section 6.2) — real consumer, if any, is the SVG reconstruction path in server/figma-generate.js, outside this script\'s scope',
  strokeJoin: 'same as strokeCap',
  relativeTransform: 'zero confirmed real occurrences in this project\'s corpus to date (Roadmap Section 6.6) — captured for the next 1,000 files, not yet consumed anywhere',
  componentPropertyDefinitions: 'consumed by compiler/components/detect.js (Phase 12 Component IR), a different subsystem than compiler/artifacts/emit',
  styles: 'raw style-reference IDs, not yet consumed by any subsystem',
  boundVariables: 'consumed by compiler/tokens/detect.js (Phase 13 token detection), a different subsystem than compiler/artifacts/emit',
  overrides: 'consumed by compiler/components/detect.js, a different subsystem than compiler/artifacts/emit',
  variantProperties: 'consumed by compiler/components/detect.js, a different subsystem than compiler/artifacts/emit',
  componentProperties: 'consumed by compiler/components/detect.js, a different subsystem than compiler/artifacts/emit',
  mainComponent: 'legacy alias of mainComponentId, kept for shape compatibility only',
  childSourceIds: 'NDG-internal tree-linking only (confirmed: referenced solely within compiler/ndg/{build,ingest,publish}.js) — republished under different field names for external consumers',
  parentSourceId: 'same as childSourceIds',
  layoutSizingHorizontal: 'consumed via DYNAMIC property access (`a[directKey]`) in layout/interpret.js\'s sizingAxis() — verified by hand; this script\'s regex-based check cannot see dynamic keys, a known limitation, not a real gap',
  layoutSizingVertical: 'same as layoutSizingHorizontal',
};

// Real, currently-open gaps this project's own roadmap already tracks and
// intends to close in a specific future phase — distinct from
// STRUCTURAL_ONLY (which means "this is fine, no work needed ever"). Listed
// here so the lint report doesn't fail CI on work that's already scheduled,
// while still surfacing it (not silently swept away) until it actually ships.
const KNOWN_GAP = {
  primaryAxisAlignItems: 'docs/COMPILER_REDESIGN_ROADMAP.md Phase 4 (Semantic Resolution) — resolves to real justify-content/align-items',
  counterAxisAlignItems: 'same — Phase 4',
  layoutWrap: 'same — Phase 4 (flex-wrap)',
  layoutGrow: 'same — Phase 4 (flex-grow)',
  layoutAlign: 'same — Phase 4 (align-self)',
  primaryAxisSizingMode: 'same — Phase 4/5 (container sizing mode, distinct from per-child layoutSizingHorizontal/Vertical)',
  counterAxisSizingMode: 'same — Phase 4/5',
  renderBox: 'docs/COMPILER_REDESIGN_ROADMAP.md Phase 5.5 (Visual/Paint Resolution) — the effects-inclusive bounding box needed once shadow/blur effects can bleed past a node\'s own geometry',
};

function extractFieldNames(source) {
  // Pragmatic regex-based extraction, not a full AST parse (matches this
  // script's own stated scope: "pure static analysis", no fixtures, no
  // parser dependency). Matches `fieldName: ` at any indentation inside
  // workingNodeFromRaw's returned object literal.
  const names = new Set();
  const re = /^\s*(\w+):\s/gm;
  let m;
  // Only scan the workingNodeFromRaw function body, not the whole file
  // (avoids picking up unrelated identifiers from other functions).
  const fnStart = source.indexOf('function workingNodeFromRaw');
  const fnEnd = source.indexOf('\nfunction ingestTreeDocument');
  const body = source.slice(fnStart, fnEnd > fnStart ? fnEnd : undefined);
  while ((m = re.exec(body))) {
    const name = m[1];
    // Skip JS keywords/control-flow tokens a naive regex can pick up.
    if (['if', 'return', 'function', 'const', 'let'].includes(name)) continue;
    names.add(name);
  }
  return [...names].sort();
}

function listJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function countReferences(fieldName, files) {
  // Matches `.fieldName` (property access) or `['fieldName']`/`["fieldName"]`
  // (bracket access) — the two real ways JS reads an object field.
  const re = new RegExp(`\\.${fieldName}\\b|\\[['"]${fieldName}['"]\\]`, 'g');
  let count = 0;
  const hits = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const matches = text.match(re);
    if (matches && matches.length) {
      count += matches.length;
      hits.push(`${path.relative(REPO_ROOT, file)} (${matches.length})`);
    }
  }
  return { count, hits };
}

function main() {
  const source = fs.readFileSync(INGEST_FILE, 'utf8');
  const fields = extractFieldNames(source);
  const consumerFiles = CONSUMER_DIRS.flatMap(listJsFiles);

  const unconsumed = [];
  const knownGaps = [];
  const consumed = [];

  for (const field of fields) {
    const { count, hits } = countReferences(field, consumerFiles);
    if (count > 0) {
      consumed.push({ field, count, hits });
    } else if (STRUCTURAL_ONLY[field]) {
      consumed.push({ field, count: 0, hits: [`(allowlisted: ${STRUCTURAL_ONLY[field]})`] });
    } else if (KNOWN_GAP[field]) {
      knownGaps.push({ field, reason: KNOWN_GAP[field] });
    } else {
      unconsumed.push(field);
    }
  }

  console.log(`Scanned ${fields.length} fields from ingest.js's workingNodeFromRaw() against ${consumerFiles.length} files across ${CONSUMER_DIRS.length} subsystems.\n`);

  if (knownGaps.length) {
    console.log(`${knownGaps.length} field(s) are known, roadmap-tracked gaps (not failing CI, but not yet closed):\n`);
    for (const { field, reason } of knownGaps) {
      console.log(`  - ${field}: ${reason}`);
    }
    console.log('');
  }

  if (unconsumed.length) {
    console.log(`FAIL — ${unconsumed.length} field(s) ingested but never read anywhere, with NO documented reason and NOT on the roadmap:\n`);
    for (const field of unconsumed) {
      console.log(`  - ${field}`);
    }
    console.log('\nEither wire this field in, add it to STRUCTURAL_ONLY with a reason, or add it to KNOWN_GAP with a roadmap phase reference.');
    process.exitCode = 1;
  } else {
    console.log(`PASS — every ingested field is either consumed, has a documented structural-only reason, or is an already-tracked roadmap gap.`);
    process.exitCode = 0;
  }

  console.log(`\n${consumed.length} consumed/allowlisted, ${knownGaps.length} known gap(s), ${unconsumed.length} NEW unexplained field(s).`);
}

main();
