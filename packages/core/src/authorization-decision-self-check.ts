import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  probeAuthoritativeTaskBinding,
  probeImmutableSecurityAndInvalidation,
  probeRecoverableTaskCommit
} from "./authorization-decision-store-probes.js";
import { probePaginationRestartAndCorruption } from "./authorization-decision-query-probes.js";
import { probeSingleActionConsumption } from "./authorization-decision-single-action-probes.js";

export async function assertAuthorizationDecisionStore(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-authorization-decision-"));
  try {
    await probeSingleActionConsumption(join(directory, "single-action"));
    await probeAuthoritativeTaskBinding(join(directory, "task-binding"));
    await probeRecoverableTaskCommit(join(directory, "recoverable-commit"));
    await probeImmutableSecurityAndInvalidation(join(directory, "security-lifecycle"));
    await probePaginationRestartAndCorruption(join(directory, "pagination"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
