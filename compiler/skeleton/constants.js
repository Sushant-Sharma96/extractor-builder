'use strict';

/**
 * Design Skeleton — role vocabulary. See docs/
 * FIGMA_DESIGN_MODEL_ARCHITECTURE_RESEARCH.md Part 3 for the full proposal
 * this module implements v0 of.
 */

const BUILDER_VERSION = 'skeleton-0.1.0';

// The node with no parent — always exactly one per graph, never eligible for
// any other role no matter what its own geometry/paint looks like.
const ROLE_ROOT = 'root';

// Carries information the design exists to communicate: real text
// characters, an image fill, or a meaningful (non-chrome-shaped) icon.
// Never a candidate for flattening or discarding.
const ROLE_CONTENT = 'content';

// A leaf that exists to style its parent, not to be independently
// meaningful — a background rectangle covering (most of) its parent's box.
const ROLE_DECORATIVE_CHROME = 'decorative-chrome';

// A container whose own box/fill/stroke carry no visual meaning of their
// own (see hasOwnVisualSignal) and which delegates to exactly one child —
// a candidate for flattening (discard the wrapper, re-parent its child).
//
// CURRENTLY UNREACHABLE via buildDesignSkeleton(buildNormalizedDesignGraph(
// ...).graph) specifically — a freshly-discovered instance of this whole
// research effort's central finding, one level deeper. This role's own
// criteria (no paint/stroke/effect/radius/opacity/rotation/mask signal,
// exactly one child) is IDENTICAL to compiler/ndg/build.js's own Pass 3
// passthrough-collapse criteria, which already runs, unconditionally, on
// every graph before a Skeleton ever sees it — so by construction, every
// node this role would apply to has already been deleted from the graph
// upstream. Kept in the taxonomy anyway (matching Part 3's proposal, and
// exercised directly against a hand-built graph object in
// compiler/test/skeleton.test.js) because the long-term design intent is
// for the SKELETON, not NDG's build.js, to own this decision — once that
// happens, NDG's Pass 2/3 should be relaxed to stop preempting it.
const ROLE_STRUCTURAL_WRAPPER = 'structural-wrapper';

// A container where Figma itself declares layout (layoutMode HORIZONTAL /
// VERTICAL / GRID). Downstream consumers should read Figma's own declared
// spacing/alignment/sizing directly here — geometry-guessing is never
// appropriate for a node with this role.
const ROLE_LAYOUT_CONTAINER_REAL = 'layout-container-real';

// A container with no declared Auto Layout, either because it holds more
// than one child (which must be arranged somehow) or because it carries
// real visual signal of its own alongside a single child (e.g. a card
// shell) — the only role for which geometry-based clustering is an
// appropriate fallback.
const ROLE_LAYOUT_CONTAINER_INFERRED = 'layout-container-inferred';

// A leaf that is neither real content nor full-bleed chrome — a divider,
// small accent shape, or other decorative-but-not-background leaf.
const ROLE_LEAF_SHAPE = 'leaf-shape';

const ROLES = [
  ROLE_ROOT,
  ROLE_CONTENT,
  ROLE_DECORATIVE_CHROME,
  ROLE_STRUCTURAL_WRAPPER,
  ROLE_LAYOUT_CONTAINER_REAL,
  ROLE_LAYOUT_CONTAINER_INFERRED,
  ROLE_LEAF_SHAPE,
];

// A set of siblings recognized as repeating instances of the same pattern
// (cards in a grid, rows in a table). v0 has exactly one kind, wrapping
// compiler/freeform-layout's already-proven detector — see build.js's
// header comment for why merging its internals is explicitly out of scope
// for this phase.
const GROUP_KIND_REPEATING = 'repeating';

module.exports = {
  BUILDER_VERSION,
  ROLE_ROOT,
  ROLE_CONTENT,
  ROLE_DECORATIVE_CHROME,
  ROLE_STRUCTURAL_WRAPPER,
  ROLE_LAYOUT_CONTAINER_REAL,
  ROLE_LAYOUT_CONTAINER_INFERRED,
  ROLE_LEAF_SHAPE,
  ROLES,
  GROUP_KIND_REPEATING,
};
