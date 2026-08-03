import { randomUUID } from "node:crypto";

export function opaqueRef(kind: string): string {
  return `${kind}_${randomUUID()}`;
}
