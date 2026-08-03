import {
  ArrowLeft,
  Bell,
  DatabaseZap,
  MonitorCog,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { type LocalConnectionConfig } from "./localConnectionConfig";
import type { RuntimeSupervisorState } from "./runtimeSupervisorState";

type SettingsSectionId = "connections" | "appearance" | "boundaries" | "diagnostics";

type SettingsSection = {
  id: SettingsSectionId;
  label: string;
  group: string;
  icon: typeof DatabaseZap;
};

type SettingsPageProps = {
  embedded?: boolean;
  colorScheme?: "light" | "dark";
  configScope?: "local-ui-only";
  connectionConfig: LocalConnectionConfig;
  platform?: string;
  runtimeSupervisorState: RuntimeSupervisorState;
  settingsError: string;
  settingsSaved: boolean;
  onBack: () => void;
  onEndpointChange: (field: keyof LocalConnectionConfig, value: string) => void;
  onSave: () => void;
};

const settingsSections: SettingsSection[] = [
  { id: "connections", label: "本地端点", group: "运行来源", icon: DatabaseZap },
  { id: "appearance", label: "外观", group: "App", icon: MonitorCog },
  { id: "boundaries", label: "数据边界", group: "App", icon: ShieldCheck },
  { id: "diagnostics", label: "诊断", group: "App", icon: Bell },
];

export function SettingsPage({
  embedded = false,
  colorScheme,
  configScope,
  connectionConfig,
  platform,
  runtimeSupervisorState,
  settingsError,
  settingsSaved,
  onBack,
  onEndpointChange,
  onSave,
}: SettingsPageProps) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("connections");
  const activeSectionLabel =
    settingsSections.find((section) => section.id === activeSection)?.label ?? "设置";

  return (
    <div className={embedded ? "app-settings-page app-settings-page-embedded" : "app-settings-page"}>
      <aside className="settings-navigation" aria-label="设置分类">
        {embedded ? null : <div className="settings-titlebar-spacer" aria-hidden="true" />}
        {embedded ? null : (
          <button className="settings-back-row" type="button" onClick={onBack}>
            <ArrowLeft size={15} />
            WebEnvoy App
          </button>
        )}
        {["运行来源", "App"].map((group) => (
          <section className="settings-navigation-group" key={group}>
            <h2>{group}</h2>
            {settingsSections
              .filter((section) => section.group === group)
              .map((section) => {
                const Icon = section.icon;
                return (
                  <button
                    className={
                      section.id === activeSection
                        ? "settings-navigation-row we-list-row cursor-interaction selected"
                        : "settings-navigation-row we-list-row cursor-interaction"
                    }
                    type="button"
                    data-settings-initial-focus={section.id === "connections" ? "" : undefined}
                    aria-current={section.id === activeSection ? "page" : undefined}
                    onClick={() => setActiveSection(section.id)}
                    key={section.id}
                  >
                    <Icon size={16} />
                    {section.label}
                  </button>
                );
              })}
          </section>
        ))}
      </aside>

      <main className="settings-content-layout">
        {embedded ? null : <div className="settings-content-toolbar" aria-hidden="true" />}
        <div className="settings-content-scroll">
          <div className="settings-content-inner">
            <header className="settings-content-header">
              <h1>{activeSectionLabel}</h1>
              <p>App 只保存本机 UI 设置和非敏感连接入口。</p>
            </header>

            {activeSection === "connections" ? (
              <SettingsGroup
                title="本地端点"
                subtitle="用于开发期连接 Core、Harbor、Lode owner API；不保存 token、cookie、profile path 或 raw evidence。"
              >
                <ConnectionInput
                  label="Core endpoint"
                  value={connectionConfig.coreEndpoint}
                  onChange={(value) => onEndpointChange("coreEndpoint", value)}
                />
                <ConnectionInput
                  label="Harbor endpoint"
                  value={connectionConfig.harborEndpoint}
                  onChange={(value) => onEndpointChange("harborEndpoint", value)}
                />
                <ConnectionInput
                  label="Lode endpoint"
                  value={connectionConfig.lodeEndpoint}
                  onChange={(value) => onEndpointChange("lodeEndpoint", value)}
                />
                <div className="settings-action-row">
                  <button className="save-button" type="button" onClick={onSave}>
                    保存本地配置
                  </button>
                  <span className="settings-saved">
                    {settingsSaved ? "Saved locally" : "Not saved"}
                  </span>
                </div>
                {settingsError ? (
                  <p className="settings-error" role="alert">
                    {settingsError}
                  </p>
                ) : null}
              </SettingsGroup>
            ) : null}

            {activeSection === "appearance" ? (
              <SettingsGroup title="外观" subtitle="跟随当前 Desktop shell / 浏览器主题。">
                <SettingsRow title="平台" detail={platform ?? "loading"} />
                <SettingsRow title="主题" detail={colorScheme ?? "loading"} />
                <SettingsRow title="设置来源" detail={configScope ?? "local-ui-only"} />
              </SettingsGroup>
            ) : null}

            {activeSection === "boundaries" ? (
              <SettingsGroup title="数据边界" subtitle="WebEnvoy App 不作为运行事实真相源。">
                <SettingsRow title="Credential / token" detail="不保存" />
                <SettingsRow title="Browser profile storage" detail="不保存" />
                <SettingsRow title="Core Run Record truth" detail="只读 owner projection" />
                <SettingsRow title="Evidence body" detail="只保存 viewer ref，不缓存正文" />
              </SettingsGroup>
            ) : null}

            {activeSection === "diagnostics" ? (
              <SettingsGroup title="诊断" subtitle="本页只展示 shell 上下文和本地 runtime gate，不保存敏感材料。">
                <SettingsRow title="Platform" detail={platform ?? "loading"} />
                <SettingsRow title="Color scheme" detail={colorScheme ?? "loading"} />
                <SettingsRow title="Config scope" detail={configScope ?? "loading"} />
                <SettingsRow
                  title="Runtime gate"
                  detail={runtimeSupervisorState.canUseLiveRuntime ? "ready" : "fail-closed"}
                />
                <SettingsRow title="Runtime summary" detail={runtimeSupervisorState.summary} />
                {runtimeSupervisorState.services.map((service) => (
                  <SettingsRow
                    title={`${service.name} repair`}
                    detail={`${service.processState} / ${service.health.state}${
                      service.admission ? ` / admission ${service.admission.state}` : ""
                    } / ${service.repairAction}`}
                    key={service.id}
                  />
                ))}
              </SettingsGroup>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}

function SettingsGroup({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-group">
      <header className="settings-group-header">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </header>
      <div className="settings-group-content">{children}</div>
    </section>
  );
}

function SettingsRow({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="settings-row we-settings-row">
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
    </div>
  );
}

function ConnectionInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="connection-field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.currentTarget.value)} />
    </label>
  );
}
