export type LatestRequest = {
  signal: AbortSignal;
  isCurrent: () => boolean;
};

export function createLatestRequestGate() {
  let generation = 0;
  let active: AbortController | null = null;
  return {
    begin(): LatestRequest {
      active?.abort();
      const controller = new AbortController();
      const requestGeneration = ++generation;
      active = controller;
      return {
        signal: controller.signal,
        isCurrent: () => generation === requestGeneration && !controller.signal.aborted,
      };
    },
    invalidate() {
      generation += 1;
      active?.abort();
      active = null;
    },
  };
}
