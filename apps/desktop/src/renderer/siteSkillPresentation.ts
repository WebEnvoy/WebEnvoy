import type { LodeCatalogSkill } from "./lodeCatalogClient";

export function resultViewLabel(skill: LodeCatalogSkill) {
  if (skill.resultView.mode === "skill") return `技能提供 · v${skill.resultView.viewVersion}`;
  return skill.resultView.reason === "incompatible"
    ? "App 标准结构化视图（技能视图不兼容）"
    : "App 标准结构化视图";
}

export function displaySummary(skill: LodeCatalogSkill) {
  return skill.summary || "站点技能未提供说明。";
}

export function actionLabel(category: WebEnvoyLodeCatalogAction["category"]) {
  return category === "read"
    ? "读取和下载"
    : category === "prepare"
    ? "填写但不提交"
    : category === "commit"
    ? "发布或提交"
    : "危险行为";
}

export function categoryLabel(category: string) {
  return category || "未分类";
}

export function outputLabel(outputKind: string) {
  return outputKind.length > 0 && outputKind !== "unknown" ? "结构化业务结果" : "未声明";
}

export function skillStatusLabel(skill: LodeCatalogSkill) {
  if (skill.lifecycle === "deprecated") return "已停用";
  if (skill.lifecycle === "broken") return "已失效";
  if (skill.availability !== "available") return "合同不完整";
  if (skill.latestVersion !== skill.version) return "可更新";
  return "已安装";
}
