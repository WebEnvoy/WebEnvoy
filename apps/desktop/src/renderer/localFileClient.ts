import type { SkillInputAttachment } from "./skillInputDraft";

export async function selectLocalAttachments(): Promise<SkillInputAttachment[] | null> {
  const select = window.webenvoyShell?.selectLocalFiles;
  if (select == null) return null;
  try {
    const result = await select();
    if (result.status === "unavailable") return null;
    if (result.status !== "ready") return [];
    return result.files.slice(0, 32).map((file) => ({
      ...file,
      id: attachmentId(file.localRef, file.name, file.size, file.lastModified),
      state: "ready" as const,
    }));
  } catch {
    return null;
  }
}

export function browserAttachments(files: File[]): SkillInputAttachment[] {
  return files.slice(0, 32).map((file) => ({
    id: attachmentId(undefined, file.name, file.size, file.lastModified),
    name: file.name.slice(0, 255),
    size: file.size,
    type: file.type.slice(0, 255),
    lastModified: file.lastModified,
    state: "ready",
    file,
  }));
}

export async function refreshLocalAttachments(attachments: SkillInputAttachment[]) {
  const localRefs = attachments.flatMap((attachment) => attachment.localRef == null ? [] : [attachment.localRef]);
  const check = window.webenvoyShell?.checkLocalFiles;
  const checks = check == null || localRefs.length === 0 ? [] : await check(localRefs).catch(() => []);
  const readable = new Map(checks.map((item) => [item.localRef, item.readable]));
  return attachments.map((attachment): SkillInputAttachment => {
    if (attachment.file != null) return { ...attachment, state: "ready" };
    if (attachment.localRef == null) return { ...attachment, state: "reselect" };
    return { ...attachment, state: readable.get(attachment.localRef) === true ? "ready" : "unreadable" };
  });
}

export async function releaseLocalAttachments(attachments: SkillInputAttachment[]) {
  const localRefs = attachments.flatMap((attachment) => attachment.localRef == null ? [] : [attachment.localRef]);
  if (localRefs.length === 0) return;
  await window.webenvoyShell?.releaseLocalFiles?.(localRefs).catch(() => undefined);
}

function attachmentId(localRef: string | undefined, name: string, size: number, lastModified: number) {
  return `${localRef ?? "browser"}:${name}:${size}:${lastModified}`;
}
