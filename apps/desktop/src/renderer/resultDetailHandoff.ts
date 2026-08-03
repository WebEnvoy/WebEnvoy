import type { LodeCatalogSkill } from "./lodeCatalogClient";

export const xiaohongshuDetailHandoff = {
  actionId: "xhs_read_note_detail",
  lockRef: "lode://lock/site-capability/xiaohongshu/read-note-detail@0.1.0",
  packageRef: "lode://site-capability/xiaohongshu/read-note-detail@0.1.0",
  siteSlug: "xiaohongshu",
  targetType: "xiaohongshu_note_detail",
} as const;

const opaqueDetailRefPattern = /^detail_ref_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isOpaqueDetailRef(value: unknown): value is string {
  return typeof value === "string" && opaqueDetailRefPattern.test(value);
}

export function isXiaohongshuDetailHandoffSkill(skill: LodeCatalogSkill) {
  return skill.packageRef === xiaohongshuDetailHandoff.packageRef &&
    skill.lockRef === xiaohongshuDetailHandoff.lockRef &&
    skill.siteSlug === xiaohongshuDetailHandoff.siteSlug &&
    skill.actions.length === 1 &&
    skill.actions[0]?.id === xiaohongshuDetailHandoff.actionId;
}
