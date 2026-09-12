import { ManagedAccessError } from "./managed-access.js";

export type ManagedFileOwnerClient = {
  importFile(input: Record<string, unknown>): Promise<unknown>;
  inspect(fileRef?: string): Promise<unknown>;
  exportFile(input: Record<string, unknown>): Promise<unknown>;
  revoke(fileRef: string): Promise<unknown>;
  delete(fileRef: string): Promise<unknown>;
};

/** Core-only bridge to Harbor's authenticated owner file routes. */
export function createHttpManagedFileOwnerClient(options: { baseUrl: string; supervisorToken: string }): ManagedFileOwnerClient {
  const request = async (path: string, method: "GET" | "POST", input?: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const response = await fetch(new URL(path, options.baseUrl), {
      method,
      headers: { authorization: `Bearer ${options.supervisorToken}`, "content-type": "application/json" },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      signal: AbortSignal.timeout(70_000)
    });
    let value: unknown;
    try { value = await response.json(); } catch { throw new ManagedAccessError("managed_file_unavailable"); }
    if (!response.ok || !value || typeof value !== "object" || Array.isArray(value)) {
      const code = value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).error === "string"
        ? (value as Record<string, unknown>).error as string : "managed_file_unavailable";
      throw new ManagedAccessError(code);
    }
    return value as Record<string, unknown>;
  };
  return {
    importFile: async input => (await request("/owner/files/import", "POST", input)).file,
    inspect: async fileRef => (await request(fileRef === undefined ? "/owner/files" : `/owner/files?file_ref=${encodeURIComponent(fileRef)}`, "GET")).files,
    exportFile: async input => (await request("/owner/files/export", "POST", input)).file,
    revoke: async fileRef => (await request("/owner/files/revoke", "POST", { file_ref: fileRef })).file,
    delete: async fileRef => (await request("/owner/files/delete", "POST", { file_ref: fileRef })).file
  };
}
