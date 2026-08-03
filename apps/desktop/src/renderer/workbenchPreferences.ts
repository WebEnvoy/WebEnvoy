export type TaskGrouping = "skill" | "identity";
export type TaskSort = "recent" | "priority";

export const taskGroupingStorageKey = "webenvoy.workbench.task-grouping.v1";
export const taskSortStorageKey = "webenvoy.workbench.task-sort.v1";

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export function readTaskGrouping(storage: PreferenceStorage = window.localStorage): TaskGrouping {
  try {
    return storage.getItem(taskGroupingStorageKey) === "identity" ? "identity" : "skill";
  } catch {
    return "skill";
  }
}

export function readTaskSort(storage: PreferenceStorage = window.localStorage): TaskSort {
  try {
    return storage.getItem(taskSortStorageKey) === "priority" ? "priority" : "recent";
  } catch {
    return "recent";
  }
}

export function writeTaskGrouping(grouping: TaskGrouping, storage: PreferenceStorage = window.localStorage) {
  try {
    storage.setItem(taskGroupingStorageKey, grouping);
  } catch {
    // Layout preferences must never block owner data rendering.
  }
}

export function writeTaskSort(sort: TaskSort, storage: PreferenceStorage = window.localStorage) {
  try {
    storage.setItem(taskSortStorageKey, sort);
  } catch {
    // Layout preferences must never block owner data rendering.
  }
}
