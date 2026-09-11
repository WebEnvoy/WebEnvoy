import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, readFile, rename, rm, unlink } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { trustManagedInteractionOperation, type ManagedInteractionInput, type ManagedInteractionResult } from "./managed-interaction.js";
import { managedPageObservationExpression, normalizeManagedProviderObservation, trustManagedPageObserver } from "./managed-observation.js";
import { opaqueRef } from "./refs.js";
import { prepareProfileStorage } from "./profile-storage.js";
import type { LocalProviderLaunchInput, LocalProviderLaunchResult, LocalProviderPageFacts, LocalProviderScreenshotFacts, LocalProviderViewerFrame, LocalProviderViewerInput, LocalProviderViewerInputResult, RuntimeErrorCode, RuntimeFact } from "./runtime-session-types.js";

export const OBSCURA_VALIDATED_COMMIT = "01e1caa33360f6c02643457307894ec885e82eef";
export const OBSCURA_VALIDATED_SHA256 = "d05336b807fde6b27221af3f1427550666d1f855166c3cc94be537a08b4ba98d";

type Control = { target_ref: string; role: string; name: string; enabled: boolean; node_id: number };
type SnapshotState = { page_ref: string; observation_ref: string; document_key: string; controls: Control[] };
type ManagedLocalStorage = Map<string, Array<[string, string]>>;

const OBSCURA_STORAGE_FILE = "obscura-local-storage-v1.json";
const MAX_STORAGE_BYTES = 4 * 1024 * 1024;
const MAX_VIEWER_FRAME_BYTES = 2 * 1024 * 1024;
const viewerFrameDocumentKeys = new WeakMap<LocalProviderViewerFrame, string>();

export async function launchObscuraProvider(input: LocalProviderLaunchInput): Promise<LocalProviderLaunchResult> {
  const storage = await prepareProfileStorage(input.profile_storage_ref);
  let child: ChildProcess | undefined;
  let client: ObscuraCdpClient | undefined;
  let closed = false;
  let reportDriverLost!: () => void;
  const driverLost = new Promise<void>(resolve => { reportDriverLost = resolve; });
  try {
    if (!input.browser_path) throw new Error("Obscura binary path is missing.");
    const binary = await readFile(input.browser_path);
    if (createHash("sha256").update(binary).digest("hex") !== OBSCURA_VALIDATED_SHA256) {
      throw new Error(`Obscura binary is not the validated ${OBSCURA_VALIDATED_COMMIT} build.`);
    }
    const managedStorage = storage.persistent ? await readManagedLocalStorage(storage.profileDir) : new Map<string, Array<[string, string]>>();
    const port = await unusedLoopbackPort();
    const args = ["serve", "--host", "127.0.0.1", "--port", String(port), "--storage-dir", storage.profileDir, "--max-connections", "1"];
    if (process.env.HARBOR_OBSCURA_ALLOW_PRIVATE_NETWORK === "1") args.push("--allow-private-network");
    const configuration = input.identity_environment?.environment;
    const proxy = configuration?.proxy.proxy_ref ? input.resolve_proxy?.(configuration.proxy.proxy_ref) : null;
    if (configuration?.proxy.proxy_ref && !proxy) throw new Error("Obscura proxy could not be resolved.");
    child = spawn(input.browser_path, args, {
      stdio: "ignore",
      env: {
        ...process.env,
        OBSCURA_PROFILE: "0",
        OBSCURA_ROTATE_PROFILE: "0",
        OBSCURA_CDP_COMMAND_TIMEOUT_MS: "60000",
        ...(configuration?.timezone ? { OBSCURA_TIMEZONE: configuration.timezone } : {}),
        ...(proxy ? { OBSCURA_PROXY: proxy } : {})
      }
    });
    const version = await waitForVersion(port, input.timeout_ms, child);
    client = await ObscuraCdpClient.connect(version.webSocketDebuggerUrl, input.timeout_ms, () => { if (!closed) reportDriverLost(); });
    const created = await client.send("Target.createTarget", { url: "about:blank" });
    const targetId = stringField(created, "targetId");
    const attached = await client.send("Target.attachToTarget", { targetId, flatten: true });
    const sessionId = stringField(attached, "sessionId");
    if (configuration?.viewport) {
      const [width, height] = configuration.viewport.split("x").map(Number);
      await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
    }
    let interactionContextId = 0;
    let snapshot: SnapshotState | null = null;
    let preloadId: string | undefined;
    let lastViewerFrame: LocalProviderViewerFrame | undefined;
    const refreshStoragePreload = async () => {
      if (preloadId) await client!.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: preloadId }, sessionId);
      const added = await client!.send("Page.addScriptToEvaluateOnNewDocument", { source: storagePreloadExpression(managedStorage) }, sessionId);
      preloadId = stringField(added, "identifier");
    };
    const checkpointStorage = async () => {
      if (!storage.persistent) return;
      const state = await currentLocalStorage(client!, sessionId);
      if (!state) return;
      managedStorage.set(state.origin, state.entries);
      await writeManagedLocalStorage(storage.profileDir, managedStorage);
    };
    const navigate = async (url: string) => {
      await checkpointStorage();
      await refreshStoragePreload();
      snapshot = null;
      lastViewerFrame = undefined;
      await client!.send("Page.navigate", { url, waitUntil: "load" }, sessionId, input.timeout_ms);
      interactionContextId = await createInteractionContext(client!, sessionId);
      return pageFacts(client!, sessionId, url);
    };
    const page = await navigate(input.url);
    const evidenceRef = opaqueRef("validation");
    const facts: RuntimeFact[] = [
      ...storage.facts,
      { key: "provider.id", source: "configured", value: "obscura" },
      { key: "provider.version.commit", source: "validation_evidence", value: OBSCURA_VALIDATED_COMMIT, evidence_ref: evidenceRef },
      { key: "provider.binary.sha256", source: "validation_evidence", value: OBSCURA_VALIDATED_SHA256, evidence_ref: evidenceRef },
      { key: "provider.driver.transport", source: "configured", value: "harbor_owned_single_cdp_websocket" },
      { key: "provider.profile.index", source: "configured", value: "0" },
      { key: "provider.profile.rotation", source: "configured", value: "disabled" },
      { key: "provider.local_storage.persistence", source: "configured", value: storage.persistent ? "managed_checkpoint_v1_limited" : "ephemeral" },
      { key: "browser.launch", source: "observed", value: "ready", evidence_ref: evidenceRef },
      { key: "cdp.version", source: "observed", value: `${version.Browser} ${version["Protocol-Version"]}`, evidence_ref: evidenceRef }
    ];
    return {
      status: "ready",
      execution_surface: "local_provider",
      driver_ref: opaqueRef("driver"),
      driver_kind: "chromium_cdp",
      cdp_ref: opaqueRef("cdp"),
      viewer_entry: { availability: "available", access_mode: "interactive", transport: "remote_browser_viewer", input_capabilities: ["keyboard_mouse"] },
      page,
      facts,
      openUrl: navigate,
      observePage: trustManagedPageObserver(async () => {
        const result = await client!.send("Runtime.evaluate", { expression: managedPageObservationExpression, returnByValue: true }, sessionId);
        return normalizeManagedProviderObservation(remoteValue(result));
      }),
      interaction: trustManagedInteractionOperation(async action => {
        try {
          const result = await interact(client!, sessionId, interactionContextId, action, snapshot);
          snapshot = result.next;
          if (result.result.status === "completed") {
            await checkpointStorage();
            await refreshStoragePreload();
          }
          return result.result;
        } catch (cause) {
          if (cause instanceof ObscuraTransportError) throw cause;
          const dispatched = ["click", "input", "press", "scroll"].includes(action.action);
          return { status: dispatched ? "unknown_outcome" : "unavailable", dispatch_state: dispatched ? "dispatched" : "not_dispatched", failure_class: "managed_interaction_driver_unavailable" };
        }
      }),
      captureScreenshot: async () => screenshot(client!, sessionId),
      captureViewerFrame: async () => {
        lastViewerFrame = await viewerFrame(client!, sessionId, lastViewerFrame);
        return lastViewerFrame;
      },
      viewerInput: async action => {
        if (!lastViewerFrame || action.frame_ref !== lastViewerFrame.frame_ref) return viewerRefused("viewer_frame_stale");
        let dispatched = false;
        try {
          const currentFrame = await viewerFrame(client!, sessionId, lastViewerFrame);
          lastViewerFrame = currentFrame;
          if (action.frame_ref !== currentFrame.frame_ref) return viewerRefused("viewer_frame_stale");
          if (action.action === "navigate") {
            const url = safeViewerUrl(action.url);
            if (!url) return viewerRefused("viewer_navigation_refused");
            dispatched = true;
            await navigate(url);
          } else {
            if (action.action === "click") {
              if (!viewerPoint(action, lastViewerFrame)) return viewerRefused("viewer_coordinate_refused");
              dispatched = true;
              await client!.send("Input.dispatchMouseEvent", { type: "mousePressed", x: action.x, y: action.y, button: "left", clickCount: 1 }, sessionId);
              await client!.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: action.x, y: action.y, button: "left", clickCount: 1 }, sessionId);
            } else if (action.action === "input") {
              if (!viewerPoint(action, lastViewerFrame) || !action.text || action.text.length > 2048) return viewerRefused("viewer_input_refused");
              const nodeId = await viewerControlAtPoint(client!, sessionId, action.x, action.y);
              if (!nodeId) return viewerRefused("viewer_input_target_unavailable");
              await focusControl(client!, sessionId, nodeId);
              dispatched = true;
              await client!.send("Input.insertText", { text: action.text }, sessionId);
              await dispatchInputEvent(client!, sessionId);
            } else if (action.action === "press") {
              dispatched = true;
              await client!.send("Input.dispatchKeyEvent", { type: "keyDown", key: action.key }, sessionId);
              await client!.send("Input.dispatchKeyEvent", { type: "keyUp", key: action.key }, sessionId);
            } else {
              if (!Number.isSafeInteger(action.delta_y) || action.delta_y === 0 || Math.abs(action.delta_y) > 2000) return viewerRefused("viewer_scroll_refused");
              dispatched = true;
              await client!.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 1, y: 1, deltaX: 0, deltaY: action.delta_y }, sessionId);
            }
            lastViewerFrame = undefined;
            await checkpointStorage();
            await refreshStoragePreload();
          }
          const frame = await viewerFrame(client!, sessionId, lastViewerFrame);
          lastViewerFrame = frame;
          return { status: "completed", dispatch_state: "dispatched", frame, page: await pageFacts(client!, sessionId, action.action === "navigate" ? action.url : "viewer_input") };
        } catch (cause) {
          lastViewerFrame = undefined;
          if (cause instanceof ObscuraTransportError) throw cause;
          return { status: dispatched ? "unknown_outcome" : "unavailable", dispatch_state: dispatched ? "dispatched" : "not_dispatched", failure_class: "viewer_input_driver_unavailable" };
        }
      },
      driverLost,
      close: async () => {
        if (closed) return;
        closed = true;
        let checkpointError: unknown;
        try { if (client?.isOpen()) await checkpointStorage(); }
        catch (cause) { checkpointError = cause; }
        finally {
          client?.close();
          await stop(child!);
          if (!storage.persistent) await rm(storage.profileDir, { recursive: true, force: true });
        }
        if (checkpointError) throw checkpointError;
      }
    };
  } catch (cause) {
    client?.close();
    if (child) await stop(child);
    if (!storage.persistent) await rm(storage.profileDir, { recursive: true, force: true });
    return unavailable(/hash|validated/i.test(safeMessage(cause)) ? "provider_unavailable" : "launch_failed", `Obscura Driver launch failed: ${safeMessage(cause)}`, storage.facts);
  }
}

async function interact(client: ObscuraCdpClient, sessionId: string, contextId: number, input: ManagedInteractionInput, previous: SnapshotState | null): Promise<{ result: ManagedInteractionResult; next: SnapshotState | null }> {
  const refused = (failure_class: string, dispatched = false) => ({ result: { status: dispatched ? "unknown_outcome" : "unavailable", dispatch_state: dispatched ? "dispatched" : "not_dispatched", failure_class } as ManagedInteractionResult, next: null });
  if (await currentOrigin(client, sessionId) !== input.expected_origin) return refused("managed_public_origin_denied");
  if (input.action !== "snapshot" && (!previous || previous.page_ref !== input.page_ref || previous.observation_ref !== input.observation_ref)) return refused("managed_interaction_stale_target");
  let dispatched = false;
  if (input.action !== "snapshot") {
    const current = await snapshotPage(client, sessionId, contextId, previous!.page_ref);
    if (current.document_key !== previous!.document_key || JSON.stringify(controlShape(current.controls)) !== JSON.stringify(controlShape(previous!.controls))) return refused("managed_interaction_stale_target");
    const target = input.target_ref ? previous!.controls.find(item => item.target_ref === input.target_ref) : undefined;
    if (["click", "input", "press"].includes(input.action) && !target) return refused("managed_interaction_target_required");
    if (target && !target.enabled) return refused("managed_interaction_target_unavailable");
    if (input.action === "click") {
      const point = await controlPoint(client, sessionId, target!.node_id);
      dispatched = true;
      await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 }, sessionId);
      await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 }, sessionId);
    } else if (input.action === "input") {
      if (target!.role !== "textbox" || typeof input.text !== "string" || /password|token|cookie|secret|credential|authorization|验证码|密码|口令|密钥/i.test(input.text)) return refused("managed_interaction_input_refused");
      await focusControl(client, sessionId, target!.node_id);
      dispatched = true;
      await client.send("Input.insertText", { text: input.text }, sessionId);
      await dispatchInputEvent(client, sessionId);
    } else if (input.action === "press") {
      if (!input.key) return refused("managed_interaction_key_refused");
      await focusControl(client, sessionId, target!.node_id);
      dispatched = true;
      await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: input.key }, sessionId);
      await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: input.key }, sessionId);
    } else if (input.action === "scroll") {
      const delta = Number(input.delta_y);
      if (!Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > 2000) return refused("managed_interaction_scroll_refused");
      dispatched = true;
      await client.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 1, y: 1, deltaX: 0, deltaY: delta }, sessionId);
    } else if (input.action === "wait") {
      const deadline = Date.now() + (input.timeout_ms ?? 5000);
      let matched = false;
      while (Date.now() < deadline) {
        if (await currentOrigin(client, sessionId) !== input.expected_origin) return refused("managed_public_origin_denied");
        const next = await snapshotPage(client, sessionId, contextId, previous!.page_ref);
        const changed = next.document_key !== previous!.document_key || JSON.stringify(controlShape(next.controls)) !== JSON.stringify(controlShape(previous!.controls));
        const previousTarget = input.target_ref ? previous!.controls.find(item => item.target_ref === input.target_ref) : undefined;
        const target = previousTarget ? next.controls.find(item => item.node_id === previousTarget.node_id) : undefined;
        if (input.wait_for === "page_changed" ? changed : input.wait_for === "text" ? next.text.includes(input.text ?? "") : target?.enabled) { matched = true; break; }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (!matched) return refused("managed_interaction_wait_timeout");
    }
  }
  if (await currentOrigin(client, sessionId) !== input.expected_origin) return refused("managed_public_origin_denied", dispatched);
  const next = await snapshotPage(client, sessionId, contextId, previous?.page_ref);
  const page = await pageFacts(client, sessionId, input.expected_origin);
  return { result: { status: "completed", dispatch_state: dispatched ? "dispatched" : "not_dispatched", page, snapshot: { page_ref: next.page_ref, observation_ref: next.observation_ref, controls: publicControls(next.controls), text: next.text, truncated: next.truncated } }, next };
}

async function snapshotPage(client: ObscuraCdpClient, sessionId: string, contextId: number, pageRef?: string): Promise<SnapshotState & { text: string; truncated: boolean }> {
  const result = await client.send("Runtime.evaluate", { expression: snapshotExpression, returnByValue: true, contextId }, sessionId);
  const value = remoteValue(result) as { document_key?: unknown; controls?: unknown; text?: unknown; truncated?: unknown };
  if (typeof value?.document_key !== "string" || !Array.isArray(value.controls) || typeof value.text !== "string" || typeof value.truncated !== "boolean") throw new Error("Invalid Obscura snapshot.");
  const controls = value.controls.slice(0, 64).flatMap(item => {
    const control = item as Record<string, unknown>;
    const name = obscuraPublicText(control.name, 160);
    const node_id = Number(control.node_id);
    if (typeof control.role !== "string" || typeof control.enabled !== "boolean" || !name || !Number.isSafeInteger(node_id) || node_id <= 0) return [];
    return [{ target_ref: opaqueRef("target"), role: control.role, name, enabled: control.enabled, node_id }];
  });
  const text = obscuraPublicTextBlock(value.text, 4096);
  return { page_ref: pageRef ?? opaqueRef("page"), observation_ref: opaqueRef("observation"), document_key: value.document_key, controls, text, truncated: value.truncated || text.length >= 4096 };
}

const snapshotExpression = `(() => {
  const sensitive = /password|passwd|token|cookie|secret|credential|authorization|session|one.time|sid\\s*=|eyJ[a-zA-Z0-9_-]*\\./i;
  const clean = (value, limit) => { const text=String(value||'').replace(/\\s+/g,' ').trim(); return text.length<=limit&&!sensitive.test(text)?text:''; };
  const visible = el => { const r=el.getBoundingClientRect(),s=getComputedStyle(el); return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'; };
  const role = el => el.matches('input,textarea,[contenteditable=true]') ? 'textbox' : el.matches('button,[role=button]') ? 'button' : el.matches('a[href],[role=link]') ? 'link' : el.getAttribute('role');
  let state=globalThis.__webenvoySnapshotState;
  if(!state||state.document!==document){state={document,generation:0};state.observer=new MutationObserver(()=>{state.generation++});state.observer.observe(document,{subtree:true,childList:true,attributes:true,characterData:true});globalThis.__webenvoySnapshotState=state;}
  else if(state.observer.takeRecords().length)state.generation++;
  const candidates=[...document.querySelectorAll('input:not([type=password]),textarea,button,a[href],[role],[contenteditable=true]')].filter(visible).slice(0,64);
  const controls=candidates.map(el => ({node_id:Number(el._nid),role:role(el),name:clean(el.getAttribute('aria-label')||el.getAttribute('placeholder')||(el.matches('button,a[href]')?el.innerText:''),160),enabled:!el.disabled&&el.getAttribute('aria-disabled')!=='true'})).filter(x => ['textbox','button','link','checkbox','radio','region'].includes(x.role)&&x.name&&Number.isSafeInteger(x.node_id)&&x.node_id>0);
  const chunks=[...document.querySelectorAll('h1,h2,h3,p,[role=status],output')].map(el=>clean(el.textContent,1024)).filter(Boolean);
  const full=chunks.join('\\n');
  return {document_key:location.href+'|'+performance.timeOrigin+'|'+state.generation,controls,text:full.slice(0,4096),truncated:full.length>4096};
})()`;

function obscuraPublicText(value: unknown, limit: number): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text.length <= limit && !/password|passwd|token|cookie|secret|credential|authorization|session|one.time|验证码|密码|口令|密钥/i.test(text) ? text : "";
}
function obscuraPublicTextBlock(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  return value.split("\n").map(line => obscuraPublicText(line, 1024)).filter(Boolean).join("\n").slice(0, limit);
}
function publicControls(controls: Control[]) { return controls.map(({ node_id: _node, ...control }) => control); }
function controlShape(controls: Control[]) { return controls.map(({ target_ref: _target, ...control }) => control); }

async function controlPoint(client: ObscuraCdpClient, sessionId: string, nodeId: number): Promise<{ x: number; y: number }> {
  const result = await client.send("DOM.getBoxModel", { nodeId }, sessionId);
  const content = (result.model as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content) || content.length !== 8 || !content.every(value => typeof value === "number")) throw new Error("Obscura target is unavailable.");
  return { x: (content[0] + content[2] + content[4] + content[6]) / 4, y: (content[1] + content[3] + content[5] + content[7]) / 4 };
}

async function focusControl(client: ObscuraCdpClient, sessionId: string, nodeId: number): Promise<void> {
  await client.send("DOM.focus", { nodeId }, sessionId);
}

async function dispatchInputEvent(client: ObscuraCdpClient, sessionId: string): Promise<void> {
  await client.send("Runtime.evaluate", { expression: "document.activeElement?.dispatchEvent(new Event('input',{bubbles:true}))", returnByValue: true }, sessionId);
}

async function currentOrigin(client: ObscuraCdpClient, sessionId: string): Promise<string | null> {
  const result = await client.send("Runtime.evaluate", { expression: "location.origin", returnByValue: true }, sessionId);
  return typeof remoteValue(result) === "string" ? remoteValue(result) as string : null;
}

async function currentLocalStorage(client: ObscuraCdpClient, sessionId: string): Promise<{ origin: string; entries: Array<[string, string]> } | null> {
  const result = await client.send("Runtime.evaluate", { expression: `(() => {
    if (!/^https?:$/.test(location.protocol)) return null;
    const entries=[]; for(let index=0;index<localStorage.length;index++){const key=localStorage.key(index);if(key!==null)entries.push([key,localStorage.getItem(key)??'']);}
    entries.sort((a,b)=>a[0].localeCompare(b[0])); return {origin:location.origin,entries};
  })()`, returnByValue: true }, sessionId);
  const value = remoteValue(result) as { origin?: unknown; entries?: unknown } | null;
  if (value === null) return null;
  const parsed = validateOriginEntries(value?.origin, value?.entries);
  if (!parsed) throw new Error("Obscura managed localStorage exceeded its bounded contract.");
  return parsed;
}

function storagePreloadExpression(storage: ManagedLocalStorage): string {
  const origins = Object.fromEntries([...storage.entries()]);
  return `(()=>{const entries=${JSON.stringify(origins)}[location.origin];if(!entries)return;localStorage.clear();for(const [key,value] of entries)localStorage.setItem(key,value);})()`;
}

async function readManagedLocalStorage(profileDir: string): Promise<ManagedLocalStorage> {
  const path = join(profileDir, OBSCURA_STORAGE_FILE);
  let bytes: Buffer;
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const entry = await handle.stat();
    if (!entry.isFile() || entry.size > MAX_STORAGE_BYTES) throw new Error("invalid");
    bytes = await handle.readFile();
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw new Error("Obscura managed localStorage is corrupt or unavailable.");
  } finally {
    await handle?.close().catch(() => undefined);
  }
  try {
    const value = JSON.parse(bytes.toString("utf8")) as { schema_version?: unknown; origins?: unknown };
    if (!value || typeof value !== "object" || Object.keys(value).sort().join(",") !== "origins,schema_version" || value.schema_version !== "harbor-obscura-local-storage/v1" || !Array.isArray(value.origins)) throw new Error("invalid");
    const storage = new Map<string, Array<[string, string]>>();
    for (const item of value.origins) {
      const record = item as { origin?: unknown; entries?: unknown };
      const parsed = record && typeof record === "object" && Object.keys(record).sort().join(",") === "entries,origin" ? validateOriginEntries(record.origin, record.entries) : null;
      if (!parsed || storage.has(parsed.origin)) throw new Error("invalid");
      storage.set(parsed.origin, parsed.entries);
    }
    return storage;
  } catch {
    throw new Error("Obscura managed localStorage is corrupt or unavailable.");
  }
}

async function writeManagedLocalStorage(profileDir: string, storage: ManagedLocalStorage): Promise<void> {
  const path = join(profileDir, OBSCURA_STORAGE_FILE);
  const temporary = join(profileDir, `.${OBSCURA_STORAGE_FILE}.${randomUUID()}.tmp`);
  const body = Buffer.from(JSON.stringify({
    schema_version: "harbor-obscura-local-storage/v1",
    origins: [...storage.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([origin, entries]) => ({ origin, entries }))
  }));
  if (body.length > MAX_STORAGE_BYTES) throw new Error("Obscura managed localStorage exceeds its storage limit.");
  let handle;
  try {
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(body);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    const directory = await open(profileDir, constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
  } catch {
    try { await handle?.close(); } catch { /* preserve the primary failure */ }
    try { await unlink(temporary); } catch { /* the temp may not exist */ }
    throw new Error("Obscura managed localStorage could not be saved.");
  }
}

function validateOriginEntries(origin: unknown, value: unknown): { origin: string; entries: Array<[string, string]> } | null {
  if (typeof origin !== "string" || origin.length > 2048 || !Array.isArray(value) || value.length > 256) return null;
  let parsed: URL;
  try { parsed = new URL(origin); } catch { return null; }
  if (!/^https?:$/.test(parsed.protocol) || parsed.origin !== origin || parsed.username || parsed.password) return null;
  const entries: Array<[string, string]> = [];
  const keys = new Set<string>();
  for (const pair of value) {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || typeof pair[1] !== "string" || pair[0].length > 1024 || pair[1].length > 1024 * 1024 || keys.has(pair[0])) return null;
    keys.add(pair[0]); entries.push([pair[0], pair[1]]);
  }
  return { origin, entries };
}

async function createInteractionContext(client: ObscuraCdpClient, sessionId: string): Promise<number> {
  const tree = await client.send("Page.getFrameTree", {}, sessionId);
  const frameId = (((tree.frameTree as Record<string, unknown> | undefined)?.frame as Record<string, unknown> | undefined)?.id);
  if (typeof frameId !== "string" || !frameId) throw new Error("Obscura page frame is unavailable.");
  const world = await client.send("Page.createIsolatedWorld", { frameId, worldName: "webenvoy-managed-interaction" }, sessionId);
  if (!Number.isSafeInteger(world.executionContextId)) throw new Error("Obscura isolated interaction world is unavailable.");
  return Number(world.executionContextId);
}

async function pageFacts(client: ObscuraCdpClient, sessionId: string, requested: string): Promise<LocalProviderPageFacts> {
  const result = await client.send("Runtime.evaluate", { expression: "({url:location.href,title:document.title,ready:document.readyState})", returnByValue: true }, sessionId);
  const value = remoteValue(result) as { url?: unknown; title?: unknown; ready?: unknown };
  const current = typeof value?.url === "string" ? value.url : null;
  return { current_url: current, title: obscuraPublicText(value?.title, 256) || null, status: current && ["interactive", "complete"].includes(String(value.ready)) ? "ready" : "unknown", facts: [{ key: "page.requested_url", source: "configured", value: requested }, { key: "page.status", source: "observed", value: current ? "ready" : "unknown" }] };
}

async function screenshot(client: ObscuraCdpClient, sessionId: string): Promise<LocalProviderScreenshotFacts> {
  const frame = await viewerFrame(client, sessionId);
  const evidence_ref = opaqueRef("validation");
  return { screenshot_ref: opaqueRef("screenshot"), mime_type: "image/png", byte_length: frame.byte_length, sha256: frame.sha256, captured_at: frame.captured_at, facts: [{ key: "screenshot.capture", source: "validation_evidence", value: "ready", evidence_ref }] };
}

async function viewerFrame(client: ObscuraCdpClient, sessionId: string, previous?: LocalProviderViewerFrame): Promise<LocalProviderViewerFrame> {
  const [shot, metrics] = await Promise.all([
    client.send("Page.captureScreenshot", { format: "png" }, sessionId),
    client.send("Runtime.evaluate", { expression: `(() => {
      const key=Symbol.for('webenvoy.viewerDocumentState');let state=window[key];
      if(!state){state={generation:0};state.observer=new MutationObserver(()=>state.generation++);state.observer.observe(document,{subtree:true,childList:true,attributes:true,characterData:true});window[key]=state}
      else if(state.observer.takeRecords().length)state.generation++;
      return {width:innerWidth,height:innerHeight,document_key:location.href+'|'+performance.timeOrigin+'|'+state.generation};
    })()`, returnByValue: true }, sessionId)
  ]);
  const data = stringField(shot, "data");
  const bytes = Buffer.from(data, "base64");
  const size = remoteValue(metrics) as { width?: unknown; height?: unknown; document_key?: unknown };
  const width = Number(size?.width), height = Number(size?.height);
  const documentKey = typeof size?.document_key === "string" && size.document_key.length <= 4096 ? size.document_key : null;
  if (bytes.length === 0 || bytes.length > MAX_VIEWER_FRAME_BYTES || !documentKey || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096) throw new Error("Obscura viewer frame exceeded its bounded contract.");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const frame: LocalProviderViewerFrame = {
    schema_version: "harbor-viewer-frame/v1",
    frame_ref: previous?.sha256 === sha256 && viewerFrameDocumentKeys.get(previous) === documentKey ? previous.frame_ref : opaqueRef("frame"),
    mime_type: "image/png", width, height, byte_length: bytes.length, sha256,
    captured_at: new Date().toISOString(), data_base64: data
  };
  viewerFrameDocumentKeys.set(frame, documentKey);
  return frame;
}

async function viewerControlAtPoint(client: ObscuraCdpClient, sessionId: string, x: number, y: number): Promise<number | null> {
  const result = await client.send("Runtime.evaluate", { expression: `(()=>{let el=document.elementFromPoint(${JSON.stringify(x)},${JSON.stringify(y)});while(el&&!el.matches('input:not([disabled]),textarea:not([disabled]),[contenteditable=true]'))el=el.parentElement;return Number(el?._nid)||null})()`, returnByValue: true }, sessionId);
  const nodeId = Number(remoteValue(result));
  return Number.isSafeInteger(nodeId) && nodeId > 0 ? nodeId : null;
}

function viewerPoint(input: { x: number; y: number }, frame: LocalProviderViewerFrame): boolean {
  return Number.isFinite(input.x) && Number.isFinite(input.y) && input.x >= 0 && input.y >= 0 && input.x <= frame.width && input.y <= frame.height;
}

function safeViewerUrl(value: string): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function viewerRefused(failure_class: string): LocalProviderViewerInputResult {
  return { status: "unavailable", dispatch_state: "not_dispatched", failure_class };
}

type Version = { Browser: string; "Protocol-Version": string; webSocketDebuggerUrl: string };
async function waitForVersion(port: number, timeoutMs: number, child: ChildProcess): Promise<Version> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Obscura process exited before CDP readiness.");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(Math.min(1000, Math.max(1, deadline - Date.now()))) });
      const value = await response.json() as Partial<Version>;
      if (value.Browser === "Chrome/145.0.0.0" && value["Protocol-Version"] === "1.3" && value.webSocketDebuggerUrl === `ws://127.0.0.1:${port}/devtools/browser`) return value as Version;
    } catch { /* Bounded readiness polling. */ }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for Obscura CDP readiness.");
}

async function unusedLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (!port) throw new Error("Unable to allocate loopback port.");
  return port;
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>(resolve => child.once("exit", () => resolve())),
    new Promise<void>(resolve => setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); resolve(); }, 2000))
  ]);
}

function remoteValue(result: Record<string, unknown>): unknown { return (result.result as { value?: unknown } | undefined)?.value; }
function stringField(value: Record<string, unknown>, key: string): string {
  if (typeof value[key] !== "string" || !value[key]) throw new Error(`Obscura CDP response is missing ${key}.`);
  return value[key];
}
function safeMessage(value: unknown): string { return value instanceof Error ? value.message.replace(/\s+/g, " ").slice(0, 240) : "unknown error"; }
function unavailable(code: RuntimeErrorCode, message: string, facts: RuntimeFact[]): LocalProviderLaunchResult { return { status: "unavailable", error: { code, message, retryable: true }, facts: [...facts, { key: "browser.launch", source: "observed", value: code }] }; }

class ObscuraTransportError extends Error {}

class ObscuraCdpClient {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private transportLost = false;
  private constructor(private readonly ws: WebSocket, private readonly onLost: () => void) { ws.addEventListener("message", this.message); ws.addEventListener("close", this.lost); ws.addEventListener("error", this.lost); }
  static async connect(url: string, timeoutMs: number, onLost: () => void): Promise<ObscuraCdpClient> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Obscura CDP websocket timed out.")), timeoutMs);
      ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Obscura CDP websocket failed.")); }, { once: true });
    });
    return new ObscuraCdpClient(ws, onLost);
  }
  send(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 20000): Promise<Record<string, unknown>> {
    if (this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new ObscuraTransportError("Obscura CDP websocket is unavailable."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new ObscuraTransportError(`Obscura CDP command timed out: ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  isOpen() { return this.ws.readyState === WebSocket.OPEN; }
  close() { this.ws.close(); this.rejectAll("Obscura CDP websocket closed."); }
  private readonly message = (event: MessageEvent) => {
    const payload = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data as ArrayBuffer).toString("utf8")) as { id?: number; result?: Record<string, unknown>; error?: { message?: string } };
    if (payload.id === undefined) return;
    const pending = this.pending.get(payload.id);
    if (!pending) return;
    this.pending.delete(payload.id); clearTimeout(pending.timer);
    if (payload.error) pending.reject(new Error(payload.error.message ?? "Obscura CDP command failed.")); else pending.resolve(payload.result ?? {});
  };
  private readonly lost = () => { if (this.transportLost) return; this.transportLost = true; this.rejectAll("Obscura CDP websocket lost."); this.onLost(); };
  private rejectAll(message: string) { for (const [id, pending] of this.pending) { this.pending.delete(id); clearTimeout(pending.timer); pending.reject(new ObscuraTransportError(message)); } }
}
