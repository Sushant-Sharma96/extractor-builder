'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Capture++ configuration — the ONLY place property sets, interaction signals,
// probe rules and detectors live. Add a new detector / selector / property here;
// the core module (capture-plus.js) never changes. User config is deep-merged
// over these defaults (detectors are concatenated, not replaced).
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  viewports: [{ name: 'desktop', width: 1280, height: 900 }], // extensible: add tablet/mobile later

  computed: {
    // which elements get a computed-style snapshot ("interesting" = likely to own style)
    interestingSelector:
      'h1,h2,h3,h4,h5,h6,p,a,button,li,blockquote,section,header,footer,nav,img,svg,'
      + '[class*="text-"],[class*="font-"],[class*="bg-"],[class*="grad"],[class*="leading"],[style*="animation"],[style*="transform"]',
    // curated property set (Stage-1 default; extend freely)
    properties: [
      'font-family', 'font-size', 'line-height', 'font-weight', 'letter-spacing', 'color',
      'margin', 'padding', 'display',
      'background-color', 'background-image',
      'transition', 'animation', 'transform',
    ],
    maxElements: 400,
  },

  probe: {
    // elements worth probing for interaction (behavior + runtime vars)
    interactionSignals:
      '[role="tab"],[role="button"],[aria-expanded],[aria-controls],[data-state],[data-tab],'
      + '[data-acc-trigger],button,summary,[class*="accordion" i],[class*="tab" i],[class*="carousel" i],'
      + '[class*="slider" i],[class*="modal" i],[class*="swiper" i],[class*="embla" i],[class*="menu" i]',
    cap: 40,                    // max candidates probed per page (rest logged as skipped)
    settleQuietMs: 300,         // mutation-quiet window
    perCandidateTimeoutMs: 2500, // hard cap per candidate
    events: ['click'],          // extensible: hover/keydown later
    skipAnchorNavigation: true, // don't click <a href> that would navigate away
  },

  // Detector registry — each { name, run:(page)=>result }. Purely additive.
  detectors: [
    {
      name: 'libraries',
      run: (page) => page.evaluate(() => ({
        swiper: !!window.Swiper || !!document.querySelector('.swiper-slide,.swiper-wrapper'),
        embla: !!document.querySelector('.embla__container,.embla__slide'),
        keenSlider: !!window.KeenSlider || !!document.querySelector('.keen-slider'),
        gsap: !!window.gsap,
        scrollTrigger: !!(window.ScrollTrigger || (window.gsap && window.gsap.core)),
        lenis: !!window.Lenis || !!document.querySelector('[class*="lenis" i]'),
        framerMotion: !!document.querySelector('[data-framer-name],[data-projection-id]'),
        radix: !!document.querySelector('[data-radix-collection-item],[data-state][data-orientation]'),
      })),
    },
  ],
};
