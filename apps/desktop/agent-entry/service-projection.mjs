const projectRuntimeError = value => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(['code', 'retryable'].filter(key => key in value).map(key => [key, value[key]]))
  : undefined;

const projectPage = value => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(['requested_url', 'current_url', 'title', 'status', 'error_reason', 'observed_at', 'page_id', 'page_ref', 'document_generation', 'origin', 'active', 'opener_page_id'].filter(key => key in value).map(key => [key, key === 'error_reason' ? projectRuntimeError(value[key]) : value[key]]))
  : undefined;

const projectLock = value => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(['owner', 'state', 'holder_ref', 'updated_at'].filter(key => key in value).map(key => [key, value[key]]))
  : undefined;

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
