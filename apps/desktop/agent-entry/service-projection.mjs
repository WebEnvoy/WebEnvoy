const projectRuntimeError = value => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(['code', 'retryable'].filter(key => key in value).map(key => [key, value[key]]))
  : undefined;

const projectPage = value => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(['requested_url', 'current_url', 'title', 'status', 'error_reason', 'observed_at', 'page_id', 'page_ref', 'document_generation', 'origin', 'active', 'opener_page_id'].filter(key => key in value).map(key => [key, key === 'error_reason' ? projectRuntimeError(value[key]) : value[key]]))
  : undefined;

const projectLock = value => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(['owner', 'state', 'holder_ref', 'updated_at'].filter(key => key in value).map(key => [key, value[key]]))
  : undefined;

const providerDiagnosticStages = new Set(['page_list_request', 'page_relation_refresh', 'provider_snapshot']);
const providerDiagnosticPhases = new Set(['candidate_capture', 'candidate_query', 'control_read', 'accessibility_semantics', 'page_text', 'batch_verification', 'control_cleanup', 'response_projection']);
const providerDiagnosticOutcomes = new Set(['started', 'completed', 'unavailable', 'timeout', 'error']);
const projectProviderOperationDiagnostics = value => Array.isArray(value) ? value.slice(-12).flatMap(item => {
  if (!item || typeof item !== 'object' || Array.isArray(item) || !providerDiagnosticStages.has(item.stage) ||
      !providerDiagnosticOutcomes.has(item.outcome) || !Number.isSafeInteger(item.duration_ms) || item.duration_ms < 0 || item.duration_ms > 120_000 ||
      typeof item.observed_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(item.observed_at) || !Number.isFinite(Date.parse(item.observed_at)) ||
      Object.hasOwn(item, 'code') && (typeof item.code !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(item.code))) return [];
  return [{ stage: item.stage, ...(providerDiagnosticPhases.has(item.phase) ? { phase: item.phase } : {}), outcome: item.outcome, duration_ms: item.duration_ms, observed_at: item.observed_at,
    ...(Object.hasOwn(item, 'code') ? { code: item.code } : {}) }];
}) : [];

const ownerSessionRunStatuses = new Set(['pending', 'admitted', 'running', 'requires_user_action', 'manual_recovery_required', 'unknown_outcome']);
const safeIdentifier = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const safeRunId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const exactKeys = (value, required, optional = []) => {
  const keys = Object.keys(value);
  return required.every(key => Object.hasOwn(value, key)) && keys.every(key => required.includes(key) || optional.includes(key));
};

export function projectSessionSupervision(runtimeSessionRef, value) {
  const unavailable = code => ({ status: 'unavailable', error: { code } });
  const isSafeRef = typeof runtimeSessionRef === 'string' && runtimeSessionRef.length > 0 && runtimeSessionRef.length <= 256 && !/[\u0000-\u001f\u007f]/.test(runtimeSessionRef);
  if (!isSafeRef) return unavailable('owner_session_runs_invalid');
  if (value?.ok === false && value.error && typeof value.error === 'object' && !Array.isArray(value.error)) {
    return unavailable(typeof value.error.code === 'string' && safeIdentifier.test(value.error.code)
      ? value.error.code : 'owner_session_runs_unavailable');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !exactKeys(value, ['schema_version', 'runtime_session_ref', 'status', 'runs']) ||
      value.schema_version !== 'webenvoy.owner-session-runs/v1' || value.runtime_session_ref !== runtimeSessionRef ||
      value.status !== 'available' || !Array.isArray(value.runs)) return unavailable('owner_session_runs_invalid');
  const runs = [];
  const seen = new Set();
  for (const run of value.runs) {
    if (!run || typeof run !== 'object' || Array.isArray(run) ||
        !exactKeys(run, ['run_id', 'status', 'updated_at'], ['operation', 'failure_code']) ||
        typeof run.run_id !== 'string' || !safeRunId.test(run.run_id) || seen.has(run.run_id) ||
        !ownerSessionRunStatuses.has(run.status) || typeof run.updated_at !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(run.updated_at) || !Number.isFinite(Date.parse(run.updated_at)) ||
        (Object.hasOwn(run, 'operation') && (typeof run.operation !== 'string' || !safeIdentifier.test(run.operation))) ||
        (Object.hasOwn(run, 'failure_code') && (typeof run.failure_code !== 'string' || !safeIdentifier.test(run.failure_code)))) {
      return unavailable('owner_session_runs_invalid');
    }
    seen.add(run.run_id);
    runs.push({
      run_id: run.run_id,
      status: run.status,
      updated_at: run.updated_at,
      ...(Object.hasOwn(run, 'operation') ? { operation: run.operation } : {}),
      ...(Object.hasOwn(run, 'failure_code') ? { failure_code: run.failure_code } : {})
    });
  }
  return { status: 'available', runs };
}

export function projectSessionFacts(value, { allowTerminalStop = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const hasControlGeneration = Number.isSafeInteger(value.control_generation) && value.control_generation >= 0;
  const terminalStop = value.lifecycle_state === 'closed' && value.control_owner === 'none' &&
    value.control_lock && typeof value.control_lock === 'object' && !Array.isArray(value.control_lock) &&
    value.control_lock.owner === 'none' && value.control_lock.state === 'closed' && value.control_lock.holder_ref === null;
  if (!hasControlGeneration && !(allowTerminalStop && terminalStop)) return undefined;
  if (Object.hasOwn(value, 'control_generation') && !hasControlGeneration) return undefined;
  const result = Object.fromEntries(['schema_version', 'runtime_session_ref', 'identity_environment_ref', 'execution_identity_ref', 'profile_ref', 'provider_ref', 'provider_mode', 'lifecycle_state', 'created_at', 'last_seen_at', 'closed_at', 'availability', 'control_owner', 'control_generation'].filter(key => key in value).map(key => [key, value[key]]));
  if (value.availability && typeof value.availability === 'object' && !Array.isArray(value.availability)) result.availability = Object.fromEntries(['driver', 'cdp', 'viewer', 'snapshot', 'evidence'].filter(key => key in value.availability).map(key => [key, value.availability[key]]));
  if (value.current_page) result.current_page = projectPage(value.current_page);
  if (value.control_lock) result.control_lock = projectLock(value.control_lock);
  if (value.current_error) result.current_error = projectRuntimeError(value.current_error);
  const providerOperationDiagnostics = projectProviderOperationDiagnostics(value.provider_operation_diagnostics);
  if (providerOperationDiagnostics.length > 0) result.provider_operation_diagnostics = providerOperationDiagnostics;
  if (value.viewer_entry && typeof value.viewer_entry === 'object' && !Array.isArray(value.viewer_entry)) {
    result.viewer_entry = Object.fromEntries(['availability', 'access_mode', 'transport', 'input_capabilities', 'unavailable_reason'].filter(key => key in value.viewer_entry).map(key => [key, value.viewer_entry[key]]));
  }
  for (const key of ['lock_owner', 'lock_state', 'holder_ref']) if (key in value) result[key] = value[key];
  if (value.control_precondition && typeof value.control_precondition === 'object' && !Array.isArray(value.control_precondition)) {
    result.control_precondition = Object.fromEntries(['schema_version', 'control_owner', 'lock_owner', 'lock_state', 'holder_ref', 'control_generation'].filter(key => key in value.control_precondition).map(key => [key, value.control_precondition[key]]));
  }
  return result;
}

export function projectHarborResponse(req, value) {
  const pathname = new URL(req.url, 'http://owner.local').pathname;
  const allowTerminalStop = req.method === 'POST' && /^\/runtime\/sessions\/[^/]+\/stop$/.test(pathname);
  if (pathname === '/runtime/sessions') {
    if (Array.isArray(value)) {
      const sessions = value.map(projectSessionFacts);
      return sessions.every(Boolean) ? sessions : undefined;
    }
    if (value && typeof value === 'object' && Array.isArray(value.sessions)) {
      const sessions = value.sessions.map(projectSessionFacts);
      if (!sessions.every(Boolean)) return undefined;
      return { ...('schema_version' in value ? { schema_version: value.schema_version } : {}), ...('status' in value ? { status: value.status } : {}), sessions };
    }
    return value && typeof value === 'object' && typeof value.error === 'string' ? { error: value.error } : undefined;
  }
  if (value && typeof value === 'object' && value.status === 'unavailable') {
    const result = Object.fromEntries(['status', 'failure_class', 'message', 'retryable'].filter(key => key in value).map(key => [key, value[key]]));
    if (value.current_error) result.current_error = projectRuntimeError(value.current_error);
    return result;
  }
  if (value && typeof value === 'object' && typeof value.error === 'string') return { error: value.error };
  return projectSessionFacts(value, { allowTerminalStop });
}
