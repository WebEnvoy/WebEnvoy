import { createFixtureLauncher, HarborRuntime } from "./index.js";
import { resolveIdentityEnvironmentStorePath } from "./identity-environment-store.js";
import { startHarborRuntimeServer } from "./server.js";

const port = Number.parseInt(process.env.HARBOR_RUNTIME_PORT ?? "8788", 10);
const host = process.env.HARBOR_RUNTIME_HOST ?? "127.0.0.1";
const configuredStorePath = process.env.HARBOR_IDENTITY_ENVIRONMENTS_PATH;
const identityEnvironmentStorePath = resolveIdentityEnvironmentStorePath(configuredStorePath);
const providerLauncher = process.env.HARBOR_RUNTIME_PROVIDER === "fixture" ? createFixtureLauncher("ready") : undefined;
const runtime = new HarborRuntime(providerLauncher, { persistence_path: identityEnvironmentStorePath });
const running = await startHarborRuntimeServer({
  host,
  port,
  runtime,
  manual_authentication_supervisor_token: process.env.HARBOR_MANUAL_AUTH_SUPERVISOR_TOKEN
});

console.log(JSON.stringify({
  service: "harbor-runtime-api",
  status: "ready",
  url: running.url,
  provider_launcher: providerLauncher ? "fixture" : "local",
  identity_environment_store: configuredStorePath ? "configured" : "persistent_default"
}));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await running.close();
    process.exit(0);
  });
}
