import {
  launchSharedPlaywrightProvider,
  unavailable
} from "./playwright-shared-driver.js";
import type {
  LocalProviderLaunchInput,
  LocalProviderLaunchResult,
  RuntimeFact
} from "./runtime-session-types.js";
import type { ResolvedIdentityEnvironmentLaunchConfiguration } from "./identity-environment-configuration.js";

export const CHROME_OFFICIAL_PLAYWRIGHT_VERSION = "1.60.0";

/** A Chrome launch is admitted only from the persisted owner binding. */
export function isOfficialChromeLaunchRequest(input: Pick<LocalProviderLaunchInput, "provider_id" | "browser_path" | "identity_environment">): boolean {
  const binding = input.identity_environment?.provider_binding;
  const install = binding?.selected_provider?.install;
  return binding?.selected_provider_id === "chrome_official" &&
    (input.provider_id === undefined || input.provider_id === "chrome_official") &&
    binding.selected_provider?.provider_id === "chrome_official" &&
    binding.selected_provider.selectable === true &&
    install?.status === "installed" &&
    install.launchability === "launchable" &&
    typeof install.path === "string" &&
    install.path.trim().length > 0 &&
    !/[\0\r\n]/.test(install.path) &&
    (!input.browser_path || input.browser_path === install.path);
}

export async function launchChromeOfficialProvider(
  input: LocalProviderLaunchInput,
  resolvedIdentityEnvironmentConfiguration?: ResolvedIdentityEnvironmentLaunchConfiguration
): Promise<LocalProviderLaunchResult> {
  if (!isOfficialChromeLaunchRequest(input)) {
    return unavailable("unsupported", "官方 Chrome 仅允许由 owner 提供并验证的 persisted binding 启动。", []);
  }
  const binding = input.identity_environment!.provider_binding;
  const install = binding.selected_provider!.install;
  const browserPath = install.path!;
  return launchSharedPlaywrightProvider(input, {
    provider_id: "chrome_official",
    driver_filename: "chrome_official_driver.py",
    pythonPath: () => process.env.HARBOR_PLAYWRIGHT_PYTHON,
    browserPath: () => browserPath,
    launchFields: () => ({}),
    facts: () => chromeFacts(browserPath, install.version),
    screenshotUnavailableMessage: "Official Chrome screenshot is unavailable."
  }, resolvedIdentityEnvironmentConfiguration);
}

function chromeFacts(path: string, version: string | null): RuntimeFact[] {
  return [
    { key: "provider.chrome_official.executable", source: "observed", value: path },
    { key: "provider.chrome_official.playwright_version", source: "validation_evidence", value: CHROME_OFFICIAL_PLAYWRIGHT_VERSION },
    ...(version ? [{ key: "provider.chrome_official.browser_version", source: "observed" as const, value: version }] : [])
  ];
}
