import { spawn } from "node:child_process";

import electronPath from "electron";

const child = spawn(electronPath, ["scripts/workbench-dom-smoke.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, WEBENVOY_WORKBENCH_DOM_FORCE_FAILURE: "1" },
  stdio: ["ignore", "ignore", "pipe"],
});

let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => { stderr += chunk; });

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", resolve);
});

if (!Number.isInteger(exitCode) || exitCode <= 0 || !stderr.includes("Forced workbench DOM smoke failure.")) {
  throw new Error(`DOM smoke failure path did not exit non-zero: ${JSON.stringify({ exitCode, stderr })}`);
}

process.stdout.write(`${JSON.stringify({ forcedFailureExitCode: exitCode })}\n`);
