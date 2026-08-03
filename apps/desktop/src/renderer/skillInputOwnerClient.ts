import type { LodeCatalogSkill } from "./lodeCatalogClient";
import type { SkillInputDraft } from "./skillInputDraft";
import { projectProtectedSkillInput } from "./skillInputDraftStore";
import type { TaskProjection } from "./taskThreadFixtures";

export type SkillInputOwnerRefs = {
  ownerRef: string;
  fieldOwnerRefs: Record<string, string>;
  attachmentRefs: Record<string, string[]>;
};

export type SkillInputProjectionRefs = Pick<SkillInputOwnerRefs, "fieldOwnerRefs" | "attachmentRefs">;

export async function sealSkillInput(
  skill: LodeCatalogSkill,
  identityId: string,
  draft: SkillInputDraft,
): Promise<{ ok: true; refs: SkillInputOwnerRefs } | { ok: false; reason: string }> {
  const seal = window.webenvoyShell?.sealProtectedInput;
  if (seal == null) return { ok: false, reason: "受保护输入服务不可用；不会把业务输入写入 Core。" };
  try {
    const result = await seal(projectProtectedSkillInput(skill, identityId, draft));
    return result.status === "ready"
      ? { ok: true, refs: result.refs }
      : { ok: false, reason: "业务输入无法保存为受保护 owner 引用；草稿已保留。" };
  } catch (error) {
    return { ok: false, reason: `受保护输入封存失败：${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function releaseSkillInputOwnerRefs(ownerRefs: string[]) {
  if (ownerRefs.length === 0) return true;
  const release = window.webenvoyShell?.releaseProtectedInputs;
  if (release == null) return false;
  try {
    for (let index = 0; index < ownerRefs.length; index += 32) {
      if ((await release(ownerRefs.slice(index, index + 32))).status !== "ready") return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function terminalSkillInputOwnerRefs(tasks: TaskProjection[]) {
  const refs = new Set<string>();
  for (const task of tasks) {
    for (const run of task.runs) {
      if (!isTerminal(run.turnStatus) || run.businessInput == null) continue;
      for (const field of run.businessInput.fields) addOwnerRef(refs, field.owner_ref);
      for (const attachmentRef of run.businessInput.attachment_refs) addOwnerRef(refs, attachmentRef);
    }
  }
  return [...refs];
}

function isTerminal(status: TaskProjection["runs"][number]["turnStatus"]) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function addOwnerRef(refs: Set<string>, value: string | undefined) {
  if (value == null) return;
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
  const draft = new RegExp(`^(draft:app-protected/${uuid})(?:/|$)`, "i").exec(value)?.[1];
  if (draft != null) {
    refs.add(draft);
    return;
  }
  const attachment = new RegExp(`^attachment:app-protected/(${uuid})(?:/|$)`, "i").exec(value)?.[1];
  if (attachment != null) refs.add(`draft:app-protected/${attachment}`);
}
