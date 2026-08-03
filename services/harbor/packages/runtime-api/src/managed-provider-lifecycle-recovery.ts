import type { ProviderCacheOwnership } from "./managed-provider-cache-ownership.js";
import {
  rollbackProviderExchange,
  type ProviderExchangeFileOperations,
  type ProviderExchangeJournal,
  type ProviderRollbackResult
} from "./managed-provider-exchange.js";
import { cancelledTerminalStatus, failedTerminalStatus } from "./managed-provider-lifecycle-status.js";
import type { ManagedProviderLifecycleState, ManagedProviderLifecycleStatus } from "./managed-provider-lifecycle-types.js";

export async function attemptProviderRollback(
  cacheDir: string,
  journal: ProviderExchangeJournal | null,
  commitPersisted: boolean,
  ownership: ProviderCacheOwnership,
  operations: ProviderExchangeFileOperations
): Promise<ProviderRollbackResult> {
  if (!journal || commitPersisted) return { rolled_back: false, failure: null };
  try {
    return await rollbackProviderExchange(cacheDir, journal, ownership, operations);
  } catch (failure) {
    return { rolled_back: false, failure };
  }
}

export interface SettleProviderOperationInput {
  detected: ManagedProviderLifecycleStatus;
  operation: ManagedProviderLifecycleStatus["operation"];
  operation_id: string;
  phase: ManagedProviderLifecycleState;
  cause: unknown;
  cancelled: boolean;
  rolled_back: boolean;
  recovery_failed: boolean;
  integrity_verified: boolean;
  launch_verified: boolean;
  rollback_failure: unknown;
  commit_persisted: boolean;
}

export function settleProviderOperation(input: SettleProviderOperationInput): ManagedProviderLifecycleStatus {
  if (input.cancelled) {
    return cancelledTerminalStatus(
      input.detected, input.operation, input.operation_id, input.rolled_back, input.recovery_failed,
      input.integrity_verified, input.launch_verified, input.rollback_failure, input.commit_persisted
    );
  }
  return failedTerminalStatus(
    input.detected, input.operation, input.operation_id, input.phase, input.cause, input.rolled_back,
    input.recovery_failed, input.integrity_verified, input.launch_verified, input.rollback_failure, input.commit_persisted
  );
}
