import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  IdentityEnvironmentCreateInput,
  IdentityEnvironmentImportInput,
  IdentityEnvironmentMutationRequest,
  ManagedLocalIdentityEnvironmentInput,
  BrowserProviderDetectionInput
} from "./index.js";
import { materializeIdentityEnvironmentMutation } from "./identity-environment-mutations.js";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export const testProviderDetection: BrowserProviderDetectionInput = {
  platform: "darwin",
  arch: "arm64",
  home_dir: "/Users/test",
  env: {},
  path_exists: (path) => path === chromePath,
  is_executable: (path) => path === chromePath,
  read_text: () => null
};

export function identityInput(identityRef: string, profileRef: string): ManagedLocalIdentityEnvironmentInput {
  return {
    platform: "darwin",
    arch: "arm64",
    home_dir: "/Users/test",
    env: {},
    path_exists: (path) => path === chromePath,
    is_executable: (path) => path === chromePath,
    read_text: () => null,
    requested_provider_id: "chrome_official",
    identity_environment_ref: identityRef,
    execution_identity_ref: `${identityRef}:execution`,
    profile_ref: profileRef,
    site: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com", display_name: "小红书" }
  };
}

export function createMutationInput(): IdentityEnvironmentCreateInput {
  return {
    requested_provider_id: "chrome_official",
    site: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com", display_name: "小红书" }
  };
}

export function importMutationInput(profileStorageRef: string): IdentityEnvironmentImportInput {
  return { ...createMutationInput(), import_source_ref: profileStorageRef };
}

export function copyRequest(
  source: string,
  key: string,
  operation: "copy_full" | "copy_environment" = "copy_environment"
): IdentityEnvironmentMutationRequest {
  return {
    operation,
    idempotency_key: key,
    identity_environment_ref: source
  };
}

export function copyTarget(request: IdentityEnvironmentMutationRequest): {
  identity_environment_ref: string;
  execution_identity_ref: string;
  profile_ref: string;
} {
  const materialized = materializeIdentityEnvironmentMutation(request);
  if (materialized.operation !== "copy_full" && materialized.operation !== "copy_environment") {
    throw new TypeError("Expected a copy mutation request.");
  }
  return materialized.target;
}

export function mutationTarget(request: IdentityEnvironmentMutationRequest): {
  identity_environment_ref: string;
  execution_identity_ref: string;
  profile_ref: string;
} {
  const materialized = materializeIdentityEnvironmentMutation(request);
  if (materialized.operation === "create" || materialized.operation === "import") {
    return {
      identity_environment_ref: materialized.identity_environment.identity_environment_ref,
      execution_identity_ref: materialized.identity_environment.execution_identity_ref,
      profile_ref: materialized.identity_environment.profile_ref
    };
  }
  if (materialized.operation === "copy_full" || materialized.operation === "copy_environment") {
    return materialized.target;
  }
  throw new TypeError("Expected an identity-producing mutation request.");
}

export function tempDir(label: string): string {
  return join(tmpdir(), `harbor-${label}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

export function isolateProfileStorage(label: string): () => void {
  const root = tempDir(label);
  const previousRoot = process.env.HARBOR_PROFILE_STORAGE_ROOT;
  process.env.HARBOR_PROFILE_STORAGE_ROOT = root;
  return () => {
    if (previousRoot === undefined) delete process.env.HARBOR_PROFILE_STORAGE_ROOT;
    else process.env.HARBOR_PROFILE_STORAGE_ROOT = previousRoot;
    rmSync(root, { recursive: true, force: true });
  };
}

export function mutationHeaders(token: string): Record<string, string> {
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}
