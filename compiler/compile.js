'use strict';

/**
 * compile() — compiler entry point.
 * Orchestrates Kernel job methods through EmitPlan, then product artifact emission.
 */

const path = require('path');
const { createKernel, KernelError, FailureKind } = require('./kernel');
const { emitArtifacts } = require('./artifacts');

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

  if (!options.skipNdg) {
    const t = Date.now();
    const ndg = await job.materializeNormalizedDesignGraph({
      document: options.document,
      graphId,
      rawDocumentId: options.rawDocumentId,
    });
    timings.ndgMs = Date.now() - t;
    steps.push({ stage: 'ndg', sliceId: ndg.sliceId, checksum: ndg.checksum });
  }

  if (engines.layout) {
    const t = Date.now();
    const layout = await job.projectLayoutIR({
      sliceId: options.layoutSliceId || `slice:layout:${graphId}`,
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

  if (engines.component) {
    const t = Date.now();
    const out = await job.projectComponentIR({
      sliceId: options.componentSliceId || `slice:component:${graphId}`,
    });
    timings.componentMs = Date.now() - t;
    steps.push({ stage: 'component-ir', sliceId: out.sliceId, checksum: out.checksum });
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

  if (engines.responsive) {
    const t = Date.now();
    const out = await job.projectResponsiveIR({
      sliceId: options.responsiveSliceId || `slice:responsive:${graphId}`,
    });
    timings.responsiveMs = Date.now() - t;
    steps.push({ stage: 'responsive-ir', sliceId: out.sliceId, checksum: out.checksum });
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
