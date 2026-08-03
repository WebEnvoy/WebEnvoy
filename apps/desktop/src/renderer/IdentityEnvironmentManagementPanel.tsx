import { Check, X } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";

import type { IdentityEnvironmentProjection } from "./identityEnvironmentFixtures";
import type { HarborProviderStatus } from "./harborIdentityTypes";

export type IdentityManagementMode = "create" | "import" | "edit";

export type IdentityEditorValue = {
  siteId: "xiaohongshu" | "boss";
  accountIdentifier: string;
  importSourceRef: string;
  providerId: "cloakbrowser" | "chrome_official";
  proxyMode: "preserve" | "system" | "disabled";
  language: string;
  timezone: string;
  viewport: string;
};

export function IdentityEnvironmentManagementPanel({
  busy,
  focusProviderRequestKey,
  identity,
  message,
  mode,
  onCancel,
  onSubmit,
  providers,
}: {
  busy: boolean;
  focusProviderRequestKey?: number;
  identity?: IdentityEnvironmentProjection;
  message: string;
  mode: IdentityManagementMode;
  onCancel: () => void;
  onSubmit: (value: IdentityEditorValue) => void;
  providers: HarborProviderStatus[];
}) {
  const [submitted, setSubmitted] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState(() => providerId(identity, providers));
  const providerSelectRef = useRef<HTMLSelectElement>(null);
  const title = mode === "edit" ? "编辑账号身份" : mode === "import" ? "导入账号身份" : "创建账号身份";
  const provider = providers.find((candidate) => candidate.provider_id === selectedProviderId);
  const supportsLocale = supports(provider, "locale");
  const supportsTimezone = supports(provider, "timezone");
  const supportsViewport = supports(provider, "viewport");

  useEffect(() => {
    if (focusProviderRequestKey != null) providerSelectRef.current?.focus();
  }, [focusProviderRequestKey]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const values = new FormData(form);
    onSubmit({
      siteId: field(values, "siteId") === "boss" ? "boss" : "xiaohongshu",
      accountIdentifier: field(values, "accountIdentifier"),
      importSourceRef: field(values, "importSourceRef"),
      providerId: selectedProviderId,
      proxyMode: proxyModeValue(field(values, "proxyMode")),
      language: field(values, "language"),
      timezone: field(values, "timezone"),
      viewport: field(values, "viewport"),
    });
  }

  return (
    <section className="identity-editor" aria-labelledby="identity-editor-title">
      <header className="identity-editor-heading">
        <div>
          <h1 id="identity-editor-title">{title}</h1>
          <p>{mode === "edit" ? `${identity?.siteName ?? "站点"} · ${identity?.accountLabel ?? "账号"}` : "Harbor 将在本机创建并管理独立浏览器环境。"}</p>
        </div>
        <button className="topbar-icon-button" type="button" aria-label="关闭" title="关闭" onClick={onCancel}><X size={15} /></button>
      </header>
      <form className={`identity-editor-form${submitted ? " submitted" : ""}`} noValidate onSubmit={submit}>
        {mode !== "edit" ? <div className="identity-editor-grid">
          <label>站点<select name="siteId" defaultValue="xiaohongshu"><option value="xiaohongshu">小红书</option><option value="boss">BOSS 直聘</option></select></label>
          <label>账号名称<input name="accountIdentifier" required maxLength={120} placeholder="例如：品牌运营号" /></label>
          {mode === "import" ? <label>导入来源<input name="importSourceRef" required maxLength={240} placeholder="Harbor 可读取的导入来源标识" /></label> : null}
        </div> : null}
        <div className="identity-editor-grid">
          <label>浏览器 Provider<select ref={providerSelectRef} name="providerId" value={selectedProviderId} onChange={(event) => setSelectedProviderId(event.target.value === "chrome_official" ? "chrome_official" : "cloakbrowser")}>{providerOptions(providers, selectedProviderId)}</select></label>
          <label>代理<select name="proxyMode" defaultValue={identity?.environment.proxyRef ? "preserve" : "system"}>{identity?.environment.proxyRef ? <option value="preserve">保留当前代理</option> : null}<option value="system">不使用代理</option><option value="disabled">禁用代理配置</option></select></label>
          {supportsLocale ? <label>语言<input name="language" maxLength={40} defaultValue={known(identity?.environment.language)} placeholder="例如：zh-CN" /></label> : null}
          {supportsTimezone ? <label>时区<input name="timezone" maxLength={80} defaultValue={known(identity?.environment.timezone)} placeholder="例如：Asia/Shanghai" /></label> : null}
        </div>
        {supportsViewport ? <details className="identity-editor-advanced">
          <summary>高级环境配置</summary>
          <div className="identity-editor-grid">
            <label>视口<input name="viewport" maxLength={40} defaultValue={known(identity?.environment.viewport)} placeholder="例如：1440x900" /></label>
          </div>
        </details> : null}
        {message ? <p className="identity-editor-message" role="status">{message}</p> : null}
        <footer className="identity-editor-actions">
          <button type="button" onClick={onCancel}>取消</button>
          <button className="primary" type="submit" disabled={busy}><Check size={14} />{busy ? "正在处理" : mode === "edit" ? "保存" : mode === "import" ? "导入" : "创建"}</button>
        </footer>
      </form>
    </section>
  );
}

function field(values: FormData, name: string) {
  const value = values.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function known(value: string | undefined) {
  return value == null || value === "未知" ? "" : value;
}

function providerId(identity: IdentityEnvironmentProjection | undefined, providers: HarborProviderStatus[]) {
  if (identity?.provider.selected === "官方 Chrome") return "chrome_official";
  if (identity?.provider.selected === "CloakBrowser") return "cloakbrowser";
  return providers.find((provider) => provider.install.status === "installed" && provider.install.launchability === "launchable")?.provider_id ?? "cloakbrowser";
}

function providerOptions(providers: HarborProviderStatus[], selected: "cloakbrowser" | "chrome_official") {
  const available = providers.filter((provider) => provider.install.status === "installed" && provider.install.launchability === "launchable");
  const options = available.some((provider) => provider.provider_id === selected)
    ? available
    : [{ provider_id: selected, display_name: selected === "cloakbrowser" ? "CloakBrowser" : "官方 Chrome" } as HarborProviderStatus, ...available];
  return options.map((provider) => <option key={provider.provider_id} value={provider.provider_id}>{provider.display_name}</option>);
}

function supports(provider: HarborProviderStatus | undefined, key: NonNullable<HarborProviderStatus["capabilities"]>[number]["key"]) {
  const capability = provider?.capabilities?.find((candidate) => candidate.key === key);
  return capability != null && capability.source !== "provider_claim" && (capability.state === "supported" || capability.state === "limited");
}

function proxyModeValue(value: string): IdentityEditorValue["proxyMode"] {
  return value === "preserve" || value === "disabled" ? value : "system";
}
