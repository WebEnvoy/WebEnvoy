const RETIRED_STATE = 'retired';
const RETIRED_BINDING_REASON = 'retired_binding';
const UNQUALIFIED_REASON = 'unqualified';

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Classify the historical Camoufox installation field without touching its
 * paths. The record remains local evidence only; it is never a launch input.
 */
export function classifyCamoufoxBinding(installation) {
  if (!record(installation)) throw new Error('installation_configuration_invalid');
  return Object.hasOwn(installation, 'camoufoxArtifact')
    ? { state: RETIRED_STATE, reason: RETIRED_BINDING_REASON }
    : { state: RETIRED_STATE, reason: UNQUALIFIED_REASON };
}

export const CAMOUFOX_RETIRED_STATE = RETIRED_STATE;
export const CAMOUFOX_RETIRED_BINDING_REASON = RETIRED_BINDING_REASON;
export const CAMOUFOX_UNQUALIFIED_REASON = UNQUALIFIED_REASON;
