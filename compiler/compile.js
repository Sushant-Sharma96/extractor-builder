'use strict';

/**
 * compile() — compiler entry point.
 * Orchestrates Kernel job methods through EmitPlan, then product artifact emission.
 */

const path = require('path');
const { createKernel, KernelError, FailureKind } = require('./kernel');
const { emitArtifacts } = require('./artifacts');
const { detectGeometry } = require('./geometry');

const DEFAULT_ENGINES = Object.freeze({
  layout: true,
  constraint: true,
  component: true,
  token: true,
  semantic: true,
  responsive: true,
  accessibility: true,
  resolved: true,
  emit: true,
  artifacts: true,
});

/**
 * @param {object} options
 * @param {object} [options.document] — raw design tree
 * @param {string} [options.graphId]
 * @param {string} [options.policyProfileId]
 * @param {object} [options.policyProfile]
 * @param {object} [options.engines] — toggle optional stages (all default true)
 * @param {object} [options.kernel] — existing kernel
 * @param {object} [options.job] — existing job
 * @param {string} [options.outDir] — write HTML/CSS/JS here when set
 * @param {boolean} [options.writeArtifacts] — force disk write (implies temp outDir if missing)
 * @param {string} [options.renderer] — Phase 5 (NARROWED — toggle only, see
 *   docs/COMPILER_MIGRATION_BLUEPRINT.md Phase 5 STATUS note) — forwarded verbatim to
 *   `emitArtifacts()`'s own `opts.renderer` ('legacy' default | 'ir-experimental').
 *   Deliberately does NOT auto-enable `engines.layout`/`engines.component`/
 *   `engines.responsive` when set to 'ir-experimental': the ir-experimental renderer
 *   (`compiler/artifacts/ir-experimental-renderer.js`) is self-contained — it
 *   re-materializes its own NDG and runs its own geometry/layout/component/responsive
 *   detection directly from `options.document`, the same way the diagnostic scripts
 *   (`scripts/render-byte-diff.js`, `scripts/responsive-dual-run.js`) it was promoted
 *   from do — rather than consuming `job.projectLayoutIR()`/`projectComponentIR()`/
 *   `projectResponsiveIR()`'s published IR slices via EmitPlan's `layoutChoices`. Those
 *   engines' IR is therefore not required for `renderer: 'ir-experimental'` to produce
 *   real output; `engines.resolved`/`engines.emit`/`engines.artifacts` (all default
 *   `true`) are what's actually needed, since `compile()` only calls `emitArtifacts()`
 *   at all when `engines.artifacts` is true. If a future phase switches the
 *   ir-experimental renderer to consume those IR slices instead of self-materializing,
 *   revisit this default — it would need to imply those engines then.
 * @returns {Promise<object>}
 */
async function compile(options = {}) {
  if (!options.document && !(options.job && options.skipNdg)) {
    throw new KernelError(FailureKind.MISSING_INPUT, 'compile requires document (or job with skipNdg)');
  }

  const engines = { ...DEFAULT_ENGINES, ...(options.engines || {}) };
  const t0 = Date.now();
  const kernel = options.kernel || createKernel({
    policyProfileId: options.policyProfileId,
    contractSuiteVersion: options.contractSuiteVersion,
  });
  const job = options.job || kernel.createJob({
    policyProfileId: options.policyProfileId,
    policyProfile: options.policyProfile,
    seed: options.seed,
    jobId: options.jobId,
  });

  const steps = [];
  const timings = {};
  const graphId = options.graphId || `g:compile:${Date.now()}`;

  // Kernel Integration (docs/COMPILER_REDESIGN_ROADMAP.md Phase 6 follow-on)
  // — hoisted so the already-materialized NDG graph can be threaded through
  // to emitArtifacts() below for the `renderer:'ir-experimental'` path,
  // instead of that renderer re-materializing an equivalent graph itself
  // (compiler/artifacts/ir-experimental-renderer.js's opts.precomputedNdg,
  // added in Phase 6 increment 2). The legacy renderer path is unaffected —
  // it never reads this variable.
  let ndg = null;
  if (!options.skipNdg) {
    const t = Date.now();
    ndg = await job.materializeNormalizedDesignGraph({
      document: options.document,
      graphId,
      rawDocumentId: options.rawDocumentId,
    });
    timings.ndgMs = Date.now() - t;
    steps.push({ stage: 'ndg', sliceId: ndg.sliceId, checksum: ndg.checksum });
  }

  // Kernel Integration, slice 2 — hoisted so the real projected LayoutIR's
  // `interpretations` (compiler/layout/materialize.js's materializeLayoutIR()
  // exposes the exact same interpretGraph() output ir-experimental-renderer.js
  // would otherwise self-compute) can be threaded through to emitArtifacts()
  // below via opts.precomputedInterpretations (Phase 6 increment 4).
  //
  // Root-cause note (found while verifying this slice, NOT a new heuristic):
  // materializeLayoutIR() defaults `recognitionHintsByNode` to `{}` whenever
  // its caller doesn't supply one (compiler/layout/materialize.js line 47),
  // and this compile() call never did — that gap was invisible before this
  // integration because nothing consumed the Kernel's LayoutIR for
  // rendering. ir-experimental-renderer.js's OWN self-materialized path
  // always computed real hints via `detectGeometry(graph, {})` (the same
  // call below, same empty opts — no detector redesign). Without this, 2
  // real container nodes in the why-participate fixture (src:39:9/39:22,
  // the two-cards-same-row geometry case documented elsewhere in this repo)
  // lose their inferred flow-row classification and fall back to `unknown`,
  // which cascades into a large, wrong rendering diff for their entire
  // subtree — verified empirically before this fix, not assumed.
  const detectedGeometry = ndg ? detectGeometry(ndg.graph, {}) : null;
  let layout = null;
  if (engines.layout) {
    const t = Date.now();
    layout = await job.projectLayoutIR({
      sliceId: options.layoutSliceId || `slice:layout:${graphId}`,
      recognitionHintsByNode: detectedGeometry ? detectedGeometry.recognitionHintsByNode : undefined,
    });
    timings.layoutMs = Date.now() - t;
    steps.push({ stage: 'layout-ir', sliceId: layout.sliceId, checksum: layout.checksum });

    if (engines.constraint) {
      const tc = Date.now();
      const solved = await job.solveLayoutConstraints({
        baselineSliceId: layout.sliceId,
        sliceId: options.solvedSliceId || `slice:layout-solved:${graphId}`,
      });
      timings.constraintMs = Date.now() - tc;
      steps.push({
        stage: 'layout-ir-solved',
        sliceId: solved.sliceId,
        checksum: solved.checksum,
      });
    }
  }

  // Kernel Integration, slice 3 — hoisted so the real projected ComponentIR's
  // `.detected` (compiler/components/materialize.js's materializeComponentIR()
  // exposes the exact same detectComponents() output ir-experimental-renderer.js
  // would otherwise self-compute) can be threaded through to emitArtifacts()
  // below via opts.precomputedComponentRecognition (Phase 6 increment 3).
  let componentIr = null;
  if (engines.component) {
    const t = Date.now();
    componentIr = await job.projectComponentIR({
      sliceId: options.componentSliceId || `slice:component:${graphId}`,
    });
    timings.componentMs = Date.now() - t;
    steps.push({ stage: 'component-ir', sliceId: componentIr.sliceId, checksum: componentIr.checksum });
  }

  if (engines.token) {
    const t = Date.now();
    const out = await job.projectTokenIR({
      sliceId: options.tokenSliceId || `slice:token:${graphId}`,
    });
    timings.tokenMs = Date.now() - t;
    steps.push({ stage: 'token-ir', sliceId: out.sliceId, checksum: out.checksum });
  }

  if (engines.semantic) {
    const t = Date.now();
    const out = await job.projectSemanticIR({
      sliceId: options.semanticSliceId || `slice:semantic:${graphId}`,
    });
    timings.semanticMs = Date.now() - t;
    steps.push({ stage: 'semantic-ir', sliceId: out.sliceId, checksum: out.checksum });
  }

  // Kernel Integration, slice 4 — hoisted so the real projected ResponsiveIR's
  // `.detected` (compiler/responsive/materialize.js's materializeResponsiveIR()
  // exposes the exact same detectResponsive() output ir-experimental-renderer.js
  // would otherwise self-compute) can be threaded through to emitArtifacts()
  // below via opts.precomputedResponsive (Phase 6 increment 5).
  let responsiveIr = null;
  if (engines.responsive) {
    const t = Date.now();
    responsiveIr = await job.projectResponsiveIR({
      sliceId: options.responsiveSliceId || `slice:responsive:${graphId}`,
    });
    timings.responsiveMs = Date.now() - t;
    steps.push({ stage: 'responsive-ir', sliceId: responsiveIr.sliceId, checksum: responsiveIr.checksum });
  }

  if (engines.accessibility) {
    const t = Date.now();
    const out = await job.projectAccessibilityIR({
      sliceId: options.accessibilitySliceId || `slice:a11y:${graphId}`,
      semanticSliceId: options.semanticSliceId || `slice:semantic:${graphId}`,
      skipSemantic: !engines.semantic,
    });
    timings.accessibilityMs = Date.now() - t;
    steps.push({ stage: 'a11y-ir', sliceId: out.sliceId, checksum: out.checksum });
  }

  let resolved = null;
  if (engines.resolved) {
    const t = Date.now();
    resolved = await job.projectResolvedIR({
      sliceId: options.resolvedSliceId || `slice:resolved:${graphId}`,
      graphId,
    });
    timings.resolvedMs = Date.now() - t;
    steps.push({
      stage: 'resolved-ir',
      sliceId: resolved.sliceId,
      checksum: resolved.checksum,
      resolvedId: resolved.resolvedId,
    });
  }

  let emitPlan = null;
  if (engines.emit) {
    if (!engines.resolved) {
      throw new KernelError(
        FailureKind.INVARIANT_VIOLATION,
        'EmitPlan requires ResolvedIR (engines.resolved must be true)'
      );
    }
    const t = Date.now();
    emitPlan = await job.projectEmitPlan({
      sliceId: options.emitSliceId || `slice:emit:${graphId}`,
      resolvedSliceId: resolved.sliceId,
    });
    timings.emitPlanMs = Date.now() - t;
    steps.push({
      stage: 'emit-plan',
      sliceId: emitPlan.sliceId,
      checksum: emitPlan.checksum,
      planId: emitPlan.planId,
    });
  }

  let artifacts = null;
  if (engines.artifacts) {
    if (!engines.emit) {
      throw new KernelError(
        FailureKind.INVARIANT_VIOLATION,
        'Artifacts require EmitPlan (engines.emit must be true)'
      );
    }
    if (!options.document) {
      throw new KernelError(
        FailureKind.MISSING_INPUT,
        'Artifacts require document for product emitter adapter'
      );
    }
    const t = Date.now();
    const fingerprint = job.getFingerprint();
    const workspace = job.attachWorkspace();
    let outDir = options.outDir || null;
    if (!outDir && options.writeArtifacts) {
      outDir = path.join(
        options.outputRoot || path.join(__dirname, '..', 'output'),
        options.slug || `compile-${graphId.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}`
      );
    }
    artifacts = await emitArtifacts({
      document: options.document,
      fingerprint,
      workspace,
      emitPlan: workspace.getIrSlice(emitPlan.sliceId),
      // Kernel Integration — only read by emitArtifactsIrExperimental() (the
      // legacy path never references opts.graphId); ensures the graphId this
      // ir-experimental render is labeled with matches the one `ndg` (passed
      // below as precomputedNdg) was actually materialized under.
      graphId,
      outDir,
      title: options.title,
      slug: options.slug,
      url: options.url,
      imageUrls: options.imageUrls,
      imageFillUrls: options.imageFillUrls,
      svgMarkup: options.svgMarkup,
      fonts: options.fonts,
      assets: options.assets,
      localByUrl: options.localByUrl,
      downloadImages: options.downloadImages,
      useCache: options.useCache,
      emitMode: options.emitMode,
      renderer: options.renderer,
      // Kernel Integration — only meaningful for renderer:'ir-experimental'
      // (compiler/artifacts/index.js's emitArtifactsIrExperimental() reads
      // this; the legacy path ignores it entirely). `null` when
      // options.skipNdg is set, in which case the renderer transparently
      // falls back to self-materializing exactly as before this change.
      precomputedNdg: ndg,
      // Kernel Integration, slice 2 — `null` when engines.layout is false,
      // in which case the renderer's own `||` fallback (Phase 6 increment 4)
      // self-computes interpretations exactly as before this change.
      precomputedInterpretations: layout && layout.interpretations,
      // Kernel Integration, slice 3 — `null` when engines.component is
      // false, in which case the renderer's own `||` fallback (Phase 6
      // increment 3) self-computes componentRecognition exactly as before.
      precomputedComponentRecognition: componentIr && componentIr.detected,
      // Kernel Integration, slice 4 — `null` when engines.responsive is
      // false, in which case the renderer's own `||` fallback (Phase 6
      // increment 5) self-computes the responsive detection exactly as
      // before.
      precomputedResponsive: responsiveIr && responsiveIr.detected,
    });
    timings.artifactsMs = Date.now() - t;
    steps.push({
      stage: 'artifacts',
      artifactFingerprint: artifacts.artifactFingerprint,
      dir: artifacts.dir,
      cached: artifacts.cached === true,
    });
  }

  timings.totalMs = Date.now() - t0;

  return {
    ok: true,
    graphId,
    fingerprint: job.getFingerprint(),
    steps,
    timings,
    resolved: resolved
      ? {
        sliceId: resolved.sliceId,
        checksum: resolved.checksum,
        resolvedId: resolved.resolvedId,
        missingStages: resolved.missingStages,
        conflicts: resolved.conflicts,
      }
      : null,
    emitPlan: emitPlan
      ? {
        sliceId: emitPlan.sliceId,
        checksum: emitPlan.checksum,
        planId: emitPlan.planId,
        resolvedId: emitPlan.resolvedId,
      }
      : null,
    artifacts: artifacts
      ? {
        ok: artifacts.ok,
        cached: artifacts.cached,
        artifactFingerprint: artifacts.artifactFingerprint,
        renderer: artifacts.renderer,
        rendererSwitchedFrom: artifacts.rendererSwitchedFrom,
        dir: artifacts.dir,
        paths: artifacts.paths,
        html: artifacts.html,
        css: artifacts.css,
        js: artifacts.js,
        sections: artifacts.sections,
        sectionsSummary: artifacts.sectionsSummary,
        summary: artifacts.summary,
        timings: artifacts.timings,
        package: artifacts.package
          ? { dir: artifacts.package.dir, slug: artifacts.package.slug, assets: artifacts.package.assets }
          : null,
      }
      : null,
    job,
    kernel,
  };
}

module.exports = {
  compile,
  DEFAULT_ENGINES,
};
