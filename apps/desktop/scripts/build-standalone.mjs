import { rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
await rm(join(appRoot, "dist-electron"), { recursive: true, force: true });

run("pnpm", ["exec", "tsc", "-p", "tsconfig.standalone.json"]);
run(process.execPath, ["scripts/package-lode-assets.mjs"]);
run(process.execPath, ["scripts/package-runtime-assets.mjs"], { WEBENVOY_REQUIRE_PACKAGED_RUNTIME: "1" });

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, { cwd: appRoot, stdio: "inherit", env: { ...process.env, ...extraEnv } });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with status ${result.status ?? "unknown"}.`);
}
