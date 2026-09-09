import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createLatestRequestGate } from "./latestRequestGate";
import {
  allowAgentManagement, fetchAgentManagementPolicy, agentManagementScope, createAgentGrantInput, fetchAgentAccess, mutateAgentAccess, queryAgentAccessOperation,
  type AgentAccessState,
} from "./agentAccessClient";

export function AgentAccessPanel({ endpoint }: { endpoint: string }) {
  const storageKey = `webenvoy.agent-access.pending:${endpoint}`;
  const [state, setState] = useState<AgentAccessState | null>(null);
  const [busy, setBusy] = useState(false);
  const [managementAllowed, setManagementAllowed] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(() => localStorage.getItem(storageKey) ?? "");
  const pendingRef = useRef(pending);
  const busyRef = useRef(false);
  const [principalId, setPrincipalId] = useState("");
  const [hours, setHours] = useState(24);
  const alive = useRef(true);
  const readGate = useRef(createLatestRequestGate());

  async function refresh() {
    const request = readGate.current.begin();
    void fetchAgentManagementPolicy(endpoint).then(policy => {
      if (alive.current && request.isCurrent()) setManagementAllowed(policy?.modes.commit === "auto" && policy?.modes.read === "auto");
    }).catch(() => { if (alive.current && request.isCurrent()) setManagementAllowed(false); });
    try {
      const next = await fetchAgentAccess(endpoint, request.signal);
      if (alive.current && request.isCurrent()) { setState(next); setError(""); }
    } catch {
      if (alive.current && request.isCurrent()) { setState(null); setError("无法读取 Core 授权状态。请检查本地连接与管理权限后刷新。"); }
    }
  }
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => { alive.current = false; readGate.current.invalidate(); };
  }, [endpoint]);

  function remember(key: string) {
    if (key) localStorage.setItem(storageKey, key);
    else localStorage.removeItem(storageKey);
    pendingRef.current = key;
    if (alive.current) setPending(key);
  }

  async function mutate(path: string, makeBody: (key: string) => unknown) {
    if (busyRef.current || pendingRef.current) return;
    const existing = localStorage.getItem(storageKey);
    if (existing) { pendingRef.current = existing; setPending(existing); return; }
    busyRef.current = true;
    setBusy(true); setError(""); setMessage("");
    try {
      const key = crypto.randomUUID();
      const body = makeBody(key);
      remember(key);
      readGate.current.invalidate();
      setState(null);
      const result = await mutateAgentAccess(endpoint, path, body);
      if (result !== "unknown") remember("");
      if (!alive.current) return;
      setState(null);
      await refresh();
      if (result === "rejected") setError("Core 拒绝了此操作，请检查管理权限和输入。");
      else setMessage(result === "completed" ? "操作已由 Core 确认，已刷新授权状态。" : "操作结果未知。仅可查询原操作；不会重发登记、授权或撤销请求。");
    } catch {
      if (alive.current) setError("未能安全完成操作。若已有操作编号，请查询原操作结果。");
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function reconcile() {
    if (busyRef.current || !pendingRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const result = await queryAgentAccessOperation(endpoint, pendingRef.current);
      if (result === "completed") remember("");
      if (!alive.current) return;
      await refresh();
      setMessage(result === "completed" ? "Core 已确认原操作，授权状态已刷新。" : "Core 尚不能确认原操作。保留原操作编号，禁止重新提交；可稍后继续查询。");
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }

  function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const name = String(data.get("display_name") ?? "").trim();
    const hash = String(data.get("credential_hash") ?? "").trim().toLowerCase();
    if (!name || !/^[a-f0-9]{64}$/.test(hash)) { setError("请输入名称和客户端提供的 64 位 SHA-256 公开指纹。"); return; }
    void mutate("/agent-access/principals", key => ({ idempotency_key: key, display_name: name, credential_hash: hash }));
  }

  const disabled = busy || Boolean(pending) || state === null;
  const activePrincipals = state?.principals.filter(item => item.revoked_at === null) ?? [];
  const principalName = (id: string) => state?.principals.find(item => item.principal_id === id)?.display_name ?? id;
  return <section className="settings-group" aria-label="Agent 接入管理">
    <header className="settings-group-header">
      <h2>Agent 接入与授权</h2>
      <p>此处授予浏览器管理范围。每次动作仍受现有授权策略、Profile 权限及实例控制权约束。</p>
    </header>
    <div className="settings-group-content">
      <div className="settings-action-row"><button type="button" className="save-button" disabled={busy} onClick={() => void refresh()}>刷新授权状态</button></div>
      {error && <p className="settings-error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {pending && <div role="status"><p>待确认操作：{pending}</p><button type="button" className="save-button" disabled={busy} onClick={() => void reconcile()}>查询原操作结果</button></div>}
      <div className="settings-action-row">
        <p>{managementAllowed ? "已授权的环境管理操作可直接执行。" : "创建 Profile 还需要允许环境管理操作直接执行。此设置不更改网站任务的执行方式，也不授予新的权限。"}</p>
        <button type="button" className="save-button" disabled={disabled || managementAllowed} onClick={async () => {
          if (busyRef.current) return;
          busyRef.current = true; setBusy(true); setError("");
          try { await allowAgentManagement(endpoint); await refresh(); }
          catch (error) { setError(error instanceof Error ? error.message : "请刷新核对管理执行策略。"); }
          finally { busyRef.current = false; setBusy(false); }
        }}>允许已授权的环境管理操作</button>
      </div>
      <form onSubmit={register}>
        <h3>登记 Agent</h3>
        <p>先由 Agent 本地客户端生成凭据，仅粘贴其 SHA-256 公开指纹。不要粘贴原始 token；App 不生成或展示密钥。</p>
        <label className="connection-field"><span>Agent 名称</span><input name="display_name" required maxLength={128} disabled={disabled} /></label>
        <label className="connection-field"><span>SHA-256 公开指纹</span><input name="credential_hash" required pattern="[a-fA-F0-9]{64}" minLength={64} maxLength={64} autoComplete="off" spellCheck={false} disabled={disabled} /></label>
        <button className="save-button" type="submit" disabled={disabled}>登记 Agent</button>
      </form>
      <form onSubmit={event => { event.preventDefault(); void mutate("/agent-access/grants", key => createAgentGrantInput(principalId, hours, key)); }}>
        <h3>授予非生产管理权限</h3>
        <p>{agentManagementScope}</p><p>新环境使用中文、Asia/Shanghai 时区；不包含已有 Profile、日常账号或内容发布权限。</p>
        <label className="connection-field"><span>授权 Agent</span><select required value={principalId} disabled={disabled} onChange={event => setPrincipalId(event.currentTarget.value)}><option value="">请选择 Agent</option>{activePrincipals.map(item => <option key={item.principal_id} value={item.principal_id}>{item.display_name} · {item.principal_id}</option>)}</select></label>
        <label className="connection-field"><span>授权有效期</span><select value={hours} disabled={disabled} onChange={event => setHours(Number(event.currentTarget.value))}><option value={1}>1 小时</option><option value={24}>24 小时</option><option value={168}>7 天</option></select></label>
        <button className="save-button" type="submit" disabled={disabled || !activePrincipals.some(item => item.principal_id === principalId)}>授予以上管理范围</button>
      </form>
      <h3>Agent（Principal）</h3>
      {state?.principals.length === 0 && <p>尚未登记 Agent。</p>}
      {state?.principals.map(item => <div className="settings-row we-settings-row" key={item.principal_id}><div><strong>{item.display_name} · {item.revoked_at ? "已撤销" : "已登记"}</strong><span>{item.principal_id}</span></div></div>)}
      <h3>连接（Connection）</h3>
      {state?.connections.length === 0 && <p>尚无连接记录。</p>}
      {state?.connections.map(item => <div className="settings-row we-settings-row" key={item.connection_id}><div><strong>{principalName(item.principal_id)} · {item.revoked_at ? "已撤销" : "连接已登记"}</strong><span>{item.connection_id} · {new Date(item.connected_at).toLocaleString()}</span></div></div>)}
      <h3>授权（Grant）</h3>
      {state?.grants.length === 0 && <p>尚无授权。</p>}
      {state?.grants.map(item => <div className="settings-row we-settings-row" key={item.grant_id}><div>
        <strong>{principalName(item.principal_id)} · {item.revoked_at ? "已撤销" : Date.parse(item.expires_at) <= Date.now() ? "已过期" : "有效"}</strong>
        <span>{item.grant_id}</span><span>有效至 {new Date(item.expires_at).toLocaleString()} · {item.allowed_origins.join("、") || "无站点授权"}</span>
        <span>允许操作：{item.allowed_operations.join("、")}</span><span>{item.creation_template?.provider_id ?? "无创建模板"} · 已创建 {item.created_profile_refs.length} / {item.max_created_profiles} 个 Profile</span>
        <span>已授权 Profile：{[...new Set([...item.profile_refs, ...item.created_profile_refs])].join("、") || "尚无"}</span>
        <button className="save-button" type="button" disabled={disabled || item.revoked_at !== null} onClick={() => void mutate(`/agent-access/grants/${encodeURIComponent(item.grant_id)}/revoke`, key => ({ idempotency_key: key }))}>撤销授权</button>
      </div></div>)}
      <h3>Profile 权限上限</h3>
      {state?.profile_policies.length === 0 && <p>尚无受此授权管理的 Profile。</p>}
      {state?.profile_policies.map(item => <div className="settings-row we-settings-row" key={item.profile_ref}><div><strong>{item.profile_ref}</strong><span>{item.allowed_origins.join("、")}</span><span>{item.allowed_operations.join("、")}</span></div></div>)}
    </div>
  </section>;
}
