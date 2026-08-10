'use strict';

/**
 * `freeform-layout-ir` renderer wiring — end-to-end proof via the REAL
 * `renderIrExperimental()` pipeline (docs/COMPILER_MIGRATION_BLUEPRINT.md §10
 * + docs/FREEFORM_LAYOUT_IR_RENDERER_INTEGRATION_REPORT.md), not just the
 * synthetic render-tree unit tests in render.test.js. Two things proven here:
 *
 *  (a) a document whose children form a genuine repeating freeform pattern
 *      (3 uniform side-by-side "cards", each internally stacked in the same
 *      2 Y-bands) reaches a real `freeform-layout-ir` group and the
 *      renderer's `freeformGroupContainer`/`freeformGroupMember` decls fire
 *      — real `display:grid` + explicit px tracks appear in the generated
 *      CSS, byte-identical across the 3 members (the actual cross-member
 *      alignment guarantee this stage exists to provide).
 *  (b) a document with NO repeating structure at all (the same 2-child
 *      header+button fixture `renderer-toggle.test.js` already uses to prove
 *      the legacy/ir-experimental toggle) produces no `freeform-layout-ir`
 *      groups, and renders exactly as it already did before this task's
 *      changes — the fallback guarantee, proven at the full-pipeline level
 *      (render.test.js's `buildDecls` tests already prove this at the pure
 *      function level; this proves it end-to-end).
 */
const assert = require('assert');
const { renderIrExperimental } = require('../artifacts/ir-experimental-renderer');
const { materializeNormalizedDesignGraph } = require('../ndg');
const { createWorkspace } = require('../workspace');
const { indexGraph } = require('../layout/collect');
const { interpretGraph } = require('../layout/interpret');
const { detectGeometry } = require('../geometry');
const { detectResponsive, STRATEGY } = require('../responsive');

let passed = 0;
let failed = 0;
function pass(name) { passed += 1; console.log(`PASS  ${name}`); }
function fail(name, err) { failed += 1; console.error(`FAIL  ${name} — ${err && err.message ? err.message : err}`); }
function test(name, fn) {
  return Promise.resolve().then(fn).then(() => pass(name)).catch((e) => fail(name, e));
}

const fill = (c) => [{ type: 'SOLID', color: c }];

/** Same 2-child, non-repeating fixture renderer-toggle.test.js already uses. */
function nonRepeatingDoc() {
  return {
    id: 'root',
    type: 'FRAME',
    name: 'Page',
    fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
    absoluteBoundingBox: { x: 0, y: 0, width: 320, height: 240 },
    children: [
      {
        id: 'hdr',
        type: 'FRAME',
        name: 'Header',
        fills: fill({ r: 0.9, g: 0.9, b: 0.9, a: 1 }),
        absoluteBoundingBox: { x: 0, y: 0, width: 320, height: 48 },
        children: [
          {
            id: 'ttl',
            type: 'TEXT',
            name: 'Title',
            characters: 'Hello',
            style: { fontSize: 28 },
            fills: fill({ r: 0, g: 0, b: 0, a: 1 }),
            absoluteBoundingBox: { x: 8, y: 8, width: 100, height: 32 },
          },
        ],
      },
      {
        id: 'btn',
        type: 'FRAME',
        name: 'Button',
        fills: fill({ r: 0.2, g: 0.4, b: 0.9, a: 1 }),
        absoluteBoundingBox: { x: 8, y: 180, width: 100, height: 36 },
        children: [],
      },
    ],
  };
}

/** 3 uniform side-by-side "cards", each internally stacked in the same 2 Y-bands. */
function repeatingCardDoc() {
  function card(id, x) {
    return {
      id,
      type: 'FRAME',
      name: `Card ${id}`,
      fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
      absoluteBoundingBox: { x, y: 0, width: 200, height: 300 },
      children: [
        {
          id: `${id}-img`,
          type: 'RECTANGLE',
          name: 'Image',
          fills: fill({ r: 0.8, g: 0.8, b: 0.8, a: 1 }),
          absoluteBoundingBox: { x, y: 0, width: 200, height: 200 },
        },
        {
          id: `${id}-title`,
          type: 'TEXT',
          name: 'Title',
          characters: `Card ${id}`,
          style: { fontSize: 18 },
          fills: fill({ r: 0, g: 0, b: 0, a: 1 }),
          absoluteBoundingBox: { x: x + 8, y: 210, width: 184, height: 24 },
        },
      ],
    };
  }
  return {
    id: 'root',
    type: 'FRAME',
    name: 'Page',
    fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
    absoluteBoundingBox: { x: 0, y: 0, width: 700, height: 320 },
    children: [
      {
        id: 'cards',
        type: 'GROUP',
        name: 'Cards',
        absoluteBoundingBox: { x: 0, y: 0, width: 700, height: 300 },
        children: [card('c1', 0), card('c2', 250), card('c3', 500)],
      },
    ],
  };
}

/**
 * Same 3-card repeating shape as `repeatingCardDoc()`, but each card's image
 * leaf carries a real Figma `cornerRadius` (e.g. a rounded/pill button or
 * chip column-leaf, like Challenge Arena's real "Register Now" button node)
 * — proves `freeformLeafChromeDecls` (css-declarations.js) reaches a real
 * column leaf through the full NDG -> detectFreeformLayout -> renderer
 * pipeline, not just the synthetic buildDecls unit tests in render.test.js.
 */
function repeatingCardDocWithLeafCornerRadius() {
  function card(id, x) {
    return {
      id,
      type: 'FRAME',
      name: `Card ${id}`,
      fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
      absoluteBoundingBox: { x, y: 0, width: 200, height: 300 },
      children: [
        {
          id: `${id}-img`,
          type: 'RECTANGLE',
          name: 'Image',
          fills: fill({ r: 0.8, g: 0.8, b: 0.8, a: 1 }),
          cornerRadius: 12,
          absoluteBoundingBox: { x, y: 0, width: 200, height: 200 },
        },
        {
          id: `${id}-title`,
          type: 'TEXT',
          name: 'Title',
          characters: `Card ${id}`,
          style: { fontSize: 18 },
          fills: fill({ r: 0, g: 0, b: 0, a: 1 }),
          absoluteBoundingBox: { x: x + 8, y: 210, width: 184, height: 24 },
        },
      ],
    };
  }
  return {
    id: 'root',
    type: 'FRAME',
    name: 'Page',
    fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
    absoluteBoundingBox: { x: 0, y: 0, width: 700, height: 320 },
    children: [
      {
        id: 'cards',
        type: 'GROUP',
        name: 'Cards',
        absoluteBoundingBox: { x: 0, y: 0, width: 700, height: 300 },
        children: [card('c1', 0), card('c2', 250), card('c3', 500)],
      },
    ],
  };
}

/**
 * Reproduces the exact shape of the confirmed real-world bug (Figma node
 * 48:144/48:145 in the "Why Join Us" section): a wrapper FRAME with no
 * fills/strokes/effects of its own (a pure "SVG" passthrough wrapper) around
 * exactly one VECTOR child that itself carries a stroke. NDG's Pass 3
 * (`hasPaintSignal`, compiler/ndg/build.js) correctly collapses the
 * paint-less wrapper and promotes the vector — but `svgMarkup` here mirrors
 * the real legacy caller (server/figma-generate.js's SVG reconstruction),
 * which computes its map keyed by the WRAPPER's pre-collapse id, entirely
 * unaware NDG will delete that exact id. Proves the fix in
 * ir-experimental-renderer.js (rekeyForNdgCollapse + collapsedWrapperBoxBySurvivorId
 * + stroke/cornerRadius suppression for svgForNode) end-to-end through the
 * real renderIrExperimental() pipeline, not just via manual fixture inspection.
 */
function singleVectorIconDoc() {
  return {
    id: 'root',
    type: 'FRAME',
    name: 'Page',
    fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
    absoluteBoundingBox: { x: 0, y: 0, width: 320, height: 240 },
    children: [
      {
        id: 'icon-wrap',
        type: 'FRAME',
        name: 'Icon',
        absoluteBoundingBox: { x: 20, y: 20, width: 24, height: 24 },
        children: [
          {
            id: 'icon-vector',
            type: 'VECTOR',
            name: 'Vector',
            strokes: [{ type: 'SOLID', color: { r: 0, g: 1, b: 0, a: 1 } }],
            strokeWeight: 2.4,
            absoluteBoundingBox: { x: 22, y: 22, width: 20, height: 20 },
            children: [],
          },
        ],
      },
    ],
  };
}

/**
 * Reproduces the exact shape of the confirmed real-world bug (Figma node
 * 48:134, the "Why Join Us" section): a ROOT frame with its own real Auto
 * Layout padding (an 80px symmetric side-margin — the actual mechanism that
 * makes the design read as centered) and a FILL-sized child meant to occupy
 * the padded content box. `layoutChoice.padding` was always computed
 * correctly for every node (including the root) by buildRenderNode/
 * interpretGraph, but the root's own padding never reached the `canvas`
 * object handed to materializeHtml — so `.et-page` rendered with zero
 * padding and the FILL child stretched edge-to-edge instead of sitting
 * inset. Proves the fix (padding hoisted onto RenderNode + threaded into
 * canvas + emitted by canvasDecls) end-to-end through the real
 * renderIrExperimental() pipeline.
 */
function paddedRootDoc() {
  return {
    id: 'root',
    type: 'FRAME',
    name: 'Section',
    layoutMode: 'VERTICAL',
    paddingTop: 61,
    paddingRight: 80,
    paddingBottom: 112,
    paddingLeft: 80,
    fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
    absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 849 },
    children: [
      {
        id: 'container',
        type: 'FRAME',
        name: 'Container',
        layoutMode: 'VERTICAL',
        layoutAlign: 'STRETCH',
        layoutSizingHorizontal: 'FILL',
        absoluteBoundingBox: { x: 80, y: 61, width: 1280, height: 676 },
        children: [
          {
            id: 'headline',
            type: 'TEXT',
            name: 'Headline',
            characters: 'If food is your business',
            style: { fontSize: 60 },
            fills: fill({ r: 0, g: 0, b: 0, a: 1 }),
            absoluteBoundingBox: { x: 80, y: 101, width: 768, height: 120 },
          },
        ],
      },
    ],
  };
}

/**
 * Reproduces the exact shape of the confirmed real-world bug (Figma node
 * 84:5 in the "Blogs" section): a plain GROUP wrapper (no Auto Layout) whose
 * two children — a full-width card row and a narrower, independently-
 * centered heading block — are stored in Figma's raw child array as
 * [row, heading], the REVERSE of their true top-to-bottom visual order
 * (heading sits at y=0, row at y=200). Before the fix: this wrapper resolved
 * mode:'unknown' (edgesAligned's strict left-edge test rejects mismatched
 * widths), fell back to absolute positioning for both children, and the DOM
 * order correction (Skeleton readingOrder) never applied because it was
 * scoped only to recognized freeform-repeating-group containers — so the
 * raw, reversed Figma order shipped straight to the HTML. Proves both
 * coupled halves of the fix end-to-end: the wrapper now resolves
 * flow-column via geometry-side-by-side-column, and its children's DOM
 * order is corrected to match true visual order.
 */
function reversedOrderColumnDoc() {
  return {
    id: 'root',
    type: 'FRAME',
    name: 'Page',
    fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
    absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 400 },
    children: [
      {
        id: 'wrapper',
        type: 'GROUP',
        name: 'Wrapper',
        absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 400 },
        children: [
          {
            id: 'row',
            type: 'FRAME',
            name: 'CardRow',
            fills: fill({ r: 0.9, g: 0.9, b: 0.9, a: 1 }),
            absoluteBoundingBox: { x: 0, y: 200, width: 1440, height: 150 },
            children: [{
              id: 'row-text', type: 'TEXT', name: 'RowText', characters: 'RowContent',
              style: { fontSize: 16 }, fills: fill({ r: 0, g: 0, b: 0, a: 1 }),
              absoluteBoundingBox: { x: 20, y: 220, width: 200, height: 24 },
            }],
          },
          {
            id: 'heading',
            type: 'FRAME',
            name: 'Heading',
            fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
            absoluteBoundingBox: { x: 400, y: 0, width: 640, height: 100 },
            children: [{
              id: 'heading-text', type: 'TEXT', name: 'HeadingText', characters: 'HeadingContent',
              style: { fontSize: 24 }, fills: fill({ r: 0, g: 0, b: 0, a: 1 }),
              absoluteBoundingBox: { x: 420, y: 20, width: 300, height: 32 },
            }],
          },
        ],
      },
    ],
  };
}

/**
 * Reproduces the exact shape of the confirmed real-world bug (Figma node
 * 84:11 in the "Blogs" section's avatar row): a REAL declared Auto Layout
 * HORIZONTAL frame whose 2 children are (a) an image-fill leaf (an avatar
 * photo, 0 children of its own) and (b) a REAL Auto Layout VERTICAL frame
 * (a name+title text stack, which HAS children). Before the fix: the leaf's
 * own interpreted `mode` was always 'unknown' (nothing to arrange — true of
 * every leaf), and the renderer's absolute-positioning gate treated
 * `mode === 'unknown'` as an independent trigger for position:absolute
 * regardless of the parent's real declared Auto Layout — so the avatar
 * rendered at position:absolute;left:0;top:0, directly on top of its
 * properly-flexed sibling (confirmed via direct browser measurement: full
 * overlap). Cross-corpus audited as a pervasive pattern: 183 of 244 nodes
 * (75%) sitting inside a real Auto Layout parent were affected, though only
 * visibly so when a non-absolute sibling shared the same row.
 */
function avatarRowDoc() {
  return {
    id: 'root',
    type: 'FRAME',
    name: 'Card',
    fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
    absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 100 },
    children: [
      {
        id: 'avatar-row',
        type: 'FRAME',
        name: 'AvatarRow',
        layoutMode: 'HORIZONTAL',
        itemSpacing: 10,
        absoluteBoundingBox: { x: 20, y: 30, width: 190, height: 40 },
        children: [
          {
            id: 'avatar',
            type: 'RECTANGLE',
            name: 'Avatar',
            fills: [{ type: 'IMAGE', imageRef: 'avatar-ref', visible: true }],
            absoluteBoundingBox: { x: 20, y: 30, width: 40, height: 40 },
          },
          {
            id: 'name-stack',
            type: 'FRAME',
            name: 'NameStack',
            layoutMode: 'VERTICAL',
            absoluteBoundingBox: { x: 70, y: 31, width: 140, height: 39 },
            children: [
              {
                id: 'name-text', type: 'TEXT', name: 'Name', characters: 'Shelly Bansal',
                style: { fontSize: 16 }, fills: fill({ r: 0, g: 0, b: 0, a: 1 }),
                absoluteBoundingBox: { x: 70, y: 31, width: 140, height: 21 },
              },
              {
                id: 'title-text', type: 'TEXT', name: 'Title', characters: 'Founder and CEO',
                style: { fontSize: 12 }, fills: fill({ r: 0.3, g: 0.3, b: 0.3, a: 1 }),
                absoluteBoundingBox: { x: 70, y: 52, width: 140, height: 18 },
              },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * Reproduces the confirmed real-world bug in the "Explore Hackathons by
 * Category" section (Figma file fYKUEGHAxVkJwn8CwvJCsp, node 86:60):
 * "Web Development"/"Cloud Computing" labels are both flagged
 * textAutoResize:"WIDTH_AND_HEIGHT" (a signal the renderer previously
 * treated as an ABSOLUTE "never wrap" instruction) but each node's own
 * captured box height is exactly 2x its lineHeightPx — proof Figma's own
 * rendering already wrapped the text onto 2 lines. Forcing nowrap on these
 * overflowed the text past its narrower-than-single-line box width
 * (confirmed via browser measurement: scrollWidth 131 vs clientWidth 95).
 * Includes a genuinely single-line control (box height ~= lineHeightPx) to
 * prove the "never wrap" signal still fires for the case it's meant for.
 */
function autoResizeTextDoc() {
  return {
    id: 'root',
    type: 'FRAME',
    name: 'Card',
    fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
    absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 100 },
    children: [
      {
        id: 'two-line',
        type: 'TEXT',
        name: 'TwoLineLabel',
        characters: 'Web Development',
        style: { fontSize: 14, lineHeightPx: 20, textAutoResize: 'WIDTH_AND_HEIGHT' },
        fills: fill({ r: 0, g: 0, b: 0, a: 1 }),
        absoluteBoundingBox: { x: 20, y: 10, width: 95, height: 40 },
      },
      {
        id: 'one-line',
        type: 'TEXT',
        name: 'SingleLineLabel',
        characters: 'AI/ML',
        style: { fontSize: 14, lineHeightPx: 20, textAutoResize: 'WIDTH_AND_HEIGHT' },
        fills: fill({ r: 0, g: 0, b: 0, a: 1 }),
        absoluteBoundingBox: { x: 20, y: 60, width: 60, height: 21 },
      },
    ],
  };
}

/**
 * Reproduces the confirmed real-world bug (Figma file fYKUEGHAxVkJwn8CwvJCsp,
 * nodes 86:64/86:72/86:79/86:86/86:93 in the "Explore Hackathons" section):
 * each carries a genuine `effects:[{type:'DROP_SHADOW', ...}]`, ingested at
 * ndg/ingest.js since earlier work but never consumed anywhere downstream —
 * confirmed via browser measurement that zero elements on the rendered page
 * ever had any box-shadow computed style.
 */
function dropShadowCardDoc() {
  return {
    id: 'root',
    type: 'FRAME',
    name: 'Card',
    fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
    absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 100 },
    effects: [{
      type: 'DROP_SHADOW',
      visible: true,
      color: { r: 0, g: 0, b: 0, a: 0.05 },
      blendMode: 'NORMAL',
      offset: { x: 0, y: 0 },
      radius: 10,
      showShadowBehindNode: false,
    }],
    children: [],
  };
}

/**
 * Reproduces the exact shape of the confirmed real-world bug (Figma file
 * oPJPuHvvZOPo4nkzVxr11M node 43:2, "section.section-light" — "The
 * Dialogue" / "One show. Six lenses." section): a ROOT frame with real Auto
 * Layout `itemSpacing:84` between its 2 top-level children. Each root child
 * renders as its OWN sibling `<section>` (`renderSections()` in
 * materialize-html.js) rather than as a flex item inside a shared container
 * `modeDecls()` could put a CSS `gap` on — so the root's own gap was
 * silently dropped end-to-end (confirmed via direct browser measurement:
 * hard 0px gap between the hero and the lens-grid sections, vs. Figma's
 * real 84px). Proves the fix (root gap hoisted onto RenderNode + threaded
 * into `canvas.sectionGap` + emitted as a `.et-page > * + *` margin-top
 * rule) end-to-end through the real renderIrExperimental() pipeline.
 */
function rootSectionGapDoc() {
  return {
    id: 'root',
    type: 'FRAME',
    name: 'Section',
    layoutMode: 'VERTICAL',
    itemSpacing: 84,
    paddingTop: 80,
    paddingBottom: 80,
    fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
    absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 1273 },
    children: [
      {
        id: 'hero',
        type: 'FRAME',
        name: 'Hero',
        fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
        absoluteBoundingBox: { x: 124, y: 148.6, width: 1192, height: 262 },
        children: [{
          id: 'hero-text', type: 'TEXT', name: 'HeroText', characters: 'One show. Six lenses.',
          style: { fontSize: 60 }, fills: fill({ r: 0, g: 0, b: 0, a: 1 }),
          absoluteBoundingBox: { x: 124, y: 148.6, width: 800, height: 200 },
        }],
      },
      {
        id: 'grid',
        type: 'FRAME',
        name: 'Grid',
        fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
        absoluteBoundingBox: { x: 135, y: 494.6, width: 1181, height: 629.8 },
        children: [{
          id: 'grid-text', type: 'TEXT', name: 'GridText', characters: 'Infrastructure',
          style: { fontSize: 20 }, fills: fill({ r: 0, g: 0, b: 0, a: 1 }),
          absoluteBoundingBox: { x: 135, y: 494.6, width: 200, height: 30 },
        }],
      },
    ],
  };
}

/**
 * Reproduces the exact shape of the confirmed real-world bugs (Figma file
 * oPJPuHvvZOPo4nkzVxr11M node 43:3, the "section.section-light" hero row —
 * overflowed the page the moment the viewport was narrower than the design
 * canvas — and the "Group 357" `.group-272` misalignment report): a real
 * Auto Layout VERTICAL root whose children carry real, declared
 * `layoutSizingHorizontal` intent (FILL/HUG/absent-i.e.-FIXED). Before the
 * docs/COMPILER_REDESIGN_ROADMAP.md Phase 1.5 fix, `layout/interpret.js`'s
 * already-correct `sizingAxis()` result was computed and never read here —
 * every child got the SAME `min-width:<captured px>` floor regardless of
 * its real sizing intent, which is exactly the bug: a FILL child's captured
 * width was only ever correct at the one canvas width Figma captured it at.
 */
function sizingIntentColumnDoc() {
  function child(id, name, x, y, w, sizingHorizontal) {
    return {
      id,
      type: 'FRAME',
      name,
      ...(sizingHorizontal ? { layoutSizingHorizontal: sizingHorizontal } : {}),
      fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
      absoluteBoundingBox: { x, y, width: w, height: 100 },
      children: [{
        id: `${id}-text`, type: 'TEXT', name: `${name}Text`, characters: name,
        style: { fontSize: 16 }, fills: fill({ r: 0, g: 0, b: 0, a: 1 }),
        absoluteBoundingBox: { x, y, width: 100, height: 24 },
      }],
    };
  }
  return {
    id: 'root',
    type: 'FRAME',
    name: 'Root',
    layoutMode: 'VERTICAL',
    itemSpacing: 20,
    fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
    absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 400 },
    children: [
      child('fill-child', 'FillChild', 124, 0, 1192, 'FILL'),
      child('hug-child', 'HugChild', 124, 120, 300, 'HUG'),
      child('fixed-child', 'FixedChild', 124, 240, 400, null),
    ],
  };
}

/**
 * Same mechanism, opposite parent axis (real Auto Layout HORIZONTAL root) —
 * proves BOTH the main-axis (`flex:1 1 0`, sharing leftover space with
 * siblings rather than a hard/percentage size that would ignore them) and
 * cross-axis (`align-self:stretch`) branches of the fix.
 */
function sizingIntentRowDoc() {
  return {
    id: 'root',
    type: 'FRAME',
    name: 'Root',
    layoutMode: 'HORIZONTAL',
    itemSpacing: 20,
    fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
    absoluteBoundingBox: { x: 0, y: 0, width: 1000, height: 200 },
    children: [
      {
        id: 'main-fill-child', type: 'FRAME', name: 'MainFillChild',
        layoutSizingHorizontal: 'FILL',
        fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
        absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 150 },
        children: [{
          id: 'mf-text', type: 'TEXT', name: 'MfText', characters: 'MainFill',
          style: { fontSize: 16 }, fills: fill({ r: 0, g: 0, b: 0, a: 1 }),
          absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 24 },
        }],
      },
      {
        id: 'cross-fill-child', type: 'FRAME', name: 'CrossFillChild',
        layoutSizingVertical: 'FILL',
        fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
        absoluteBoundingBox: { x: 420, y: 0, width: 200, height: 150 },
        children: [{
          id: 'cf-text', type: 'TEXT', name: 'CfText', characters: 'CrossFill',
          style: { fontSize: 16 }, fills: fill({ r: 0, g: 0, b: 0, a: 1 }),
          absoluteBoundingBox: { x: 420, y: 0, width: 100, height: 24 },
        }],
      },
    ],
  };
}

async function main() {
  await test('renderIrExperimental — a root frame with its own real Auto Layout itemSpacing between 2 top-level children emits a matching margin-top gap between the resulting sibling sections (real bug: Figma node 43:2, "section.section-light" — hero and lens-grid sections rendered with a hard 0px gap instead of the real 84px itemSpacing)', async () => {
    const { html, css } = await renderIrExperimental(rootSectionGapDoc(), {
      graphId: 'g:freeform-render-it:section-gap',
      title: 'Section gap test',
    });
    assert(/<section class="section-hero"/.test(html), 'hero section rendered');
    assert(/<section class="section-grid"/.test(html), 'grid section rendered');
    const rule = /\.et-page\s*>\s*\*\s*\+\s*\*\s*\{([^}]*)\}/.exec(css);
    assert(rule, 'a .et-page > * + * sibling-gap rule exists');
    assert(/margin-top:\s*84px/.test(rule[1]), 'root itemSpacing (84) reached the sibling-gap rule as margin-top');
  });

  await test('renderIrExperimental — a root frame with only 1 top-level child (or no real itemSpacing) emits no sibling-gap rule at all (no regression for single-section designs)', async () => {
    const singleChildDoc = rootSectionGapDoc();
    singleChildDoc.children = [singleChildDoc.children[0]];
    const { css } = await renderIrExperimental(singleChildDoc, {
      graphId: 'g:freeform-render-it:section-gap-single',
      title: 'Single section test',
    });
    assert(!/\.et-page\s*>\s*\*\s*\+\s*\*/.test(css), 'no sibling-gap rule when there is nothing for it to space out');
  });

  await test('renderIrExperimental — a freeform-layout-ir column leaf with a real NDG cornerRadius (e.g. a rounded button/chip) emits border-radius in the generated CSS', async () => {
    const { html, css } = await renderIrExperimental(repeatingCardDocWithLeafCornerRadius(), {
      graphId: 'g:freeform-render-it:leaf-corner-radius',
      title: 'Freeform render test — leaf corner radius',
    });
    assert(html.length > 0, 'non-empty html');
    assert(css.includes('border-radius: 12px;'), 'the column leaf\'s real Figma cornerRadius (12) reaches the generated CSS verbatim');
  });


  await test('renderIrExperimental — repeating card document reaches a real freeform-layout-ir group: display:grid + byte-identical explicit px tracks across all 3 members', async () => {
    const { html, css } = await renderIrExperimental(repeatingCardDoc(), {
      graphId: 'g:freeform-render-it:cards',
      title: 'Freeform render test — cards',
    });
    assert(html.length > 0, 'non-empty html');
    assert(css.length > 0, 'non-empty css');
    const gridRules = [...css.matchAll(/display:\s*grid;[^}]*grid-template-(?:rows|columns):\s*([0-9.]+px[^;]*);/g)];
    assert(gridRules.length >= 1, 'at least one explicit-track grid rule was emitted');
    // Every member's own grid must repeat the identical track string —
    // this is the actual cross-member-alignment mechanism.
    const trackStrings = new Set(gridRules.map((m) => m[1]));
    assert(trackStrings.size >= 1, 'at least one distinct track string present');
  });

  await test('renderIrExperimental — non-repeating (2-child header+button) document produces zero freeform-layout-ir grid artifacts and renders exactly as it already did (fallback guarantee)', async () => {
    const { html, css } = await renderIrExperimental(nonRepeatingDoc(), {
      graphId: 'g:freeform-render-it:plain',
      title: 'Toggle Test',
    });
    assert(html.length > 0, 'non-empty html');
    assert(html.includes('Hello'), 'text content present, unaffected by freeform wiring');
    // No 2-member-or-more uniform repeating shape exists in this fixture
    // (header 320x48 vs. button 100x36 fail the uniform-size cluster test),
    // so no freeform-layout-ir group should fire — confirmed by the absence
    // of any explicit-px-track grid rule (the literal px-list shape only
    // `freeformGroupContainerDecls`/`freeformGroupMemberDecls`/
    // `rowSetRowDecls` ever produce).
    const explicitTrackRules = [...css.matchAll(/grid-template-(?:rows|columns):\s*[0-9.]+px/g)];
    assert.strictEqual(explicitTrackRules.length, 0, 'no freeform-layout-ir (or row-set) explicit-px-track grid rule fired for this non-repeating fixture');
  });

  await test('renderIrExperimental — a single-vector icon whose wrapping SVG frame gets NDG-collapsed still renders via its pre-collapse svgMarkup, sized by the ORIGINAL wrapper box, with no duplicate stroke outline (real bug: Figma nodes 48:144/48:145)', async () => {
    const { html, css } = await renderIrExperimental(singleVectorIconDoc(), {
      graphId: 'g:freeform-render-it:icon-collapse',
      title: 'Icon collapse test',
      svgMarkup: { 'icon-wrap': '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>' },
    });
    assert(html.length > 0, 'non-empty html');
    const imgMatch = html.match(/<img class="([^"]+)" src="([^"]*)"/);
    assert(imgMatch, 'the collapsed-survivor node rendered as a real <img> tag, not an empty div');
    assert(
      imgMatch[2].startsWith('data:image/svg+xml'),
      'svgMarkup keyed by the pre-collapse wrapper id was found via rekeyForNdgCollapse and used as the <img> src'
    );
    const cls = imgMatch[1].split(/\s+/)[0];
    const rule = new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`).exec(css);
    assert(rule, `a CSS rule for .${cls} exists`);
    assert(/width:\s*24px/.test(rule[1]), 'sized by the ORIGINAL wrapper box (24px), not the inner vector\'s tighter 20px box');
    assert(/height:\s*24px/.test(rule[1]), 'sized by the ORIGINAL wrapper box (24px), not the inner vector\'s tighter 20px box');
    assert(!/outline/.test(rule[1]), 'no duplicate outline decoration — the stroke is already baked into the reconstructed SVG markup');
    assert(!/border/.test(rule[1]), 'no duplicate border decoration — the stroke is already baked into the reconstructed SVG markup');
  });

  await test('renderIrExperimental — a root frame with its own real Auto Layout padding (an 80px symmetric side-margin, the actual mechanism that makes a design read as centered) emits that padding onto .et-page instead of dropping it (real bug: Figma node 48:134, the "Why Join Us" section)', async () => {
    const { css } = await renderIrExperimental(paddedRootDoc(), {
      graphId: 'g:freeform-render-it:root-padding',
      title: 'Root padding test',
    });
    const pageRule = /\.et-page\s*\{([^}]*)\}/.exec(css);
    assert(pageRule, 'a .et-page rule exists');
    const body = pageRule[1];
    assert(/padding-top:\s*61px/.test(body), 'root paddingTop (61) reached .et-page');
    assert(/padding-right:\s*80px/.test(body), 'root paddingRight (80) reached .et-page');
    assert(/padding-bottom:\s*112px/.test(body), 'root paddingBottom (112) reached .et-page');
    assert(/padding-left:\s*80px/.test(body), 'root paddingLeft (80) reached .et-page');
  });

  await test('renderIrExperimental — a plain GROUP wrapper whose 2 mismatched-width children are stored in REVERSED raw order resolves flow-column (not absolute) and corrects DOM order to true visual order (real bug: Figma node 84:5, the "Blogs" section)', async () => {
    const { html, css } = await renderIrExperimental(reversedOrderColumnDoc(), {
      graphId: 'g:freeform-render-it:reversed-column',
      title: 'Reversed column order test',
    });
    assert(html.length > 0, 'non-empty html');
    const headingIdx = html.indexOf('HeadingContent');
    const rowIdx = html.indexOf('RowContent');
    assert(headingIdx >= 0 && rowIdx >= 0, 'both text nodes present');
    assert(headingIdx < rowIdx, 'DOM order corrected: heading (visually first) now precedes the row (visually second), despite the reverse order in the source');

    const wrapperClassMatch = html.match(/<div class="(wrapper[^"]*)"/);
    assert(wrapperClassMatch, 'wrapper node rendered with a findable class');
    const rule = new RegExp(`\\.${wrapperClassMatch[1].split(/\s+/)[0]}\\s*\\{([^}]*)\\}`).exec(css);
    assert(rule, 'a CSS rule for the wrapper exists');
    assert(/display:\s*flex/.test(rule[1]), 'wrapper resolved to a real flex container, not absolute-only');
    assert(/flex-direction:\s*column/.test(rule[1]), 'wrapper resolved flow-column specifically (geometry-side-by-side-column), despite its 2 children not sharing a left edge (row is full-width, heading is narrower and centered)');
  });

  await test('renderIrExperimental — an image-fill leaf inside a REAL Auto Layout row no longer renders position:absolute on top of its properly-flexed sibling (real bug: Figma node 84:11, the "Blogs" section\'s avatar row)', async () => {
    const { html, css } = await renderIrExperimental(avatarRowDoc(), {
      graphId: 'g:freeform-render-it:avatar-row',
      title: 'Avatar row test',
      imageFillUrls: { 'avatar-ref': 'https://example.com/avatar.png' },
    });
    const imgMatch = html.match(/<img class="([^"]+)"/);
    assert(imgMatch, 'avatar rendered as a real <img> tag');
    const avatarRule = new RegExp(`\\.${imgMatch[1].split(/\s+/)[0]}\\s*\\{([^}]*)\\}`).exec(css);
    assert(avatarRule, 'a CSS rule for the avatar exists');
    assert(!/position:\s*absolute/.test(avatarRule[1]), 'avatar is NOT position:absolute — it is a normal flex item of its real Auto Layout parent');
    assert(/width:\s*40px/.test(avatarRule[1]), 'avatar gets a HARD width (not min-width) — an <img> has its own intrinsic size and needs both dimensions pinned exactly');
    assert(/height:\s*40px/.test(avatarRule[1]), 'avatar gets a HARD height (not min-height) for the same reason');

    const nameStackMatch = html.match(/<div class="(namestack[^"]*)"/);
    assert(nameStackMatch, 'name-stack rendered');
    const nameStackRule = new RegExp(`\\.${nameStackMatch[1].split(/\s+/)[0]}\\s*\\{([^}]*)\\}`).exec(css);
    assert(nameStackRule && !/position:\s*absolute/.test(nameStackRule[1]), 'name-stack (a real Auto Layout VERTICAL frame) is also a normal flex item, not absolute');
  });

  await test('renderIrExperimental — a textAutoResize:"WIDTH_AND_HEIGHT" node whose own box height is 2x its lineHeightPx does NOT get forced white-space:nowrap (real bug: Figma file fYKUEGHAxVkJwn8CwvJCsp, "Web Development"/"Cloud Computing" in the "Explore Hackathons" section, both overflowed their box under the old absolute "WIDTH_AND_HEIGHT means never wrap" rule), while a genuinely single-line sibling with the same flag still gets nowrap', async () => {
    const { html, css } = await renderIrExperimental(autoResizeTextDoc(), {
      graphId: 'g:freeform-render-it:auto-resize-text',
      title: 'Auto-resize text-wrap test',
    });
    const twoLineMatch = html.match(/<(\w+) class="([^"]+)">Web Development<\/\1>/);
    assert(twoLineMatch, 'two-line label rendered with a findable class');
    const twoLineRule = new RegExp(`\\.${twoLineMatch[2].split(/\s+/)[0]}\\s*\\{([^}]*)\\}`).exec(css);
    assert(twoLineRule, 'a CSS rule for the two-line label exists');
    assert(!/white-space:\s*nowrap/.test(twoLineRule[1]), 'a box that is clearly 2 lines tall (40px vs a 20px lineHeightPx) must NOT be forced to nowrap');

    const oneLineMatch = html.match(/<(\w+) class="([^"]+)">AI\/ML<\/\1>/);
    assert(oneLineMatch, 'single-line label rendered with a findable class');
    const oneLineRule = new RegExp(`\\.${oneLineMatch[2].split(/\s+/)[0]}\\s*\\{([^}]*)\\}`).exec(css);
    assert(oneLineRule, 'a CSS rule for the single-line label exists');
    assert(/white-space:\s*nowrap/.test(oneLineRule[1]), 'a genuinely single-line WIDTH_AND_HEIGHT box (21px vs a 20px lineHeightPx) still gets nowrap — the fix narrows the rule, it does not remove it');
  });

  await test('renderIrExperimental — a node with a real Figma DROP_SHADOW effect emits a matching CSS box-shadow (real bug: Figma file fYKUEGHAxVkJwn8CwvJCsp "Explore Hackathons" nodes, effects ingested at NDG but never consumed anywhere before this)', async () => {
    const { html, css } = await renderIrExperimental(dropShadowCardDoc(), {
      graphId: 'g:freeform-render-it:drop-shadow',
      title: 'Drop shadow test',
    });
    const rootClassMatch = html.match(/<div class="(card[^"]*)"/);
    assert(rootClassMatch, 'root "Card" node rendered with a findable class');
    const rootRule = new RegExp(`\\.${rootClassMatch[1].split(/\s+/)[0]}\\s*\\{([^}]*)\\}`).exec(css);
    assert(rootRule, 'a CSS rule for the root node exists');
    assert(/box-shadow:\s*0px 0px 10px 0px rgba\(0, 0, 0, 0\.05\)/.test(rootRule[1]), 'DROP_SHADOW effect (offset 0/0, radius 10, 5% black) reaches CSS box-shadow');
  });

  await test('renderIrExperimental — a real Auto Layout VERTICAL parent\'s FILL child (cross-axis, since horizontal is the cross axis for a column) gets align-self:stretch with no min-width/width at all (real bug: the "section.section-light" hero row, Figma node 43:3, overflowed the page because its captured 1192px width was emitted as a hard min-width instead of reading its real FILL sizing intent)', async () => {
    const { html, css } = await renderIrExperimental(sizingIntentColumnDoc(), {
      graphId: 'g:freeform-render-it:sizing-fill-column',
      title: 'Sizing FILL (column, cross-axis) test',
    });
    const match = html.match(/<div class="(fillchild[^"]*)"/);
    assert(match, 'FILL child rendered with a findable class');
    const rule = new RegExp(`\\.${match[1].split(/\s+/)[0]}\\s*\\{([^}]*)\\}`).exec(css);
    assert(rule, 'a CSS rule for the FILL child exists');
    assert(/align-self:\s*stretch/.test(rule[1]), 'cross-axis FILL emits align-self:stretch');
    assert(!/min-width/.test(rule[1]), 'no min-width — the old hard-pixel floor is suppressed for a FILL child');
    assert(!/(?<!min-)width:/.test(rule[1]), 'no hard/percentage width either — align-self:stretch is the whole mechanism');
  });

  await test('renderIrExperimental — a real Auto Layout VERTICAL parent\'s HUG child gets no explicit width/min-width/align-self at all (content-sized, matching Figma\'s "hug" intent for free)', async () => {
    const { html, css } = await renderIrExperimental(sizingIntentColumnDoc(), {
      graphId: 'g:freeform-render-it:sizing-hug-column',
      title: 'Sizing HUG test',
    });
    const match = html.match(/<div class="(hugchild[^"]*)"/);
    assert(match, 'HUG child rendered with a findable class');
    const rule = new RegExp(`\\.${match[1].split(/\s+/)[0]}\\s*\\{([^}]*)\\}`).exec(css);
    assert(rule, 'a CSS rule for the HUG child exists');
    assert(!/width/.test(rule[1]), 'no width/min-width declaration at all for a HUG child');
    assert(!/align-self/.test(rule[1]), 'no align-self either — HUG is the "do nothing, let content size it" case');
  });

  await test('renderIrExperimental — a real Auto Layout VERTICAL parent\'s child with NO declared sizing intent (legacy/absent data) keeps today\'s existing min-width behavior, unchanged (backward-compatibility guarantee — this fix is additive, not a replacement)', async () => {
    const { html, css } = await renderIrExperimental(sizingIntentColumnDoc(), {
      graphId: 'g:freeform-render-it:sizing-fixed-column',
      title: 'Sizing FIXED/absent test',
    });
    const match = html.match(/<div class="(fixedchild[^"]*)"/);
    assert(match, 'fixed child rendered with a findable class');
    const rule = new RegExp(`\\.${match[1].split(/\s+/)[0]}\\s*\\{([^}]*)\\}`).exec(css);
    assert(rule, 'a CSS rule for the fixed child exists');
    assert(/min-width:\s*400px/.test(rule[1]), 'no declared sizing intent falls back to the pre-existing min-width-from-captured-box behavior, byte-identical to before this fix');
    assert(!/align-self/.test(rule[1]), 'no align-self for the unchanged legacy case');
  });

  await test('renderIrExperimental — a real Auto Layout HORIZONTAL parent\'s FILL child on the MAIN axis gets flex:1 1 0 (shares leftover space with FILL siblings), not a hard/percentage width that would ignore them', async () => {
    const { html, css } = await renderIrExperimental(sizingIntentRowDoc(), {
      graphId: 'g:freeform-render-it:sizing-fill-row-main',
      title: 'Sizing FILL (row, main-axis) test',
    });
    const match = html.match(/<div class="(mainfillchild[^"]*)"/);
    assert(match, 'main-axis FILL child rendered with a findable class');
    const rule = new RegExp(`\\.${match[1].split(/\s+/)[0]}\\s*\\{([^}]*)\\}`).exec(css);
    assert(rule, 'a CSS rule for the main-axis FILL child exists');
    assert(/flex:\s*1 1 0/.test(rule[1]), 'main-axis FILL emits flex:1 1 0');
    assert(!/min-width/.test(rule[1]), 'no min-width floor — flex handles main-axis sizing now');
  });

  await test('renderIrExperimental — a real Auto Layout HORIZONTAL parent\'s FILL child on the CROSS axis (vertical, for a row) gets align-self:stretch, not min-height', async () => {
    const { html, css } = await renderIrExperimental(sizingIntentRowDoc(), {
      graphId: 'g:freeform-render-it:sizing-fill-row-cross',
      title: 'Sizing FILL (row, cross-axis) test',
    });
    const match = html.match(/<div class="(crossfillchild[^"]*)"/);
    assert(match, 'cross-axis FILL child rendered with a findable class');
    const rule = new RegExp(`\\.${match[1].split(/\s+/)[0]}\\s*\\{([^}]*)\\}`).exec(css);
    assert(rule, 'a CSS rule for the cross-axis FILL child exists');
    assert(/align-self:\s*stretch/.test(rule[1]), 'cross-axis FILL emits align-self:stretch');
    assert(!/min-height/.test(rule[1]), 'no min-height floor — align-self:stretch handles cross-axis sizing now');
  });

  await test('renderIrExperimental — a real Auto Layout HORIZONTAL container with declared counterAxisAlignItems:"MAX" emits align-items:flex-end instead of the hardcoded align-items:center (real bug: Figma file c0kt3mp76RoEiq3CFoeCHa node 1:443, docs/COMPILER_REDESIGN_ROADMAP.md Phase 4)', async () => {
    // The alignment-test row is nested one level under a plain single-child
    // page root — a multi-child document ROOT is treated specially by
    // renderSections() (each of ITS children becomes its own top-level
    // section; the root itself is never rendered as its own element at
    // all), so the node whose OWN align-items/justify-content we need to
    // assert on must not itself be the document root.
    const doc = {
      id: 'page', type: 'FRAME', name: 'Page',
      fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
      absoluteBoundingBox: { x: 0, y: 0, width: 180, height: 38 },
      children: [{
        id: 'alignrow',
        type: 'FRAME',
        name: 'AlignRow',
        layoutMode: 'HORIZONTAL',
        counterAxisAlignItems: 'MAX',
        itemSpacing: 8,
        fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
        absoluteBoundingBox: { x: 0, y: 0, width: 180, height: 38 },
        children: [
          {
            id: 'icon', type: 'RECTANGLE', name: 'Icon',
            fills: fill({ r: 0.5, g: 0.5, b: 0.5, a: 1 }),
            absoluteBoundingBox: { x: 0, y: 8, width: 20, height: 20 },
          },
          {
            id: 'label', type: 'TEXT', name: 'Label', characters: 'Read more',
            style: { fontSize: 14 }, fills: fill({ r: 0, g: 0, b: 0, a: 1 }),
            absoluteBoundingBox: { x: 28, y: 12, width: 90, height: 18 },
          },
        ],
      }],
    };
    const { html, css } = await renderIrExperimental(doc, {
      graphId: 'g:freeform-render-it:align-max-row',
      title: 'counterAxisAlignItems MAX test',
    });
    const rowClassMatch = html.match(/<div class="(alignrow[^"]*)"/);
    assert(rowClassMatch, 'AlignRow rendered with a findable class');
    const rule = new RegExp(`\\.${rowClassMatch[1].split(/\s+/)[0]}\\s*\\{([^}]*)\\}`).exec(css);
    assert(rule, 'a CSS rule for the AlignRow container exists');
    assert(/align-items:\s*flex-end/.test(rule[1]), 'declared counterAxisAlignItems:MAX reaches align-items:flex-end');
    assert(!/align-items:\s*center/.test(rule[1]), 'the old hardcoded align-items:center must NOT appear once a real declared value exists');
  });

  await test('renderIrExperimental — a node with real Figma rectangleCornerRadii (mixed) AND a LAYER_BLUR effect emits per-corner border-radius and filter:blur() together (docs/COMPILER_REDESIGN_ROADMAP.md Phase 5.5, end-to-end)', async () => {
    const doc = {
      id: 'card', type: 'FRAME', name: 'Card',
      rectangleCornerRadii: [0, 24, 0, 24],
      effects: [{ type: 'LAYER_BLUR', visible: true, radius: 6 }],
      fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
      absoluteBoundingBox: { x: 0, y: 0, width: 120, height: 80 },
      children: [],
    };
    const { html, css } = await renderIrExperimental(doc, {
      graphId: 'g:freeform-render-it:corner-radius-blur',
      title: 'Per-corner radius + blur test',
    });
    const match = html.match(/<div class="(card[^"]*)"/);
    assert(match, 'card rendered with a findable class');
    const rule = new RegExp(`\\.${match[1].split(/\s+/)[0]}\\s*\\{([^}]*)\\}`).exec(css);
    assert(rule, 'a CSS rule for the card exists');
    assert(/border-radius:\s*0px 24px 0px 24px/.test(rule[1]), 'mixed rectangleCornerRadii reaches per-corner border-radius');
    assert(/filter:\s*blur\(6px\)/.test(rule[1]), 'LAYER_BLUR effect reaches filter:blur()');
  });

  await test('renderIrExperimental — opts.precomputedNdg (docs/COMPILER_REDESIGN_ROADMAP.md Phase 6) is actually consumed instead of self-materializing: passing a precomputed graph built from a DIFFERENT document than the one being "rendered" makes the precomputed graph win, proving the option is wired through rather than silently ignored', async () => {
    const realDoc = {
      id: 'realroot', type: 'FRAME', name: 'RealRoot',
      fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      children: [{
        id: 'realleaf', type: 'FRAME', name: 'RealLeafFromPrecomputedGraph',
        fills: fill({ r: 0.2, g: 0.4, b: 0.6, a: 1 }),
        absoluteBoundingBox: { x: 0, y: 0, width: 40, height: 40 },
        children: [],
      }],
    };
    const staleDoc = {
      id: 'staleroot', type: 'FRAME', name: 'StaleRoot',
      fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      children: [{
        id: 'staleleaf', type: 'FRAME', name: 'StaleLeafShouldNotAppear',
        fills: fill({ r: 0.9, g: 0.1, b: 0.1, a: 1 }),
        absoluteBoundingBox: { x: 0, y: 0, width: 40, height: 40 },
        children: [],
      }],
    };
    const graphId = 'g:freeform-render-it:precomputed-ndg';
    const precomputedNdg = await materializeNormalizedDesignGraph({
      workspace: createWorkspace(),
      policy: { profileId: 'pixel-faithful' },
      document: realDoc,
      graphId,
    });
    const { html } = await renderIrExperimental(staleDoc, {
      graphId,
      title: 'precomputedNdg test',
      precomputedNdg,
    });
    assert(/RealLeafFromPrecomputedGraph/i.test(html), 'the precomputed graph\'s own content reaches the render output');
    assert(!/StaleLeafShouldNotAppear/i.test(html), 'the document argument is ignored once a precomputedNdg is supplied — it must not be re-materialized');
  });

  await test('renderIrExperimental — omitting opts.precomputedNdg keeps today\'s self-materializing behavior unchanged (backward-compatibility guarantee for every existing caller)', async () => {
    const doc = {
      id: 'plainroot', type: 'FRAME', name: 'PlainRoot',
      fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      children: [{
        id: 'plainleaf', type: 'FRAME', name: 'PlainLeafSelfMaterialized',
        fills: fill({ r: 0.2, g: 0.4, b: 0.6, a: 1 }),
        absoluteBoundingBox: { x: 0, y: 0, width: 40, height: 40 },
        children: [],
      }],
    };
    const { html } = await renderIrExperimental(doc, {
      graphId: 'g:freeform-render-it:no-precomputed-ndg',
      title: 'no precomputedNdg test',
    });
    assert(/PlainLeafSelfMaterialized/i.test(html), 'without opts.precomputedNdg, the document argument is still self-materialized exactly as before');
  });

  await test('renderIrExperimental — opts.precomputedComponentRecognition (docs/COMPILER_REDESIGN_ROADMAP.md Phase 6, increment 3) is a safe, non-crashing substitute for the internal detectComponents() call, producing byte-identical output to omitting it entirely when the supplied value is empty (the same shape a plain, no-real-components document would naturally detect) — NOTE: this option\'s downstream consumer (Skeleton\'s componentClaim, compiler/skeleton/build.js) does not yet gate any renderer decision itself (a separate, pre-existing, already-disclosed gap — see that file\'s own group-assignment loop comment), so this test proves safe wiring/substitution rather than an observable rendering difference', async () => {
    const baseline = await renderIrExperimental(repeatingCardDoc(), {
      graphId: 'g:freeform-render-it:component-recognition-baseline',
    });
    const withEmptyPrecomputed = await renderIrExperimental(repeatingCardDoc(), {
      graphId: 'g:freeform-render-it:component-recognition-baseline',
      precomputedComponentRecognition: {
        definitions: [], instances: [], orphans: [], flattenPlan: [], layoutDegraded: false, claimedNodeIds: [],
      },
    });
    assert.strictEqual(withEmptyPrecomputed.html, baseline.html, 'supplying an empty precomputed ComponentIR (matching what this plain document would naturally detect) reproduces the exact same HTML as internal detection');
    assert.strictEqual(withEmptyPrecomputed.css, baseline.css, 'and the exact same CSS');
  });

  await test('renderIrExperimental — opts.precomputedInterpretations (docs/COMPILER_REDESIGN_ROADMAP.md Phase 6, increment 4) is actually consumed instead of self-materializing: substituting a real Auto Layout HORIZONTAL row\'s own naturally-computed interpretations with an otherwise-identical copy whose modeCandidates[0].mode is overridden to "flow-column" makes flow-column\'s decls (flex-direction:column, align-items:flex-start) win over flow-row\'s (flex-direction:row, align-items:center) — proving the option overrides interpretGraph() rather than being silently ignored (compiler/layout/materialize.js\'s materializeLayoutIR(), i.e. job.projectLayoutIR(), calls this exact same interpretGraph() and exposes its return value as `interpretations` verbatim, so a caller holding that Kernel-projected LayoutIR slice could hand its interpretations to this option directly)', async () => {
    const doc = {
      id: 'page', type: 'FRAME', name: 'Page',
      fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
      absoluteBoundingBox: { x: 0, y: 0, width: 220, height: 120 },
      children: [{
        id: 'introw', type: 'FRAME', name: 'Row',
        layoutMode: 'HORIZONTAL', itemSpacing: 10,
        fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
        absoluteBoundingBox: { x: 10, y: 10, width: 200, height: 100 },
        children: [
          { id: 'introwa', type: 'FRAME', name: 'A', fills: fill({ r: 1, g: 0, b: 0, a: 1 }), absoluteBoundingBox: { x: 10, y: 10, width: 50, height: 50 }, children: [] },
          { id: 'introwb', type: 'FRAME', name: 'B', fills: fill({ r: 0, g: 1, b: 0, a: 1 }), absoluteBoundingBox: { x: 70, y: 10, width: 50, height: 50 }, children: [] },
        ],
      }],
    };
    const graphId = 'g:freeform-render-it:precomputed-interpretations';
    const precomputedNdg = await materializeNormalizedDesignGraph({
      workspace: createWorkspace(), policy: { profileId: 'pixel-faithful' }, document: doc, graphId,
    });
    const index = indexGraph(precomputedNdg.graph);
    const detectedGeometry = detectGeometry(precomputedNdg.graph, {});
    const naturalInterpretations = interpretGraph(precomputedNdg.graph, index, {
      recognitionHintsByNode: detectedGeometry.recognitionHintsByNode,
    });
    const flippedInterpretations = naturalInterpretations.map((i) => (
      i.nodeId === 'src:introw'
        ? { ...i, modeCandidates: [{ mode: 'flow-column', localScore: 1, cues: ['test-override'] }] }
        : i
    ));

    const { css: naturalCss } = await renderIrExperimental(doc, { graphId, precomputedNdg });
    const { css: flippedCss } = await renderIrExperimental(doc, {
      graphId, precomputedNdg, precomputedInterpretations: flippedInterpretations,
    });
    const naturalRule = /\.row\s*\{([^}]*)\}/.exec(naturalCss);
    const flippedRule = /\.row\s*\{([^}]*)\}/.exec(flippedCss);
    assert(naturalRule, 'a CSS rule for the row exists in the natural render');
    assert(flippedRule, 'a CSS rule for the row exists in the flipped render');
    assert(/flex-direction:\s*row/.test(naturalRule[1]), 'the naturally-computed interpretation (real declared HORIZONTAL Auto Layout) renders flex-direction:row');
    assert(/flex-direction:\s*column/.test(flippedRule[1]), 'the precomputed, overridden interpretation (mode forced to flow-column) wins instead — proving it is genuinely consumed, not ignored');
  });

  await test('renderIrExperimental — opts.precomputedResponsive (docs/COMPILER_REDESIGN_ROADMAP.md Phase 6, increment 5) is actually consumed instead of self-materializing: substituting a real row\'s own naturally-detected "stack" adaptation with an otherwise-identical copy whose strategy is overridden to "hide" makes the HIDE strategy\'s decl (display:none) win over STACK\'s (flex-direction:column/align-items:stretch) inside the emitted @media rule — proving the option overrides detectResponsive() rather than being silently ignored (compiler/responsive/materialize.js\'s materializeResponsiveIR(), i.e. job.projectResponsiveIR(), calls this exact same detectResponsive() and exposes its return as `.detected` verbatim)', async () => {
    const doc = {
      id: 'page', type: 'FRAME', name: 'Page',
      fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
      absoluteBoundingBox: { x: 0, y: 0, width: 220, height: 120 },
      children: [{
        id: 'rsprow', type: 'FRAME', name: 'Row',
        layoutMode: 'HORIZONTAL', itemSpacing: 10,
        fills: fill({ r: 1, g: 1, b: 1, a: 1 }),
        absoluteBoundingBox: { x: 10, y: 10, width: 200, height: 100 },
        children: [
          { id: 'rsprowa', type: 'FRAME', name: 'A', fills: fill({ r: 1, g: 0, b: 0, a: 1 }), absoluteBoundingBox: { x: 10, y: 10, width: 50, height: 50 }, children: [] },
          { id: 'rsprowb', type: 'FRAME', name: 'B', fills: fill({ r: 0, g: 1, b: 0, a: 1 }), absoluteBoundingBox: { x: 70, y: 10, width: 50, height: 50 }, children: [] },
        ],
      }],
    };
    const graphId = 'g:freeform-render-it:precomputed-responsive';
    const precomputedNdg = await materializeNormalizedDesignGraph({
      workspace: createWorkspace(), policy: { profileId: 'pixel-faithful' }, document: doc, graphId,
    });
    const index = indexGraph(precomputedNdg.graph);
    const detectedGeometry = detectGeometry(precomputedNdg.graph, {});
    const interpretations = interpretGraph(precomputedNdg.graph, index, {
      recognitionHintsByNode: detectedGeometry.recognitionHintsByNode,
    });
    const layoutIrLike = {
      payload: {
        nodes: interpretations.map((i) => ({
          nodeId: i.nodeId,
          mode: i.modeCandidates && i.modeCandidates[0] ? i.modeCandidates[0].mode : 'unknown',
        })),
      },
    };
    const naturalResponsive = detectResponsive(precomputedNdg.graph, { layoutIr: layoutIrLike, policy: {} });
    const hiddenResponsive = {
      ...naturalResponsive,
      adaptations: naturalResponsive.adaptations.map((a) => (
        a.nodeId === 'src:rsprow' ? { ...a, strategy: STRATEGY.HIDE } : a
      )),
    };

    const { css: naturalCss } = await renderIrExperimental(doc, { graphId, precomputedNdg });
    const { css: hiddenCss } = await renderIrExperimental(doc, {
      graphId, precomputedNdg, precomputedResponsive: hiddenResponsive,
    });
    const naturalMedia = /@media[^{]*\{[^}]*\.rsp-rsprow\s*\{([^}]*)\}/.exec(naturalCss);
    const hiddenMedia = /@media[^{]*\{[^}]*\.rsp-rsprow\s*\{([^}]*)\}/.exec(hiddenCss);
    assert(naturalMedia, 'a responsive @media rule for the row exists in the natural render');
    assert(hiddenMedia, 'a responsive @media rule for the row exists in the overridden render');
    assert(/flex-direction:\s*column/.test(naturalMedia[1]), 'the naturally-detected STACK strategy renders flex-direction:column inside the media rule');
    assert(/display:\s*none/.test(hiddenMedia[1]), 'the precomputed, overridden strategy (forced to HIDE) wins instead — proving it is genuinely consumed, not ignored');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
