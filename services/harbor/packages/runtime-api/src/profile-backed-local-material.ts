import type {
  IdentityEnvironmentLocalMaterialRefs,
  IdentityEnvironmentMutationOptions,
  StagedIdentityEnvironmentLocalMaterialCopy
} from "./identity-environment-mutation-types.js";

export function withProfileBackedLocalMaterial(
  options: IdentityEnvironmentMutationOptions
): IdentityEnvironmentMutationOptions {
  return {
    ...options,
    stage_local_material_copy: options.stage_local_material_copy ?? stageProfileBackedMaterialCopy,
    delete_local_material: options.delete_local_material ?? deleteProfileBackedMaterial
  };
}

function stageProfileBackedMaterialCopy(
  refs: Pick<IdentityEnvironmentLocalMaterialRefs, "cookie_jar_ref" | "browser_storage_ref">,
  target: { identity_environment_ref: string; profile_ref: string }
): StagedIdentityEnvironmentLocalMaterialCopy {
  return {
    target_refs: {
      cookie_jar_ref: refs.cookie_jar_ref ? `${target.identity_environment_ref}:cookie-jar` : null,
      browser_storage_ref: refs.browser_storage_ref ? `${target.profile_ref}:browser-storage` : null
    },
    commit: () => undefined,
    rollback: () => true,
    residual: () => false
  };
}

function deleteProfileBackedMaterial(refs: IdentityEnvironmentLocalMaterialRefs): "deleted" | "failed" {
  return refs.credential_ref || refs.keychain_ref || refs.local_secret_ref ? "failed" : "deleted";
}
