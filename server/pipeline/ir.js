'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// IR v1 — FROZEN CONTRACT for the parallel v2 pipeline.
// Pure schema: enums, JSDoc typedefs, and a runtime validator. No dependency on
// v1 (build.js), no side effects. Every stage reads/writes this shape:
//   Capture++ → DG/VDG → BG → Generator → Verify
//
// Two contract guarantees (agreed):
//   • Addition 1 — every node records its Source of Truth (provenance.sourceOfTruth).
//   • Addition 2 — the Generator emits a Trace linking each output chunk → IR node(s);
//                  each node's provenance.locator links IR node → original source.
//   • IR is APPEND-ONLY per stage (a stage adds fields/nodes, never mutates prior output).
//   • Only "interesting" elements are tracked (those owning a rule/var/behavior/asset).
// ─────────────────────────────────────────────────────────────────────────────

// ir-1.1.0 — additive: `document` container (head-level material) so the Generator
// never re-reads the capture model for lang/title/meta/font-links/@font-face.
const SCHEMA_VERSION = 'ir-1.1.0';

// Addition 1 — authoritative origin of a node's information.
const SOURCE_OF_TRUTH = Object.freeze([
  'dom',            // rendered DOM structure / attributes / classes / text
  'css-rule',       // a compiled stylesheet rule (CSSOM)
  'inline-style',   // an element style="" attribute (first-class — see keyframe lesson)
  'computed-style', // getComputedStyle resolved value (a RESOLVER; never invents)
  'runtime',        // observed via probe (injected var, animation, behavior transition)
  'user-override',  // manual/admin override (reserved)
  'derived',        // synthesized by the pipeline (closure, fallback, var-completion)
]);

const DG_NODE_TYPES = Object.freeze(['Section', 'Element', 'CssRule', 'Variable', 'Keyframes', 'Font', 'Asset']);
const DG_EDGE_TYPES = Object.freeze(['contains', 'usesClass', 'matchedBy', 'usesVar', 'animates', 'loads', 'computedFont', 'fallbackTo', 'referencesVar', 'loadedVia']);
const BG_NODE_TYPES = Object.freeze(['Trigger', 'Controller', 'Region', 'Motion']);
const BG_EDGE_TYPES = Object.freeze(['controls', 'manages', 'affects', 'transitionsTo', 'animates', 'dependsOn']);
const MOTION_SYSTEMS = Object.freeze(['css-animation', 'css-transition', 'waapi', 'framer', 'gsap', 'lenis', 'scroll-timeline', 'intersection-observer', 'unknown']);
const FALLBACK_ACTIONS = Object.freeze(['generate', 'preserve', 'approximate', 'skip']);
const VAR_ORIGINS = Object.freeze(['static', 'runtime', 'unknown']);
const KF_USAGE = Object.freeze(['static-css', 'utility-class', 'runtime-applied', 'unresolved']);
const FONT_SOURCES = Object.freeze(['google', 'fontface', 'system', 'custom-nonGoogle']);

/**
 * @typedef {Object} Locator  Back-link to the ORIGINAL source.
 * @property {string}   [domPath]      dom / inline-style
 * @property {string}   [selector]     css-rule
 * @property {number|string} [sheet]   css-rule: stylesheet index or href
 * @property {string|null}   [media]   css-rule
 * @property {string}   [property]     computed-style
 * @property {string}   [viewport]     computed-style
 * @property {string}   [probe]        runtime: "click #id" | "scroll" | "load" | "hover"
 * @property {string[]} [fromNodeIds]  derived: IR nodes this was synthesized from
 * @property {string}   [by]           derived / user-override: which pass or actor
 */

/**
 * @typedef {Object} Provenance  Present on EVERY node.
 * @property {('dom'|'css-rule'|'inline-style'|'computed-style'|'runtime'|'user-override'|'derived')} sourceOfTruth
 * @property {string[]} contributing   other sources that informed it (may be empty)
 * @property {Locator}  locator
 * @property {number}   confidence     0..1
 * @property {string[]} signals
 */

/** @typedef {Object} Fallback @property {('generate'|'preserve'|'approximate'|'skip')} action @property {string} reason */

// DG nodes (each also has: id:string, type:<DG_NODE_TYPES>, provenance:Provenance)
/** @typedef {Object} Section   @property {string} key @property {string} label @property {string} tag @property {string[]} elementIds @property {{ruleIds:string[],varIds:string[],keyframeIds:string[],fontIds:string[],assetIds:string[]}} owns @property {('owned'|'shared')} scope */
/** @typedef {Object} Variable  @property {string} name @property {string} definedInScope @property {string} value @property {?string} computedValue @property {('static'|'runtime'|'unknown')} varOrigin @property {string[]} usesVars */
/** @typedef {Object} Keyframes @property {string} name @property {string} cssText @property {('static-css'|'utility-class'|'runtime-applied'|'unresolved')} usage */
// (CssRule, Element, Font, Asset per the schema table)

// BG nodes (each also has: id, type:<BG_NODE_TYPES>, provenance, and where relevant fallback:Fallback)
/** @typedef {Object} Controller @property {string} kind @property {Object} stateModel @property {*} initialState @property {Object} keyboard @property {Array} transitions @property {Fallback} [fallback] */
/** @typedef {Object} Motion     @property {('css-animation'|'css-transition'|'waapi'|'framer'|'gsap'|'lenis'|'scroll-timeline'|'intersection-observer'|'unknown')} system @property {string} trigger @property {string} targetRef @property {Object} params @property {boolean} reconstructable @property {Fallback} [fallback] */

/** @typedef {Object} Trace  Addition 2 — output → IR (node.provenance.locator → source).
 * @property {Array<{output:string,irNodeIds:string[]}>} html
 * @property {Array<{output:string,irNodeIds:string[]}>} css
 * @property {Array<{output:string,irNodeIds:string[]}>} js */

/**
 * @typedef {Object} DocumentHead  Head-level material (ir-1.1.0, additive).
 * @property {string}   lang
 * @property {string}   title
 * @property {string}   metaViewport
 * @property {string[]} fontLinks     Google/CDN <link> hrefs
 * @property {string[]} fontFaceCss   @font-face blocks (raw CSS)
 * @property {string}   [bodyClass]
 * @property {Object}   [htmlAttrs]
 */

/**
 * @typedef {Object} IR
 * @property {{url:string,capturedAt:string,pipelineVersion:string}} meta
 * @property {DocumentHead} [document]  head-level material (ir-1.1.0)
 * @property {Section[]} sections
 * @property {{nodes:Object[],edges:Object[]}} dependency  DG + VDG
 * @property {{nodes:Object[],edges:Object[]}} behavior    BG
 * @property {{warnings:string[],approximations:string[],skipped:string[],review:string[]}} report
 */

// ── Runtime validator ───────────────────────────────────────────────────────
function validateIR(ir) {
  const errors = [];
  const E = (m) => errors.push(m);
  if (!ir || typeof ir !== 'object') return { ok: false, errors: ['IR is not an object'] };
  if (!ir.meta || !ir.meta.url) E('meta.url missing');
  for (const g of ['dependency', 'behavior']) {
    if (!ir[g] || !Array.isArray(ir[g].nodes) || !Array.isArray(ir[g].edges)) E(`${g}.nodes/edges must be arrays`);
  }
  if (errors.length) return { ok: false, errors };

  const ids = new Set();
  const checkNode = (n, allowedTypes, kind) => {
    if (!n.id || typeof n.id !== 'string') { E(`${kind} node missing id`); return; }
    if (ids.has(n.id)) E(`duplicate node id: ${n.id}`);
    ids.add(n.id);
    if (!allowedTypes.includes(n.type)) E(`${kind} node ${n.id}: bad type "${n.type}"`);
    const p = n.provenance;
    if (!p || !SOURCE_OF_TRUTH.includes(p.sourceOfTruth)) E(`node ${n.id}: invalid provenance.sourceOfTruth`);
    else if (typeof p.confidence !== 'number' || p.confidence < 0 || p.confidence > 1) E(`node ${n.id}: confidence out of range`);
    if (n.type === 'Variable' && !VAR_ORIGINS.includes(n.varOrigin)) E(`Variable ${n.id}: bad varOrigin`);
    if (n.type === 'Keyframes' && n.usage && !KF_USAGE.includes(n.usage)) E(`Keyframes ${n.id}: bad usage`);
    if (n.type === 'Motion' && !MOTION_SYSTEMS.includes(n.system)) E(`Motion ${n.id}: bad system`);
    if (n.fallback && !FALLBACK_ACTIONS.includes(n.fallback.action)) E(`node ${n.id}: bad fallback.action`);
  };
  ir.dependency.nodes.forEach((n) => checkNode(n, DG_NODE_TYPES, 'DG'));
  ir.behavior.nodes.forEach((n) => checkNode(n, BG_NODE_TYPES, 'BG'));

  const checkEdges = (edges, allowed, kind) => edges.forEach((e, i) => {
    if (!allowed.includes(e.type)) E(`${kind} edge #${i}: bad type "${e.type}"`);
    if (!ids.has(e.from)) E(`${kind} edge #${i}: from "${e.from}" not a node`);
    if (!ids.has(e.to)) E(`${kind} edge #${i}: to "${e.to}" not a node`);
  });
  checkEdges(ir.dependency.edges, DG_EDGE_TYPES, 'DG');
  checkEdges(ir.behavior.edges, BG_EDGE_TYPES, 'BG');

  (ir.sections || []).forEach((s) => {
    const owns = s.owns || {};
    Object.values(owns).forEach((arr) => (arr || []).forEach((id) => { if (!ids.has(id)) E(`Section ${s.key}: owns unknown node ${id}`); }));
  });

  if (ir.document) {
    const d = ir.document;
    if (!Array.isArray(d.fontLinks)) E('document.fontLinks must be an array');
    if (!Array.isArray(d.fontFaceCss)) E('document.fontFaceCss must be an array');
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  SCHEMA_VERSION, SOURCE_OF_TRUTH, DG_NODE_TYPES, DG_EDGE_TYPES, BG_NODE_TYPES, BG_EDGE_TYPES,
  MOTION_SYSTEMS, FALLBACK_ACTIONS, VAR_ORIGINS, KF_USAGE, FONT_SOURCES, validateIR,
};
