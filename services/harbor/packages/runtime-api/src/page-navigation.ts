import { opaqueRef } from "./refs.js";
import type {
  LocalProviderPageController,
  LocalProviderPageState,
  RuntimeErrorFact,
  RuntimePageFacts,
  RuntimePageStatus
} from "./runtime-session-types.js";

export const HARBOR_PAGE_NAVIGATION_SCHEMA = "harbor-page-navigation/v1";
export const HARBOR_PAGE_LIST_SCHEMA = "harbor-page-list/v2";
export const MAX_PAGE_OBJECTS = 64;
export const MAX_PAGE_EVENTS = 128;
export const MAX_INSTANCE_EVENTS = 512;
export const MAX_PENDING_REQUESTS = 256;

export type ManagedPageOperation =
  | "page.list"
  | "page.open"
  | "page.activate"
  | "page.close"
  | "page.navigate"
  | "page.reload"
  | "page.back"
  | "page.forward";

export interface ManagedPageFacts extends RuntimePageFacts {
  page_id: string;
  page_ref: string;
  document_generation: number;
  origin: string | null;
  active: boolean;
  opener_page_id?: string;
}

export interface ManagedPageList {
  status: "completed";
  schema_version: typeof HARBOR_PAGE_LIST_SCHEMA;
  runtime_session_ref: string;
  active_page_id: string | null;
  pages: ManagedPageFacts[];
  filtered_page_count: number;
  observed_at: string;
}

export type ManagedPageUnavailableClass =
  | "invalid_request"
  | "session_missing"
  | "session_not_ready"
  | "page_selection_required"
  | "page_not_found"
  | "stale_page"
  | "stale_document"
  | "no_safe_return_page"
  | "control_lock_conflict"
  | "navigation_origin_denied"
  | "navigation_beforeunload_blocked"
  | "page_capacity_exceeded"
  | "provider_unavailable"
  | "unknown_outcome";

export interface ManagedPageUnavailable {
  status: "unavailable";
  schema_version: typeof HARBOR_PAGE_NAVIGATION_SCHEMA;
  failure_class: ManagedPageUnavailableClass;
  message: string;
  retryable: boolean;
  runtime_session_ref?: string;
  page_id?: string;
  page_ref?: string;
  document_generation?: number;
  operation_ref?: string;
}

export interface ManagedPageOperationInput {
  operation: ManagedPageOperation;
  operation_ref?: string;
  idempotency_key?: string;
  holder_ref?: string;
  page_id?: string;
  page_ref?: string;
  document_generation?: number;
  url?: string;
  authorized_origins?: string[];
}

interface PageRecord {
  page_id: string;
  provider_page_ref: string;
  provider_state: LocalProviderPageState;
  document_generation: number;
  page_ref: string;
  opener_page_id?: string;
  closed: boolean;
  last_used_at: number;
}

type Receipt = { request_hash: string; result: ManagedPageList | ManagedPageFacts | ManagedPageUnavailable };

export class PageRegistry {
  private readonly byProvider = new Map<string, PageRecord>();
  private readonly byId = new Map<string, PageRecord>();
  private readonly receipts = new Map<string, Receipt>();
  private activePageId: string | null = null;
  private lastUsed: string[] = [];

  constructor(
    private readonly runtimeSessionRef: string,
    private readonly controller: LocalProviderPageController,
    initial: LocalProviderPageState[] = []
  ) {
    this.sync(initial);
  }

  async refresh(): Promise<void> {
    this.sync(await this.controller.listPages());
  }

  /** Harbor-internal binding; provider_page_ref never crosses the API route. */
  binding(input: { page_id?: string; page_ref?: string }): { facts: ManagedPageFacts; provider_page_ref: string } | undefined {
    const record = this.resolve(input);
    return record && !record.closed ? { facts: this.public(record), provider_page_ref: record.provider_page_ref } : undefined;
  }

  activeBinding(): { facts: ManagedPageFacts; provider_page_ref: string } | undefined {
    const record = this.activePageId ? this.byId.get(this.activePageId) : undefined;
    return record && !record.closed ? { facts: this.public(record), provider_page_ref: record.provider_page_ref } : undefined;
  }

  list(authorizedOrigins: readonly string[] = []): ManagedPageList {
    const allowed = new Set(authorizedOrigins);
    const pages = [...this.byId.values()].filter(record => !record.closed);
    const visible = pages.filter(record => this.visible(record, allowed));
    return {
      status: "completed",
      schema_version: HARBOR_PAGE_LIST_SCHEMA,
      runtime_session_ref: this.runtimeSessionRef,
      active_page_id: visible.some(record => record.page_id === this.activePageId) ? this.activePageId : null,
      pages: visible.map(record => this.public(record)),
      filtered_page_count: pages.length - visible.length,
      observed_at: new Date().toISOString()
    };
  }

  async operate(input: ManagedPageOperationInput): Promise<ManagedPageFacts | ManagedPageUnavailable> {
    const hash = JSON.stringify(input, Object.keys(input).sort());
    if (input.operation_ref) {
      const previous = this.receipts.get(input.operation_ref);
      if (previous) return previous.request_hash === hash ? previous.result as ManagedPageFacts : this.unavailable("unknown_outcome", "Page operation idempotency conflict.", false, input);
    }
    const result = await this.operateUnreconciled(input);
    if (input.operation_ref) this.receipts.set(input.operation_ref, { request_hash: hash, result });
    return result;
  }

  private async operateUnreconciled(input: ManagedPageOperationInput): Promise<ManagedPageFacts | ManagedPageUnavailable> {
    try {
      await this.refresh();
      const allowed = new Set(input.authorized_origins ?? []);
      if (input.operation === "page.open") {
        if (!input.url) return this.unavailable("invalid_request", "Page open requires a URL.", false, input);
        const origin = safeOrigin(input.url);
        if (!origin || !allowed.has(origin)) return this.unavailable("navigation_origin_denied", "Page origin is not authorized.", false, input);
        const state = await this.controller.openPage(input.url, input.authorized_origins ?? []);
        this.sync(await this.controller.listPages());
        const record = this.byProvider.get(state.provider_page_ref);
        return record ? this.public(record) : this.unavailable("provider_unavailable", "Provider did not return the opened Page.", true, input);
      }
      const record = this.resolve(input);
      if (!record) return this.unavailable(input.page_ref || input.page_id ? "stale_page" : "page_selection_required", "Page reference is missing or stale.", true, input);
      if (!this.visible(record, allowed)) return this.unavailable("navigation_origin_denied", "Page origin is not authorized.", false, input);
      if (input.document_generation !== undefined && input.document_generation !== record.document_generation) return this.unavailable("stale_document", "Document generation is stale.", true, input, record);
      if (input.operation === "page.list") return this.public(record);
      if (input.operation === "page.activate") {
        const state = await this.controller.activatePage(record.provider_page_ref);
        this.sync(await this.controller.listPages());
        return this.updated(record, state);
      }
      if (input.operation === "page.close") return await this.close(record, allowed, input);
      const action = input.operation === "page.navigate" ? "navigate" : input.operation.slice("page.".length) as "reload" | "back" | "forward";
      if (action === "navigate") {
        if (!input.url) return this.unavailable("invalid_request", "Page navigate requires a URL.", false, input, record);
        const origin = safeOrigin(input.url);
        if (!origin || !allowed.has(origin)) return this.unavailable("navigation_origin_denied", "Page origin is not authorized.", false, input, record);
      }
      const state = await this.controller.navigatePage(record.provider_page_ref, action, input.url, input.authorized_origins ?? []);
      this.sync(await this.controller.listPages());
      const current = this.byProvider.get(state.provider_page_ref) ?? record;
      return this.updated(current, state);
    } catch (error) {
      const failureClass = error instanceof PageNavigationError
        ? error.failure_class
        : (PAGE_PROVIDER_FAILURES.find(value => safeMessage(error).includes(value)) ?? "provider_unavailable");
      return this.unavailable(failureClass, safeMessage(error), failureClass !== "navigation_origin_denied" && failureClass !== "navigation_beforeunload_blocked", input);
    }
  }

  private async close(record: PageRecord, allowed: Set<string>, input: ManagedPageOperationInput): Promise<ManagedPageFacts | ManagedPageUnavailable> {
    const active = record.page_id === this.activePageId || Boolean(record.provider_state.active);
    if (active) {
      const fallback = this.safeFallback(record.page_id, allowed);
      if (!fallback) return this.unavailable("no_safe_return_page", "The active Page has no safe return Page.", false, input, record);
      const states = await this.controller.closePage(record.provider_page_ref);
      this.sync(states);
      const next = this.byId.get(fallback.page_id);
      if (!next || next.closed) return this.unavailable("provider_unavailable", "The safe return Page closed with the active Page.", true, input, record);
      const activated = await this.controller.activatePage(next.provider_page_ref);
      this.sync(await this.controller.listPages());
      return this.updated(next, activated);
    }
    this.sync(await this.controller.closePage(record.provider_page_ref));
    const current = this.activePageId ? this.byId.get(this.activePageId) : undefined;
    return current && !current.closed
      ? this.public(current)
      : this.unavailable("page_not_found", "Page was closed.", false, input, record);
  }

  private safeFallback(closingPageId: string, allowed: Set<string>): PageRecord | undefined {
    const candidates = this.lastUsed.map(id => this.byId.get(id)).filter((record): record is PageRecord => {
      return record !== undefined && record.page_id !== closingPageId && !record.closed && this.visible(record, allowed);
    });
    return candidates[0] ?? [...this.byId.values()].find(record => record.page_id !== closingPageId && !record.closed && this.visible(record, allowed));
  }

  private resolve(input: Pick<ManagedPageOperationInput, "page_id" | "page_ref">): PageRecord | undefined {
    if (input.page_id) {
      const record = this.byId.get(input.page_id);
      if (!record || record.closed || (input.page_ref && record.page_ref !== input.page_ref)) return undefined;
      return record;
    }
    if (input.page_ref) return [...this.byId.values()].find(record => record.page_ref === input.page_ref && !record.closed);
    return undefined;
  }

  private sync(states: LocalProviderPageState[]): void {
    const seen = new Set<string>();
    for (const state of states.slice(0, MAX_PAGE_OBJECTS)) {
      if (!state.provider_page_ref) continue;
      seen.add(state.provider_page_ref);
      const existing = this.byProvider.get(state.provider_page_ref);
      const providerGeneration = state.document_generation ?? existing?.document_generation ?? 1;
      const generation = existing ? Math.max(existing.document_generation, providerGeneration) : Math.max(1, providerGeneration);
      const changed = Boolean(existing && (
        (existing.provider_state.current_url !== state.current_url && state.current_url) ||
        providerGeneration > existing.document_generation
      ));
      const page = existing ?? {
        page_id: opaqueRef("page_object"), provider_page_ref: state.provider_page_ref, provider_state: state,
        document_generation: generation, page_ref: opaqueRef("page"), closed: false, last_used_at: Date.now()
      } satisfies PageRecord;
      if (changed) {
        page.document_generation = Math.max(page.document_generation + 1, state.document_generation ?? 0);
        page.page_ref = opaqueRef("page");
      }
      page.provider_state = state;
      page.closed = false;
      page.opener_page_id = state.opener_provider_page_ref ? this.byProvider.get(state.opener_provider_page_ref)?.page_id : undefined;
      this.byProvider.set(state.provider_page_ref, page);
      this.byId.set(page.page_id, page);
      if (state.active) {
        this.activePageId = page.page_id;
        this.lastUsed = [page.page_id, ...this.lastUsed.filter(id => id !== page.page_id)].slice(0, MAX_PAGE_OBJECTS);
      }
    }
    for (const page of this.byId.values()) if (!seen.has(page.provider_page_ref) && !page.closed) page.closed = true;
  }

  private updated(record: PageRecord, state: LocalProviderPageState): ManagedPageFacts {
    const previousUrl = record.provider_state.current_url;
    const providerGeneration = state.document_generation ?? record.document_generation;
    if ((previousUrl !== state.current_url && state.current_url) || providerGeneration > record.document_generation) {
      record.document_generation = Math.max(record.document_generation + 1, providerGeneration);
      record.page_ref = opaqueRef("page");
    }
    record.provider_state = state;
    record.closed = false;
    if (state.active) this.activePageId = record.page_id;
    record.last_used_at = Date.now();
    this.lastUsed = [record.page_id, ...this.lastUsed.filter(id => id !== record.page_id)].slice(0, MAX_PAGE_OBJECTS);
    return this.public(record);
  }

  private visible(record: PageRecord, allowed: Set<string>): boolean {
    const origin = safeOrigin(record.provider_state.current_url);
    return origin !== null && allowed.has(origin);
  }

  private public(record: PageRecord): ManagedPageFacts {
    const page = record.provider_state;
    const current_url = sanitizeUrl(page.current_url);
    const origin = safeOrigin(page.current_url);
    return {
      requested_url: current_url ?? "about:blank", current_url, title: safeTitle(page.title), status: page.status,
      error_reason: page.error ?? null, observed_at: new Date().toISOString(), page_id: record.page_id,
      page_ref: record.page_ref, document_generation: record.document_generation, origin, active: record.page_id === this.activePageId,
      ...(record.opener_page_id ? { opener_page_id: record.opener_page_id } : {})
    };
  }

  private unavailable(failure_class: ManagedPageUnavailableClass, message: string, retryable: boolean, input: ManagedPageOperationInput, record?: PageRecord): ManagedPageUnavailable {
    return {
      status: "unavailable", schema_version: HARBOR_PAGE_NAVIGATION_SCHEMA, failure_class,
      message: message.slice(0, 256).replace(/[?&#][^ ]*/g, ""), retryable,
      runtime_session_ref: this.runtimeSessionRef, ...(record ? { page_id: record.page_id, page_ref: record.page_ref, document_generation: record.document_generation } : {}),
      ...(input.operation_ref ? { operation_ref: input.operation_ref } : {})
    };
  }
}

const PAGE_PROVIDER_FAILURES: ManagedPageUnavailableClass[] = [
  "navigation_origin_denied", "navigation_beforeunload_blocked", "stale_page", "page_not_found", "provider_unavailable"
];

export class PageNavigationError extends Error {
  constructor(readonly failure_class: ManagedPageUnavailableClass, message: string) { super(message); }
}

/** Adapter for existing single-page providers while they are upgraded. */
export function createLegacyPageController(
  initial: LocalProviderPageState,
  openUrl: (url: string) => Promise<LocalProviderPageState | Omit<LocalProviderPageState, "provider_page_ref">>
): LocalProviderPageController {
  let page = structuredClone(initial);
  let closed = false;
  const ensure = () => {
    if (closed) throw new PageNavigationError("page_not_found", "The legacy provider Page is closed.");
    return page;
  };
  return {
    listPages: async () => closed ? [] : [ensure()],
    openPage: async () => { throw new PageNavigationError("provider_unavailable", "The provider does not expose multiple Page objects."); },
    activatePage: async () => ({ ...ensure(), active: true }),
    closePage: async () => { closed = true; return []; },
    navigatePage: async (_providerPageRef, action, url) => {
      if (action !== "navigate") throw new PageNavigationError("provider_unavailable", "The provider does not expose history navigation.");
      if (!url) throw new PageNavigationError("invalid_request", "A navigation URL is required.");
      page = { ...await openUrl(url), provider_page_ref: page.provider_page_ref, active: true } as LocalProviderPageState;
      return ensure();
    }
  };
}

function safeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
}

function sanitizeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.slice(0, 2048);
  } catch { return null; }
}

function safeTitle(value: string | null | undefined): string | null {
  if (!value || /(?:token|cookie|password|secret|authorization)\s*[=:]/i.test(value)) return value ? "[redacted]" : null;
  return value.slice(0, 256);
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Page operation failed.";
}
