'use strict';

/**
 * Style Resolver v0 — docs/STYLE_RESOLVER_ARCHITECTURE.md.
 * Unit tests for the resolver's OUTPUT ALONE (no CSS text involved), per
 * Phase 8's own stated verification approach.
 */
const assert = require('assert');
const {
  resolveShape, resolveEffects, boxShadowCss, blurFiltersCss, resolveTypography,
  paintCss, solidFillCss, imageFiltersCss, imageObjectPosition, resolveImageWash,
} = require('../style');

let passed = 0;
let failed = 0;
function pass(name) { passed += 1; console.log(`PASS  ${name}`); }
function fail(name, err) { failed += 1; console.error(`FAIL  ${name} — ${err && err.message ? err.message : err}`); }
function test(name, fn) {
  try { fn(); pass(name); } catch (e) { fail(name, e); }
}

test('resolveShape — ellipse always wins border-radius:50%, regardless of any cornerRadius/rectangleCornerRadii present', () => {
  const facts = resolveShape({ isEllipse: true, cornerRadius: 12, rectangleCornerRadii: [4, 4, 4, 4] });
  assert.strictEqual(facts.borderRadius, '50%');
});

test('resolveShape — a real mixed rectangleCornerRadii resolves per-corner "tl tr br bl", Figma order preserved verbatim', () => {
  const facts = resolveShape({ rectangleCornerRadii: [0, 24, 0, 24] });
  assert.strictEqual(facts.borderRadius, '0px 24px 0px 24px');
});

test('resolveShape — a genuinely uniform rectangleCornerRadii array (all zero) falls through to the plain cornerRadius branch, not the per-corner one', () => {
  const facts = resolveShape({ rectangleCornerRadii: [0, 0, 0, 0], cornerRadius: 8 });
  assert.strictEqual(facts.borderRadius, '8px');
});

test('resolveShape — plain uniform cornerRadius resolves to a single px value', () => {
  const facts = resolveShape({ cornerRadius: 20 });
  assert.strictEqual(facts.borderRadius, '20px');
});

test('resolveShape — cornerRadius of 0 (or absent) resolves to no border-radius at all', () => {
  assert.strictEqual(resolveShape({ cornerRadius: 0 }).borderRadius, null);
  assert.strictEqual(resolveShape({}).borderRadius, null);
});

test('resolveShape — cornerSmoothing is resolved and carried through even though nothing renders it yet (Style Resolver Architecture Section 3.4)', () => {
  assert.strictEqual(resolveShape({ cornerSmoothing: 0.6 }).cornerSmoothing, 0.6);
  assert.strictEqual(resolveShape({}).cornerSmoothing, null);
});

test('resolveShape — clipContent resolves the clips boolean, independent of every other shape field', () => {
  assert.strictEqual(resolveShape({ clips: true }).clipContent, true);
  assert.strictEqual(resolveShape({ clips: false }).clipContent, false);
  assert.strictEqual(resolveShape({}).clipContent, false);
});

test('resolveShape — tolerates a completely empty/undefined input without throwing', () => {
  assert.doesNotThrow(() => resolveShape());
  assert.doesNotThrow(() => resolveShape(null));
  assert.doesNotThrow(() => resolveShape({}));
});

test('boxShadowCss — a real DROP_SHADOW effect resolves to a single box-shadow value', () => {
  const css = boxShadowCss([{ type: 'DROP_SHADOW', visible: true, offset: { x: 0, y: 4 }, radius: 8, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.25 } }]);
  assert.strictEqual(css, '0px 4px 8px 0px rgba(0, 0, 0, 0.25)');
});

test('boxShadowCss — INNER_SHADOW appends the inset keyword; multiple effects comma-join', () => {
  const css = boxShadowCss([
    { type: 'DROP_SHADOW', visible: true, offset: { x: 1, y: 1 }, radius: 2, spread: 0, color: { r: 1, g: 1, b: 1, a: 1 } },
    { type: 'INNER_SHADOW', visible: true, offset: { x: 0, y: 0 }, radius: 1, spread: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
  ]);
  assert.strictEqual(css, '1px 1px 2px 0px #ffffff, 0px 0px 1px 0px #000000 inset');
});

test('boxShadowCss — no effects (or none of the two shadow types) resolves to null', () => {
  assert.strictEqual(boxShadowCss([]), null);
  assert.strictEqual(boxShadowCss([{ type: 'LAYER_BLUR', radius: 4 }]), null);
  assert.strictEqual(boxShadowCss(), null);
});

test('blurFiltersCss — LAYER_BLUR and BACKGROUND_BLUR resolve independently, both can be present at once', () => {
  const facts = blurFiltersCss([
    { type: 'LAYER_BLUR', visible: true, radius: 6 },
    { type: 'BACKGROUND_BLUR', visible: true, radius: 12 },
  ]);
  assert.strictEqual(facts.filter, 'blur(6px)');
  assert.strictEqual(facts.backdropFilter, 'blur(12px)');
});

test('blurFiltersCss — absent effects resolve both to null', () => {
  const facts = blurFiltersCss([]);
  assert.strictEqual(facts.filter, null);
  assert.strictEqual(facts.backdropFilter, null);
});

test('resolveEffects — the one call produces boxShadow + filter + backdropFilter together, matching the StyleFacts contract', () => {
  const facts = resolveEffects([
    { type: 'DROP_SHADOW', visible: true, offset: { x: 0, y: 2 }, radius: 4, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.2 } },
    { type: 'LAYER_BLUR', visible: true, radius: 3 },
  ]);
  assert.strictEqual(facts.boxShadow, '0px 2px 4px 0px rgba(0, 0, 0, 0.2)');
  assert.strictEqual(facts.filter, 'blur(3px)');
  assert.strictEqual(facts.backdropFilter, null);
});

test('resolveTypography — whole-node fields (fontFamily/fontWeight/fontSize/lineHeight/letterSpacing/textNoWrap/textCase/textAlign/textDecoration) match the exact pre-relocation modeDecls() output', () => {
  const decls = resolveTypography({
    fontFamily: 'Poppins', fontWeight: 600, fontSize: 24, lineHeight: 32, letterSpacing: 0.5,
    textNoWrap: true, textCase: 'UPPER', textAlign: 'CENTER', textDecoration: 'STRIKETHROUGH',
  });
  assert.deepStrictEqual(decls, [
    ['font-family', "'Poppins', sans-serif"],
    ['font-weight', '600'],
    ['font-size', '24px'],
    ['line-height', '32px'],
    ['letter-spacing', '0.5px'],
    ['white-space', 'nowrap'],
    ['text-transform', 'uppercase'],
    ['text-align', 'center'],
    ['text-decoration', 'line-through'],
  ]);
});

test('resolveTypography — absent facts object resolves to an empty decl list, not a throw (backward-compatibility guarantee)', () => {
  assert.deepStrictEqual(resolveTypography(null), []);
  assert.deepStrictEqual(resolveTypography(undefined), []);
  assert.deepStrictEqual(resolveTypography({}), []);
});

test('resolveTypography — closes the real per-run gap this session found: STRIKETHROUGH now resolves (previously only UNDERLINE did, in the old separate materialize-html.js runStyleCss() implementation)', () => {
  const decls = resolveTypography({ textDecoration: 'STRIKETHROUGH' });
  assert.deepStrictEqual(decls, [['text-decoration', 'line-through']]);
});

test('resolveTypography — closes the other real per-run gap: textCase now resolves for a per-run-shaped input (previously not read at all outside the whole-node path)', () => {
  assert.deepStrictEqual(resolveTypography({ textCase: 'UPPER' }), [['text-transform', 'uppercase']]);
  assert.deepStrictEqual(resolveTypography({ textCase: 'LOWER' }), [['text-transform', 'lowercase']]);
  assert.deepStrictEqual(resolveTypography({ textCase: 'TITLE' }), [['text-transform', 'capitalize']]);
});

test('resolveTypography — italic/fontStyle (a real per-run-only field, verbatim from the old runStyleCss()) still resolves correctly under unification', () => {
  assert.deepStrictEqual(resolveTypography({ italic: true }), [['font-style', 'italic']]);
  assert.deepStrictEqual(resolveTypography({ fontStyle: 'Italic' }), [['font-style', 'italic']]);
  assert.deepStrictEqual(resolveTypography({ fontStyle: 'Regular' }), []);
});

// docs/PAINT_ARCHITECTURE_RESEARCH.md — Paint module. Real fixture data
// (verified against raw Figma snapshots, see conversation) is used as the
// basis for these to ground them in real corpus values, not invented ones.
test('imageFiltersCss — real node fYKUEGHAxVkJwn8CwvJCsp:50:194 ({contrast:0.3, highlights:-0.05}) resolves to contrast(1.3) only — highlights has no CSS primitive and is deliberately left unmapped, not guessed at', () => {
  assert.strictEqual(imageFiltersCss({ contrast: 0.3, highlights: -0.05 }), 'contrast(1.3)');
});

test('imageFiltersCss — saturation/exposure resolve via the documented 1+x remap; zero/absent values emit nothing', () => {
  assert.strictEqual(imageFiltersCss({ saturation: -1 }), 'saturate(0)');
  assert.strictEqual(imageFiltersCss({ exposure: 0.5 }), 'brightness(1.5)');
  assert.strictEqual(imageFiltersCss({ saturation: 0, contrast: 0 }), null);
  assert.strictEqual(imageFiltersCss(null), null);
  assert.strictEqual(imageFiltersCss({}), null);
});

test('imageObjectPosition — real node fYKUEGHAxVkJwn8CwvJCsp:86:62\'s imageTransform resolves to the exact object-position independently verified against raw Figma data (99.97% 90.93%)', () => {
  const pos = imageObjectPosition([
    [0.999896764755249, 0, 0.00010320852743461728],
    [0, 0.885794460773468, 0.10384156554937363],
  ]);
  assert.strictEqual(pos, '99.97% 90.93%');
});

test('imageObjectPosition — an identity matrix (no real crop) resolves to centered 50% 50%, not a division-by-zero NaN', () => {
  assert.strictEqual(imageObjectPosition([[1, 0, 0], [0, 1, 0]]), '50% 50%');
});

test('imageObjectPosition — absent/malformed imageTransform resolves to null (no object-position emitted at all)', () => {
  assert.strictEqual(imageObjectPosition(null), null);
  assert.strictEqual(imageObjectPosition([]), null);
  assert.strictEqual(imageObjectPosition([[1]]), null);
});

test('resolveImageWash — real node fYKUEGHAxVkJwn8CwvJCsp:86:62 (SOLID #f6f8ff wash beneath a 40%-opacity IMAGE) resolves both the wash background AND the image opacity — the exact multi-fill case that triggered this whole research effort', () => {
  const paints = [
    { type: 'SOLID', visible: true, color: { r: 0.9647058844566345, g: 0.9725490212440491, b: 0.9960784316062927, a: 1 } },
    { type: 'IMAGE', visible: true, opacity: 0.4000000059604645, scaleMode: 'STRETCH', imageRef: 'x' },
  ];
  const wash = resolveImageWash(paints, { width: 100, height: 100 });
  assert.strictEqual(wash.opacity, 0.4);
  assert.deepStrictEqual(wash.washBehind, { prop: 'background-color', value: '#f6f8fe' });
});

test('resolveImageWash — a lone IMAGE fill (the dominant, ordinary case — 2,290 of 3,490 real nodes have exactly 1 fill) resolves to null, no wash needed', () => {
  assert.strictEqual(resolveImageWash([{ type: 'IMAGE', visible: true, imageRef: 'x' }], { width: 10, height: 10 }), null);
});

test('resolveImageWash — no IMAGE paint at all resolves to null regardless of other fills present', () => {
  assert.strictEqual(resolveImageWash([{ type: 'SOLID', visible: true, color: { r: 0, g: 0, b: 0, a: 1 } }], { width: 10, height: 10 }), null);
});

test('paintCss/solidFillCss — relocated Paint functions still work correctly after the move into compiler/style (regression guard for the relocation)', () => {
  assert.strictEqual(solidFillCss([{ type: 'SOLID', visible: true, color: { r: 1, g: 0, b: 0, a: 1 } }]), '#ff0000');
  const bg = paintCss([{ type: 'SOLID', visible: true, color: { r: 0, g: 1, b: 0, a: 1 } }], { width: 10, height: 10 });
  assert.deepStrictEqual(bg, { prop: 'background-color', value: '#00ff00' });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
