export type SiteSkillRecoveryRequest = {
  key: number;
  skillId: string;
  identityId: string;
  destination: "skill_repair" | "identity_selection";
};

export type IdentityRecoveryRequest = {
  key: number;
  identityId?: string;
  destination: "authentication" | "provider" | "refresh";
};
