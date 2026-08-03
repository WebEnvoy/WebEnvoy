import { useEffect, useRef, useState, type SetStateAction } from "react";

import type { LodeCatalogSkill } from "./lodeCatalogClient";
import { refreshLocalAttachments, releaseLocalAttachments } from "./localFileClient";
import { createSkillInputDraft, type SkillInputDraft } from "./skillInputDraft";
import {
  cacheSkillInputDraft,
  clearSkillInputDraft,
  isCurrentSkillInputDraftGeneration,
  loadSkillInputDraft,
  persistSkillInputDraft,
  type RestoredDraft,
} from "./skillInputDraftStore";

const initialRestore = (skill: LodeCatalogSkill): RestoredDraft => ({
  draft: createSkillInputDraft(skill),
  generation: 0,
  restored: false,
  omittedFieldIds: [],
  persistence: "ready",
});

export function useCreateTaskDraft(skill: LodeCatalogSkill, identityId: string | undefined) {
  const initial = initialRestore(skill);
  const [draft, setDraftState] = useState(initial.draft);
  const draftRef = useRef(initial.draft);
  const [restored, setRestored] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const clearingRef = useRef(false);
  const clearPromise = useRef<Promise<RestoredDraft["persistence"]> | null>(null);
  const pendingSave = useRef<Promise<unknown> | null>(null);
  const latestSaveGeneration = useRef(0);
  const contextGeneration = useRef(0);
  const contextKey = `${skill.packageRef}\u0000${skill.version}\u0000${identityId ?? ""}`;

  useEffect(() => {
    let active = true;
    setLoading(true);
    void restoreCurrentDraft();
    return () => { active = false; };

    async function restoreCurrentDraft() {
      while (active) {
        const loaded = await loadSkillInputDraft(skill, identityId);
        const files = await refreshDraftFiles(loaded.draft);
        if (!active) return;
        if (!isCurrentSkillInputDraftGeneration(skill, identityId, loaded.generation)) continue;
        const draft = files == null ? loaded.draft : { ...loaded.draft, files };
        draftRef.current = draft;
        contextGeneration.current = loaded.generation;
        setDraftState(draft);
        setRestored({ ...loaded, draft });
        setLoading(false);
        return;
      }
    }
  }, [contextKey]);

  function setDraft(update: SetStateAction<SkillInputDraft>) {
    if (clearingRef.current) return;
    const next = typeof update === "function" ? update(draftRef.current) : update;
    draftRef.current = next;
    setDraftState(next);
    if (loading) return;
    const generation = cacheSkillInputDraft(skill, identityId, next, contextGeneration.current);
    if (generation == null) return;
    latestSaveGeneration.current = generation;
    const saving = persistSkillInputDraft(skill, identityId, next, generation).then((persistence) => {
      if (generation === latestSaveGeneration.current && persistence === "unavailable") {
        setRestored((current) => ({ ...current, persistence }));
      }
      return persistence;
    });
    pendingSave.current = saving;
    void saving.finally(() => { if (pendingSave.current === saving) pendingSave.current = null; });
  }

  function clearDraft() {
    if (clearPromise.current != null) return clearPromise.current;
    clearingRef.current = true;
    setClearing(true);
    const operation = performClear();
    clearPromise.current = operation;
    void operation.finally(() => {
      if (clearPromise.current === operation) clearPromise.current = null;
      clearingRef.current = false;
      setClearing(false);
    });
    return operation;
  }

  async function performClear() {
    await pendingSave.current;
    const clearedResult = await clearSkillInputDraft(skill, identityId);
    contextGeneration.current = clearedResult.generation;
    await releaseLocalAttachments(Object.values(draftRef.current.files).flat());
    const cleared = createSkillInputDraft(skill);
    draftRef.current = cleared;
    setDraftState(cleared);
    setRestored({ draft: cleared, generation: clearedResult.generation, restored: false, omittedFieldIds: [], persistence: clearedResult.persistence });
    return clearedResult.persistence;
  }

  return { clearDraft, clearing, draft, loading, restored, setDraft };
}

async function refreshDraftFiles(draft: SkillInputDraft) {
  const entries = await Promise.all(Object.entries(draft.files).map(async ([fieldId, files]) =>
    [fieldId, await refreshLocalAttachments(files)] as const,
  ));
  const files = Object.fromEntries(entries);
  return JSON.stringify(files) === JSON.stringify(draft.files) ? null : files;
}
