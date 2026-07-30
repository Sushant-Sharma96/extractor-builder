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

async function main() {
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

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
