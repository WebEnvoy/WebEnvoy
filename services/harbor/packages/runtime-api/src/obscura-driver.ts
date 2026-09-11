import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { trustManagedInteractionOperation, type ManagedInteractionInput, type ManagedInteractionResult } from "./managed-interaction.js";
import { managedPageObservationExpression, normalizeManagedProviderObservation, trustManagedPageObserver } from "./managed-observation.js";
import { opaqueRef } from "./refs.js";
import { prepareProfileStorage } from "./profile-storage.js";
import type { LocalProviderLaunchInput, LocalProviderLaunchResult, LocalProviderPageFacts, LocalProviderScreenshotFacts, RuntimeErrorCode, RuntimeFact } from "./runtime-session-types.js";

export const OBSCURA_VALIDATED_COMMIT = "01e1caa33360f6c02643457307894ec885e82eef";
export const OBSCURA_VALIDATED_SHA256 = "d05336b807fde6b27221af3f1427550666d1f855166c3cc94be537a08b4ba98d";

type Control = { target_ref: string; role: string; name: string; enabled: boolean; value?: string; index: number };
type SnapshotState = { page_ref: string; observation_ref: string; document_key: string; controls: Control[] };

export async function launchObscuraProvider(input: LocalProviderLaunchInput): Promise<LocalProviderLaunchResult> {
  const storage = await prepareProfileStorage(input.profile_storage_ref);
  let child: ChildProcess | undefined;
  let client: ObscuraCdpClient | undefined;
  try {
    if (!input.browser_path) throw new Error("Obscura binary path is missing.");
    const binary = await readFile(input.browser_path);
    if (createHash("sha256").update(binary).digest("hex") !== OBSCURA_VALIDATED_SHA256) {
      throw new Error(`Obscura binary is not the validated ${OBSCURA_VALIDATED_COMMIT} build.`);
    }
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
    client = await ObscuraCdpClient.connect(version.webSocketDebuggerUrl, input.timeout_ms);
    const created = await client.send("Target.createTarget", { url: "about:blank" });
    const targetId = stringField(created, "targetId");
    const attached = await client.send("Target.attachToTarget", { targetId, flatten: true });
    const sessionId = stringField(attached, "sessionId");
    if (configuration?.viewport) {
      const [width, height] = configuration.viewport.split("x").map(Number);
      await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
    }
    let closed = false;
    let snapshot: SnapshotState | null = null;
    const navigate = async (url: string) => {
      snapshot = null;
      await client!.send("Page.navigate", { url, waitUntil: "load" }, sessionId, input.timeout_ms);
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
      { key: "browser.launch", source: "observed", value: "ready", evidence_ref: evidenceRef },
      { key: "cdp.version", source: "observed", value: `${version.Browser} ${version["Protocol-Version"]}`, evidence_ref: evidenceRef }
    ];
    return {
      status: "ready",
      execution_surface: "local_provider",
      driver_ref: opaqueRef("driver"),
      driver_kind: "chromium_cdp",
      cdp_ref: opaqueRef("cdp"),
      viewer_entry: { availability: "unsupported", access_mode: "none", transport: "not_applicable", input_capabilities: [], unavailable_reason: "unsupported" },
      page,
      facts,
      openUrl: navigate,
      observePage: trustManagedPageObserver(async () => {
        const result = await client!.send("Runtime.evaluate", { expression: managedPageObservationExpression, returnByValue: true }, sessionId);
        return normalizeManagedProviderObservation(remoteValue(result));
      }),
      interaction: trustManagedInteractionOperation(async action => {
        try {
          const result = await interact(client!, sessionId, action, snapshot);
          snapshot = result.next;
          return result.result;
        } catch {
          const dispatched = ["click", "input", "press", "scroll"].includes(action.action);
          return { status: dispatched ? "unknown_outcome" : "unavailable", dispatch_state: dispatched ? "dispatched" : "not_dispatched", failure_class: "managed_interaction_driver_unavailable" };
        }
      }),
      captureScreenshot: async () => screenshot(client!, sessionId),
      close: async () => {
        if (closed) return;
        closed = true;
        client?.close();
        await stop(child!);
        if (!storage.persistent) await rm(storage.profileDir, { recursive: true, force: true });
      }
    };
  } catch (cause) {
    client?.close();
    if (child) await stop(child);
    if (!storage.persistent) await rm(storage.profileDir, { recursive: true, force: true });
    return unavailable(/hash|validated/i.test(safeMessage(cause)) ? "provider_unavailable" : "launch_failed", `Obscura Driver launch failed: ${safeMessage(cause)}`, storage.facts);
  }
}

async function interact(client: ObscuraCdpClient, sessionId: string, input: ManagedInteractionInput, previous: SnapshotState | null): Promise<{ result: ManagedInteractionResult; next: SnapshotState | null }> {
  const refused = (failure_class: string, dispatched = false) => ({ result: { status: dispatched ? "unknown_outcome" : "unavailable", dispatch_state: dispatched ? "dispatched" : "not_dispatched", failure_class } as ManagedInteractionResult, next: null });
  if (await currentOrigin(client, sessionId) !== input.expected_origin) return refused("managed_public_origin_denied");
  if (input.action !== "snapshot" && (!previous || previous.page_ref !== input.page_ref || previous.observation_ref !== input.observation_ref)) return refused("managed_interaction_stale_target");
  let dispatched = false;
  if (input.action !== "snapshot") {
    const current = await snapshotPage(client, sessionId, previous!.page_ref);
    if (current.document_key !== previous!.document_key || JSON.stringify(controlShape(current.controls)) !== JSON.stringify(controlShape(previous!.controls))) return refused("managed_interaction_stale_target");
    const target = input.target_ref ? previous!.controls.find(item => item.target_ref === input.target_ref) : undefined;
    if (["click", "input", "press"].includes(input.action) && !target) return refused("managed_interaction_target_required");
    if (target && !target.enabled) return refused("managed_interaction_target_unavailable");
    if (input.action === "click") {
      const point = await controlPoint(client, sessionId, target!.index);
      dispatched = true;
      await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 }, sessionId);
      await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 }, sessionId);
    } else if (input.action === "input") {
      if (target!.role !== "textbox" || typeof input.text !== "string" || /password|token|cookie|secret|credential|authorization|验证码|密码|口令|密钥/i.test(input.text)) return refused("managed_interaction_input_refused");
      await focusControl(client, sessionId, target!.index);
      dispatched = true;
      await client.send("Input.insertText", { text: input.text }, sessionId);
    } else if (input.action === "press") {
      if (!input.key) return refused("managed_interaction_key_refused");
      await focusControl(client, sessionId, target!.index);
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
        const next = await snapshotPage(client, sessionId, previous!.page_ref);
        const changed = next.document_key !== previous!.document_key || JSON.stringify(controlShape(next.controls)) !== JSON.stringify(controlShape(previous!.controls));
        const previousTarget = input.target_ref ? previous!.controls.find(item => item.target_ref === input.target_ref) : undefined;
        const target = previousTarget ? next.controls.find(item => item.index === previousTarget.index) : undefined;
        if (input.wait_for === "page_changed" ? changed : input.wait_for === "text" ? next.text.includes(input.text ?? "") : target?.enabled) { matched = true; break; }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (!matched) return refused("managed_interaction_wait_timeout");
    }
  }
  if (await currentOrigin(client, sessionId) !== input.expected_origin) return refused("managed_public_origin_denied", dispatched);
  const next = await snapshotPage(client, sessionId, previous?.page_ref);
  const page = await pageFacts(client, sessionId, input.expected_origin);
  return { result: { status: "completed", dispatch_state: dispatched ? "dispatched" : "not_dispatched", page, snapshot: { page_ref: next.page_ref, observation_ref: next.observation_ref, controls: publicControls(next.controls), text: next.text, truncated: next.truncated } }, next };
}

async function snapshotPage(client: ObscuraCdpClient, sessionId: string, pageRef?: string): Promise<SnapshotState & { text: string; truncated: boolean }> {
  const result = await client.send("Runtime.evaluate", { expression: snapshotExpression, returnByValue: true }, sessionId);
  const value = remoteValue(result) as { document_key?: unknown; controls?: unknown; text?: unknown; truncated?: unknown };
  if (typeof value?.document_key !== "string" || !Array.isArray(value.controls) || typeof value.text !== "string" || typeof value.truncated !== "boolean") throw new Error("Invalid Obscura snapshot.");
  const controls = value.controls.slice(0, 64).map((item, index) => {
    const control = item as Record<string, unknown>;
    if (typeof control.role !== "string" || typeof control.name !== "string" || typeof control.enabled !== "boolean") throw new Error("Invalid Obscura control.");
    return { target_ref: opaqueRef("target"), role: control.role, name: control.name, enabled: control.enabled, ...(typeof control.value === "string" ? { value: control.value } : {}), index: Number.isSafeInteger(control.index) ? Number(control.index) : index };
  });
  return { page_ref: pageRef ?? opaqueRef("page"), observation_ref: opaqueRef("observation"), document_key: value.document_key, controls, text: value.text, truncated: value.truncated };
}

const snapshotExpression = `(() => {
  const clean = value => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, 512);
  const visible = el => { const r=el.getBoundingClientRect(),s=getComputedStyle(el); return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'; };
  const role = el => el.matches('input,textarea,[contenteditable=true]') ? 'textbox' : el.matches('button,[role=button]') ? 'button' : el.matches('a[href],[role=link]') ? 'link' : el.getAttribute('role');
  const candidates=[...document.querySelectorAll('input:not([type=password]),textarea,button,a[href],[role],[contenteditable=true]')].filter(visible).slice(0,64);
  const controls=candidates.map((el,index) => ({index,role:role(el),name:clean(el.getAttribute('aria-label')||el.innerText||el.textContent||el.getAttribute('placeholder')||el.name),enabled:!el.disabled&&el.getAttribute('aria-disabled')!=='true',...(el.matches('input,textarea')?{value:clean(el.value)}:{})})).filter(x => ['textbox','button','link','checkbox','radio','region'].includes(x.role)&&x.name&&!/(password|token|cookie|secret|credential|authorization|验证码|密码|口令|密钥)/i.test(x.name));
  const text=clean(document.body?.innerText).slice(0,4096);
  return {document_key:location.href+'|'+performance.timeOrigin,controls,text,truncated:candidates.length>=64||String(document.body?.innerText||'').length>4096};
})()`;

function publicControls(controls: Control[]) { return controls.map(({ index: _index, ...control }) => control); }
function controlShape(controls: Control[]) { return controls.map(({ target_ref: _target, ...control }) => control); }

async function controlPoint(client: ObscuraCdpClient, sessionId: string, index: number): Promise<{ x: number; y: number }> {
  const result = await client.send("Runtime.evaluate", { expression: `(() => { const el=[...document.querySelectorAll('input:not([type=password]),textarea,button,a[href],[role],[contenteditable=true]')].filter(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'})[${index}]; if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`, returnByValue: true }, sessionId);
  const value = remoteValue(result) as { x?: unknown; y?: unknown };
  if (typeof value?.x !== "number" || typeof value.y !== "number") throw new Error("Obscura target is unavailable.");
  return { x: value.x, y: value.y };
}

async function focusControl(client: ObscuraCdpClient, sessionId: string, index: number): Promise<void> {
  const result = await client.send("Runtime.evaluate", { expression: `(() => { const el=[...document.querySelectorAll('input:not([type=password]),textarea,button,a[href],[role],[contenteditable=true]')].filter(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'})[${index}]; if(!el) return false; el.focus(); if('select' in el) el.select(); return document.activeElement===el; })()`, returnByValue: true }, sessionId);
  if (remoteValue(result) !== true) throw new Error("Obscura target could not be focused.");
}

async function currentOrigin(client: ObscuraCdpClient, sessionId: string): Promise<string | null> {
  const result = await client.send("Runtime.evaluate", { expression: "location.origin", returnByValue: true }, sessionId);
  return typeof remoteValue(result) === "string" ? remoteValue(result) as string : null;
}

async function pageFacts(client: ObscuraCdpClient, sessionId: string, requested: string): Promise<LocalProviderPageFacts> {
  const result = await client.send("Runtime.evaluate", { expression: "({url:location.href,title:document.title,ready:document.readyState})", returnByValue: true }, sessionId);
  const value = remoteValue(result) as { url?: unknown; title?: unknown; ready?: unknown };
  const current = typeof value?.url === "string" ? value.url : null;
  return { current_url: current, title: typeof value?.title === "string" ? value.title.slice(0, 256) : null, status: current && ["interactive", "complete"].includes(String(value.ready)) ? "ready" : "unknown", facts: [{ key: "page.requested_url", source: "configured", value: requested }, { key: "page.status", source: "observed", value: current ? "ready" : "unknown" }] };
}

async function screenshot(client: ObscuraCdpClient, sessionId: string): Promise<LocalProviderScreenshotFacts> {
  const result = await client.send("Page.captureScreenshot", { format: "png" }, sessionId);
  const data = stringField(result, "data");
  const bytes = Buffer.from(data, "base64");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const evidence_ref = opaqueRef("validation");
  return { screenshot_ref: opaqueRef("screenshot"), mime_type: "image/png", byte_length: bytes.length, sha256, captured_at: new Date().toISOString(), facts: [{ key: "screenshot.capture", source: "validation_evidence", value: "ready", evidence_ref }] };
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
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>(resolve => child.once("exit", () => resolve())),
    new Promise<void>(resolve => setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); resolve(); }, 2000))
  ]);
}

function remoteValue(result: Record<string, unknown>): unknown { return (result.result as { value?: unknown } | undefined)?.value; }
function stringField(value: Record<string, unknown>, key: string): string {
  if (typeof value[key] !== "string" || !value[key]) throw new Error(`Obscura CDP response is missing ${key}.`);
  return value[key];
}
function safeMessage(value: unknown): string { return value instanceof Error ? value.message.replace(/\s+/g, " ").slice(0, 240) : "unknown error"; }
function unavailable(code: RuntimeErrorCode, message: string, facts: RuntimeFact[]): LocalProviderLaunchResult { return { status: "unavailable", error: { code, message, retryable: true }, facts: [...facts, { key: "browser.launch", source: "observed", value: code }] }; }

class ObscuraCdpClient {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private constructor(private readonly ws: WebSocket) { ws.addEventListener("message", this.message); ws.addEventListener("close", this.lost); ws.addEventListener("error", this.lost); }
  static async connect(url: string, timeoutMs: number): Promise<ObscuraCdpClient> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Obscura CDP websocket timed out.")), timeoutMs);
      ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Obscura CDP websocket failed.")); }, { once: true });
    });
    return new ObscuraCdpClient(ws);
  }
  send(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 20000): Promise<Record<string, unknown>> {
    if (this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Obscura CDP websocket is unavailable."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Obscura CDP command timed out: ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  close() { this.ws.close(); this.rejectAll("Obscura CDP websocket closed."); }
  private readonly message = (event: MessageEvent) => {
    const payload = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data as ArrayBuffer).toString("utf8")) as { id?: number; result?: Record<string, unknown>; error?: { message?: string } };
    if (payload.id === undefined) return;
    const pending = this.pending.get(payload.id);
    if (!pending) return;
    this.pending.delete(payload.id); clearTimeout(pending.timer);
    if (payload.error) pending.reject(new Error(payload.error.message ?? "Obscura CDP command failed.")); else pending.resolve(payload.result ?? {});
  };
  private readonly lost = () => this.rejectAll("Obscura CDP websocket lost.");
  private rejectAll(message: string) { for (const [id, pending] of this.pending) { this.pending.delete(id); clearTimeout(pending.timer); pending.reject(new Error(message)); } }
}
