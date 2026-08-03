import { spawn, spawnSync } from "node:child_process";

const defaultTimeoutMs = 60_000;
const defaultForceKillDelayMs = 5_000;
const postExitKillDelayMs = 250;

export async function runBoundedElectronSmoke({
  electronPath,
  env,
  mainPath = "dist-electron/main.js",
  timeoutMs = defaultTimeoutMs,
  forceKillDelayMs = defaultForceKillDelayMs,
}) {
  const child = spawn(electronPath, [mainPath], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const output = { stdout: "", stderr: "" };

  child.stdout.on("data", (chunk) => {
    output.stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output.stderr += chunk;
  });

  const exitCode = await waitForBoundedExit(child, output, timeoutMs, forceKillDelayMs);
  return { exitCode, ...output };
}

function waitForBoundedExit(child, output, timeoutMs, forceKillDelayMs) {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    let settled = false;
    let forceKill;
    let timeout;
    const clearTimers = () => {
      clearTimeout(timeout);
      clearTimeout(forceKill);
    };
    const settle = (error, code) => {
      if (settled) return;
      settled = true;
      clearTimers();
      if (error) reject(error);
      else resolve(code);
    };
    const timeoutError = (terminationError) =>
      new Error(
        [
          `Electron smoke timed out after ${timeoutMs / 1_000} seconds.`,
          terminationError ? `Process-tree termination failed: ${terminationError.message}` : "",
          output.stderr || output.stdout,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    timeout = setTimeout(() => {
      timedOut = true;
      const termination = terminateProcessTree(child, "SIGTERM");
      if (termination.error || !termination.targeted) {
        settle(timeoutError(termination.error));
        return;
      }
      forceKill = setTimeout(() => {
        settle(timeoutError(terminateProcessTree(child, "SIGKILL").error));
      }, forceKillDelayMs);
    }, timeoutMs);

    child.once("error", (error) => {
      const terminationError = timedOut ? terminateProcessTree(child, "SIGKILL").error : null;
      settle(timedOut ? timeoutError(terminationError) : error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        if (!forceKill) {
          forceKill = setTimeout(() => {
            settle(timeoutError(terminateProcessTree(child, "SIGKILL").error));
          }, forceKillDelayMs);
        }
      } else {
        const termination = terminateProcessTree(child, "SIGTERM");
        if (termination.error || !termination.targeted) {
          settle(termination.error, code);
          return;
        }
        forceKill = setTimeout(() => {
          settle(terminateProcessTree(child, "SIGKILL").error, code);
        }, postExitKillDelayMs);
      }
    });
  });
}

function terminateProcessTree(child, signal) {
  if (!child.pid) return { targeted: false, error: null };
  try {
    if (process.platform === "win32") {
      const taskkill = spawnSync(
        "taskkill",
        ["/pid", String(child.pid), "/t", ...(signal === "SIGKILL" ? ["/f"] : [])],
        { windowsHide: true },
      );
      const targeted = taskkill.error || taskkill.status !== 0 ? child.kill(signal) : true;
      return { targeted, error: null };
    } else {
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    return { targeted: false, error: error?.code === "ESRCH" ? null : error };
  }
  return { targeted: true, error: null };
}
