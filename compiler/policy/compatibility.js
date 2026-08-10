'use strict';

const { PolicyError, PolicyErrorKind } = require('./errors');

/**
 * Compatibility between a resolved profile and a compile job context.
 * Configuration checks only.
 */
function checkCompatibility(profile, context = {}) {
  const issues = [];

  if (!profile || !profile.profileId) {
    throw new PolicyError(PolicyErrorKind.INCOMPATIBLE, 'profile required for compatibility check');
  }

  if (context.suiteVersion != null && profile.suiteVersion != null
      && profile.suiteVersion !== context.suiteVersion) {
    issues.push({
      code: 'suite_version',
      message: `profile suiteVersion ${profile.suiteVersion} != job ${context.suiteVersion}`,
    });
  }

  if (context.requiredProfileVersion != null && profile.profileVersion != null
      && profile.profileVersion !== context.requiredProfileVersion) {
    issues.push({
      code: 'profile_version',
      message: `profileVersion ${profile.profileVersion} != required ${context.requiredProfileVersion}`,
    });
  }

  if (context.requireAuthoritative === true && profile.valuesAuthoritative !== true) {
    issues.push({
      code: 'not_authoritative',
      message: 'job requires authoritative policy values',
    });
  }

  if (context.engineId && Array.isArray(profile.allowedEngineIds)
      && profile.allowedEngineIds.length > 0
      && !profile.allowedEngineIds.includes(context.engineId)) {
    issues.push({
      code: 'engine_not_allowed',
      message: `engine ${context.engineId} not in allowedEngineIds`,
    });
  }

  if (issues.length) {
    throw new PolicyError(
      PolicyErrorKind.INCOMPATIBLE,
      `policy incompatible: ${issues.map((i) => i.code).join(', ')}`,
      { issues, profileId: profile.profileId }
    );
  }

  return { ok: true, profileId: profile.profileId };
}

/**
 * Map profile gateMode → evaluateGate failClosed flag.
 */
function gateOptionsFromProfile(profile) {
  const mode = profile && profile.gateMode;
  return {
    failClosed: mode !== 'best_effort',
    gateMode: mode === 'best_effort' ? 'best_effort' : 'fail_closed',
  };
}

module.exports = { checkCompatibility, gateOptionsFromProfile };
