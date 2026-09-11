import { useEffect, useState, type MouseEvent } from "react";
import { fetchRunInstance, projectRunInstance, runControlChangedEvent, type RunInstanceState } from "./runInstanceClient";
import { requestOwnerJson } from "./ownerApiClient";
import { SourceField } from "./TaskThreadFields";

export function RunInstancePanel({ coreEndpoint, harborEndpoint, runId }: { coreEndpoint: string; harborEndpoint: string; runId: string }) {
  const [state, setState] = useState<RunInstanceState>({ status: "loading" });
  const [refresh, setRefresh] = useState(0);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void fetchRunInstance(coreEndpoint, harborEndpoint, runId, controller.signal).then((next) => {
      if (!controller.signal.aborted) {
        setState(next);
        if (next.status !== "ready" || next.instance.controlOwner !== "core_task" || next.instance.controlState !== "held") {
          window.dispatchEvent(new CustomEvent(runControlChangedEvent, { detail: { coreEndpoint, runId } }));
        }
      }
    });
    return () => controller.abort();
  }, [coreEndpoint, harborEndpoint, runId, refresh]);

  async function control(action: "takeover" | "return") {
    if (state.status !== "ready") return;
    const expected = state.instance.runtimeSessionRef;
    window.dispatchEvent(new CustomEvent(runControlChangedEvent, { detail: { coreEndpoint, runId } }));
    setState({ status: "loading" });
    const current = await fetchRunInstance(coreEndpoint, harborEndpoint, runId);
    if (current.status !== "ready" || current.instance.runtimeSessionRef !== expected) {
      setState(current.status === "ready" ? { status: "unavailable", summary: "Instance 绑定已变化，请重新检查。" } : current);
      return;
    }
    try {
      const handoff = action === "takeover" && current.instance.controlOwner === "core_task";
      const result = await requestOwnerJson(harborEndpoint, `/runtime/sessions/${encodeURIComponent(expected)}/${action === "takeover" ? handoff ? "handoff" : "lock" : "release"}`, {
        method: "POST",
        body: handoff
          ? { control_owner: "user", expected_control_owner: "core_task", handoff_reason: "user_requested" }
          : { control_owner: "user", ...(action === "takeover" ? { holder_ref: "app-browser-page" } : {}) },
      });
      const confirmed = projectRunInstance({ runtime_session_ref: expected, profile_ref: current.instance.profileRef, identity_environment_ref: current.instance.identityEnvironmentRef }, result);
      const transferred = confirmed.status === "ready" && (action === "takeover" ? confirmed.instance.controlOwner === "user" && confirmed.instance.controlState === "held" : confirmed.instance.controlOwner === "none" && confirmed.instance.controlState === "released");
      setMessage(!transferred ? "控制权操作未确认；请刷新查看同一 Instance 的状态。" : action === "return" ? "已交还控制；Agent 必须重新观察账号、经营对象和页面，再决定继续或结束。" : "已请求接管同一 Instance；此操作不改写 Run 或外部结果。");
    } catch {
      setMessage("控制权操作未确认；请刷新查看同一 Instance 的状态。");
    }
    setRefresh((value) => value + 1);
  }
  const instance = state.status === "ready" ? state.instance : undefined;
  const active = instance?.lifecycle === "active" || instance?.lifecycle === "locked" || instance?.lifecycle === "idle";
  return <section aria-label="当前回合的真实 Instance">
    <h3>当前 Instance</h3>
    {state.status === "unavailable" ? <p role="status">{state.summary}</p> : state.status === "loading" ? <p role="status">正在读取本回合的现场…</p> : null}
    {instance ? <dl className="context-facts compact">
      <SourceField label="Instance" value={instance.runtimeSessionRef} source="Core / Harbor live" />
      <SourceField label="Profile" value={instance.profileRef} source="Harbor live" />
      <SourceField label="身份环境引用" value={instance.identityEnvironmentRef ?? "未提供"} source="Harbor live" />
      <SourceField label="执行身份引用" value={instance.executionIdentityRef ?? "未提供"} source="Harbor live" />
      <SourceField label="实例状态" value={instance.lifecycle} source="Harbor live" />
      <SourceField label="控制权" value={`${instance.controlOwner} / ${instance.controlState}`} source="Harbor live" />
      <SourceField label="最近页面状态" value={`${instance.pageStatus} · ${instance.observedAt}`} source="Harbor live" />
    </dl> : null}
    <p>身份引用和页面状态不等于当前账号、经营对象或内容确认。页面记录可能已变化，继续前需要 Agent 重新观察。</p>
    <div className="single-action-actions">
      <button type="button" disabled={state.status === "loading"} onClick={() => setRefresh((value) => value + 1)}>刷新现场状态</button>
      {active && instance ? instance.controlOwner === "user" && instance.controlState === "held" ? <button type="button" onClick={() => void control("return")}>交还控制</button> : instance.controlOwner !== "user" ? <button type="button" onClick={() => void control("takeover")}>接管同一实例</button> : null : null}
    </div>
    {instance?.viewerRef && instance.viewerAvailability === "available" ? <SameInstanceViewer harborEndpoint={harborEndpoint} instance={instance} /> : null}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}

type ViewerFrame = {
  schema_version: "harbor-viewer-frame/v1";
  runtime_session_ref: string;
  viewer_ref: string;
  frame_ref: string;
  mime_type: "image/png";
  width: number;
  height: number;
  byte_length: number;
  data_base64: string;
};

function SameInstanceViewer({ harborEndpoint, instance }: { harborEndpoint: string; instance: NonNullable<Extract<RunInstanceState, { status: "ready" }>['instance']> }) {
  const [frame, setFrame] = useState<ViewerFrame>();
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState("");
  const [url, setUrl] = useState("");
  const [lastPoint, setLastPoint] = useState<{ x: number; y: number }>();
  const [editing, setEditing] = useState(false);
  const [pendingInput, setPendingInput] = useState<Record<string, unknown>>();
  const canInput = instance.controlOwner === "user" && instance.controlState === "held";
  const canSend = canInput && !pendingInput;

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    const poll = async () => {
      const value = await requestOwnerJson(harborEndpoint, `/runtime/sessions/${encodeURIComponent(instance.runtimeSessionRef)}/viewer-frame`, {
        method: "POST", body: { viewer_ref: instance.viewerRef }, timeoutMs: 5000,
      });
      if (!disposed) {
        const next = viewerFrame(value, instance.runtimeSessionRef, instance.viewerRef!);
        if (next) { setFrame(next); setMessage(""); }
        else setMessage("原实例画面暂不可用；不会因此重建页面。");
        if (!editing) timer = window.setTimeout(poll, 750);
      }
    };
    void poll();
    return () => { disposed = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [editing, harborEndpoint, instance.runtimeSessionRef, instance.viewerRef]);

  async function send(action: Record<string, unknown>, existing?: Record<string, unknown>) {
    if (!frame || !canInput) return;
    const request = existing ?? { ...action, viewer_ref: instance.viewerRef, frame_ref: frame.frame_ref, operation_ref: `viewer:${crypto.randomUUID()}` };
    setPendingInput(request);
    const value = await requestOwnerJson(harborEndpoint, `/runtime/sessions/${encodeURIComponent(instance.runtimeSessionRef)}/viewer-input`, {
      method: "POST",
      body: request,
      timeoutMs: 20_000,
      includeErrorBody: true,
    });
    const body = viewerResultBody(value);
    const next = viewerFrame(body?.frame, instance.runtimeSessionRef, instance.viewerRef!);
    if (next) { setFrame(next); setPendingInput(undefined); setMessage("输入已由同一 Instance 确认。 "); }
    else if (body?.dispatch_state === "not_dispatched") { setPendingInput(undefined); setMessage("输入未派发或画面已过期；请刷新后重试。"); }
    else setMessage("输入结果尚未确认；只能查询原操作，不会用新编号重放。");
  }

  function click(event: MouseEvent<HTMLImageElement>) {
    if (!frame || !canSend) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = { x: (event.clientX - bounds.left) * frame.width / bounds.width, y: (event.clientY - bounds.top) * frame.height / bounds.height };
    setLastPoint(point);
    void send({ action: "click", ...point });
  }

  return <section aria-label="同一原实例画面">
    <h4>同一原实例画面</h4>
    <p>{canInput ? "你已持有控制权。点击画面定位；中文在下方输入法完成组词后再提交。" : "只读观看不会取得控制权；接管后才可发送输入。"}</p>
    {frame ? <img src={`data:image/png;base64,${frame.data_base64}`} width={frame.width} height={frame.height} alt="当前原实例页面" onClick={click} onWheel={(event) => { if (canSend) { event.preventDefault(); void send({ action: "scroll", delta_y: Math.max(-2000, Math.min(2000, Math.round(event.deltaY))) || 1 }); } }} style={{ display: "block", maxWidth: "100%", height: "auto", border: "1px solid currentColor", cursor: canSend ? "crosshair" : "default" }} /> : <p role="status">正在读取原实例画面…</p>}
    {canInput ? <>
      <div className="single-action-actions">
        <input aria-label="向当前画面焦点输入" value={draft} onFocus={() => setEditing(true)} onBlur={() => setEditing(false)} onChange={(event) => setDraft(event.target.value)} placeholder="可使用中文输入法组词" />
        <button type="button" disabled={!canSend || !draft || !lastPoint} onMouseDown={(event) => event.preventDefault()} onClick={() => { void send({ action: "input", ...lastPoint, text: draft }); setEditing(false); }}>输入到所点控件</button>
        <button type="button" disabled={!canSend || !frame} onClick={() => void send({ action: "press", key: "Enter" })}>Enter</button>
      </div>
      <div className="single-action-actions">
        <input aria-label="导航网址" value={url} onFocus={() => setEditing(true)} onBlur={() => setEditing(false)} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" />
        <button type="button" disabled={!canSend || !url} onMouseDown={(event) => event.preventDefault()} onClick={() => { void send({ action: "navigate", url }); setEditing(false); }}>在同一实例导航</button>
      </div>
      {pendingInput ? <button type="button" onClick={() => void send({}, pendingInput)}>查询上次输入结果（不重放）</button> : null}
    </> : null}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}

function viewerFrame(value: unknown, sessionRef: string, viewerRef: string): ViewerFrame | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const frame = value as Partial<ViewerFrame>;
  if (frame.schema_version !== "harbor-viewer-frame/v1" || frame.runtime_session_ref !== sessionRef || frame.viewer_ref !== viewerRef || frame.mime_type !== "image/png" ||
    typeof frame.frame_ref !== "string" || typeof frame.data_base64 !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(frame.data_base64) || frame.data_base64.length > 2_800_000 ||
    !Number.isSafeInteger(frame.width) || frame.width! < 1 || frame.width! > 4096 || !Number.isSafeInteger(frame.height) || frame.height! < 1 || frame.height! > 4096 ||
    !Number.isSafeInteger(frame.byte_length) || frame.byte_length! < 1 || frame.byte_length! > 2 * 1024 * 1024) return undefined;
  return frame as ViewerFrame;
}

function viewerResultBody(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return record.ok === false && record.body && typeof record.body === "object" && !Array.isArray(record.body) ? record.body as Record<string, unknown> : record;
}
