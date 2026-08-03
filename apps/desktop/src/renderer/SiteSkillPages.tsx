import { useEffect, useState } from "react";

import {
  loadingSkillIdentityCompatibility,
  type IdentityCompatibilityCandidate,
  type SkillIdentityCompatibilityState,
} from "./coreIdentityCompatibilityClient";
import type { IdentityEnvironmentProjection } from "./identityEnvironmentFixtures";
import type { LodeCatalogLoadState, LodeCatalogSkill } from "./lodeCatalogClient";
import type { RuntimeSupervisorState } from "./runtimeSupervisorState";
import { SiteSkillDetail } from "./SiteSkillDetail";
import { SiteSkillDirectory } from "./SiteSkillDirectory";
import type { SiteSkillRecoveryRequest } from "./siteSkillRecovery";
import "./SiteSkillPages.css";

type LibraryMode = "catalog" | "detail";

type SiteSkillLibraryProps = {
  catalog: LodeCatalogLoadState;
  compatibilityBySkill: Record<string, SkillIdentityCompatibilityState>;
  identities: IdentityEnvironmentProjection[];
  runtimeSupervisorState: RuntimeSupervisorState;
  recoveryRequest?: SiteSkillRecoveryRequest;
  onRecoveryConsumed: (key: number) => void;
  onCreateIdentity: () => void;
  onNavigation: () => void;
  onRecoverCandidate: (skill: LodeCatalogSkill, identityId: string, candidate: IdentityCompatibilityCandidate) => void;
  onUse: (skill: LodeCatalogSkill, identityId?: string) => void;
};

export function SiteSkillLibrary(props: SiteSkillLibraryProps) {
  const { catalog, compatibilityBySkill } = props;
  const [mode, setMode] = useState<LibraryMode>("catalog");
  const [selectedSkillId, setSelectedSkillId] = useState(catalog.skills[0]?.id ?? "");
  const [returnFocusSkillId, setReturnFocusSkillId] = useState("");
  const [recoveryContext, setRecoveryContext] = useState<SiteSkillRecoveryRequest>();
  const selectedSkill = catalog.skills.find((skill) => skill.id === selectedSkillId);

  useEffect(() => {
    if (mode === "detail" && selectedSkill == null) setMode("catalog");
  }, [mode, selectedSkill]);
  useEffect(() => {
    if (props.recoveryRequest == null) return;
    setSelectedSkillId(props.recoveryRequest.skillId);
    setReturnFocusSkillId(props.recoveryRequest.skillId);
    setRecoveryContext(props.recoveryRequest);
    setMode("detail");
    props.onRecoveryConsumed(props.recoveryRequest.key);
  }, [props.recoveryRequest]);

  function navigate(action: () => void) {
    setRecoveryContext(undefined);
    props.onNavigation();
    action();
  }

  if (mode === "detail" && selectedSkill != null) {
    return (
      <SiteSkillDetail
        catalogStatus={catalog.status}
        compatibility={compatibilityBySkill[selectedSkill.id] ?? loadingSkillIdentityCompatibility()}
        identities={props.identities}
        runtimeSupervisorState={props.runtimeSupervisorState}
        recoveryRequest={recoveryContext?.skillId === selectedSkill.id ? recoveryContext : undefined}
        skill={selectedSkill}
        onBack={() => navigate(() => setMode("catalog"))}
        onContextChange={() => navigate(() => undefined)}
        onCreateIdentity={props.onCreateIdentity}
        onRecoverCandidate={props.onRecoverCandidate}
        onUse={props.onUse}
      />
    );
  }

  return (
    <SiteSkillDirectory
      catalog={catalog}
      compatibilityBySkill={compatibilityBySkill}
      initialFocusSkillId={returnFocusSkillId}
      identities={props.identities}
      runtimeSupervisorState={props.runtimeSupervisorState}
      onOpen={(skill) => navigate(() => { setSelectedSkillId(skill.id); setReturnFocusSkillId(skill.id); setMode("detail"); })}
      onUse={props.onUse}
    />
  );
}
