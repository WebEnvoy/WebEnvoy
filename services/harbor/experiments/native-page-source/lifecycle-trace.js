// Diagnostic-only parent-process trace. No page content, protocol payloads or writes.
const nativeTraceIds = new WeakMap();
let nativeTraceObject = 0;
let nativeTraceSequence = 0;
function nativeTraceId(object) {
  if (!object) return null;
  if (!nativeTraceIds.has(object)) nativeTraceIds.set(object, ++nativeTraceObject);
  return nativeTraceIds.get(object);
}
function nativeTraceBrowser(registry, browser) {
  if (!browser) return null;
  const context = browser.browsingContext;
  const target = registry._browserToTarget.get(browser);
  const window = browser.ownerGlobal || browser.documentGlobal;
  return {
    browser: nativeTraceId(browser), window: nativeTraceId(window),
    tab: nativeTraceId(window?.gBrowser?.getTabForBrowser(browser)),
    context: context?.id ?? null, browserId: context?.browserId ?? null,
    document: context?.currentWindowGlobal?.innerWindowId ?? null,
    connected: browser.isConnected, target: target?.id() ?? null,
    indexedTarget: registry._browserIdToTarget.get(context?.browserId)?.id() ?? null,
    actor: nativeTraceId(registry._browserIdToActor.get(context?.browserId)),
  };
}
function nativeTrace(registry, kind, target = null, browser = null, other = null, actor = null) {
  if (++nativeTraceSequence > 1024) return;
  try {
    dump('WEBENVOY_LIFECYCLE ' + JSON.stringify({
      sequence: nativeTraceSequence, kind,
      target: target?.id() ?? null, disposed: target?._disposed ?? null,
      boundActor: nativeTraceId(target?._actor), actor: nativeTraceId(actor),
      actorContext: actor?.browsingContext?.id ?? null,
      actorDocument: actor?.manager?.innerWindowId ?? null,
      browser: nativeTraceBrowser(registry, browser), other: nativeTraceBrowser(registry, other),
      truncated: nativeTraceSequence === 1024,
    }) + '\n');
  } catch {
    dump('WEBENVOY_LIFECYCLE ' + JSON.stringify({sequence: nativeTraceSequence, kind: 'trace-unavailable'}) + '\n');
  }
}
