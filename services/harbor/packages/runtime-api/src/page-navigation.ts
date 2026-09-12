import { opaqueRef } from "./refs.js";
import type {
  LocalProviderPageController,
  LocalProviderPageFacts,
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
export const MAX_PAGE_OPERATION_RECEIPTS = MAX_PENDING_REQUESTS;
export const MAX_PAGE_TOMBSTONES = MAX_PAGE_OBJECTS;

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
  active?: boolean;
  opener_page_id?: string;
}

export interface ManagedPageList {
  status: "completed";
  schema_version: typeof HARBOR_PAGE_LIST_SCHEMA;
  runtime_session_ref: string;
  active_page_id: string | null;
  pages: ManagedPageFacts[];
  filtered_page_count: number;
  /** Bounded aggregate for blocked Page requests with no proven relation. */
  rejected_unattributed?: {
    count: number;
    failure_class: "page_relation_unavailable";
    dispatch_state: "not_dispatched";
  };
  observed_at: string;
}

/**
 * Receipt returned for every Page mutation that has an operation reference.
 * Provider handles never cross this boundary; the optional Page is the
 * registry's public projection only.
 */
export interface ManagedPageOperationReceipt {
  status: "completed" | "unavailable" | "unknown_outcome";
  schema_version: typeof HARBOR_PAGE_NAVIGATION_SCHEMA;
  dispatch_state: "not_dispatched" | "dispatched";
  operation_ref: string;
  runtime_session_ref: string;
  observed_at: string;
  page?: ManagedPageFacts;
  failure_class?: ManagedPageUnavailableClass;
  message?: string;
  retryable?: boolean;
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
  | "page_relation_unavailable"
  | "provider_unavailable"
  | "unknown_outcome";

export interface ManagedPageUnavailable {
  status: "unavailable";
  schema_version: typeof HARBOR_PAGE_NAVIGATION_SCHEMA;
  failure_class: ManagedPageUnavailableClass;
  message: string;
  retryable: boolean;
  dispatch_state: "not_dispatched" | "dispatched";
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
  /** The Provider omitted this object from a valid list, but did not prove a close. */
  present: boolean;
  last_used_at: number;
  closed_at?: number;
}

type Receipt = { request_hash: string; result: ManagedPageOperationReceipt };

export class PageRegistry {
  private readonly byProvider = new Map<string, PageRecord>();
  private readonly byId = new Map<string, PageRecord>();
  private readonly receipts = new Map<string, Receipt>();
  private activePageId: string | null = null;
  /** Explicit Harbor task selection; this is never projected as native focus. */
  private taskPageId: string | null = null;
  private lastUsed: string[] = [];

  constructor(
    private readonly runtimeSessionRef: string,
    private readonly controller: LocalProviderPageController,
    initial: LocalProviderPageState[] = []
  ) {
    this.sync(initial);
  }

  async refresh(): Promise<void> {
    try {
      this.sync(await this.controller.listPages());
    } catch (error) {
      this.relationFresh = false;
      throw asPageNavigationError(error);
    }
  }

  /** Harbor-internal binding; provider_page_ref never crosses the API route. */
  binding(input: { page_id?: string; page_ref?: string }): { facts: ManagedPageFacts; provider_page_ref: string } | undefined {
    if (!this.relationFresh) return undefined;
    const record = this.resolve(input);
    return record && !record.closed && record.present ? { facts: this.public(record), provider_page_ref: record.provider_page_ref } : undefined;
  }

  activeBinding(): { facts: ManagedPageFacts; provider_page_ref: string } | undefined {
    if (!this.relationFresh) return undefined;
    const record = (this.taskPageId ? this.byId.get(this.taskPageId) : undefined) ??
      (this.activePageId ? this.byId.get(this.activePageId) : undefined);
    return record && !record.closed && record.present ? { facts: this.public(record), provider_page_ref: record.provider_page_ref } : undefined;
  }

  /** Harbor-internal legacy selection; an omitted allowlist means all live Pages. */
  legacyBindings(authorizedOrigins?: readonly string[]): Array<{ facts: ManagedPageFacts; provider_page_ref: string }> {
    if (!this.relationFresh) return [];
    const allowed = authorizedOrigins === undefined ? undefined : new Set(authorizedOrigins);
    return [...this.byId.values()]
      .filter(record => !record.closed && record.present && (allowed === undefined || this.visible(record, allowed)))
      .map(record => ({ facts: this.public(record), provider_page_ref: record.provider_page_ref }));
  }

  /** Reconcile a bounded result from a trusted operation without guessing identity from URL/title. */
  updateProviderPage(provider_page_ref: string, facts: LocalProviderPageFacts): { facts: ManagedPageFacts; provider_page_ref: string } | undefined {
    if (!this.relationFresh) return undefined;
    const record = this.byProvider.get(provider_page_ref);
    if (!record || record.closed || !record.present) return undefined;
    const state: LocalProviderPageState = { ...record.provider_state, ...facts, provider_page_ref };
    this.updated(record, state);
    return { facts: this.public(record), provider_page_ref };
  }

  list(authorizedOrigins: readonly string[] = []): ManagedPageList {
    if (!this.relationFresh) throw new PageNavigationError("page_relation_unavailable", "The Provider Page relation is unavailable.");
    const allowed = new Set(authorizedOrigins);
    const pages = [...this.byId.values()].filter(record => !record.closed && record.present);
    const visible = pages.filter(record => this.visible(record, allowed));
    const rejectedUnattributedCount = Math.min(
      MAX_PAGE_EVENTS,
      this.rejectedUnattributedCount(pages, allowed) + Math.max(0, this.controller.unattributedRequestRejectionCount?.() ?? 0)
    );
    return {
      status: "completed",
      schema_version: HARBOR_PAGE_LIST_SCHEMA,
      runtime_session_ref: this.runtimeSessionRef,
      active_page_id: visible.some(record => record.page_id === this.activePageId) ? this.activePageId : null,
      pages: visible.map(record => this.public(record)),
      filtered_page_count: pages.length - visible.length,
      ...(rejectedUnattributedCount > 0 ? {
        rejected_unattributed: {
          count: rejectedUnattributedCount,
          failure_class: "page_relation_unavailable" as const,
          dispatch_state: "not_dispatched" as const
        }
      } : {}),
      observed_at: new Date().toISOString()
    };
  }

  /**
   * Preserve the original registry projection for callers that do not need a
   * receipt (notably the deterministic registry fixtures). Runtime uses
   * operateReceipt below for all public mutation dispatches.
   */
  async operate(input: ManagedPageOperationInput): Promise<ManagedPageFacts | ManagedPageUnavailable> {
    const receipt = await this.operateReceipt(input);
    if (receipt.status === "completed" && receipt.page) return receipt.page;
    return receiptToUnavailable(receipt);
  }

  async operateReceipt(input: ManagedPageOperationInput): Promise<ManagedPageOperationReceipt> {
    const operationRef = input.operation_ref ?? opaqueRef("page_operation");
    const hash = JSON.stringify(input, Object.keys(input).sort());
    if (input.operation_ref) {
      const previous = this.receipts.get(input.operation_ref);
      if (previous) {
        return previous.request_hash === hash
          ? structuredClone(previous.result)
          : this.receiptUnavailable(input, "unknown_outcome", "Page operation idempotency conflict.", false, "not_dispatched");
      }
      // Never evict operation receipts: doing so would permit a duplicate
      // external action after a later retry. A full bounded cache rejects the
      // new operation before any Provider call.
      if (this.receipts.size >= MAX_PAGE_OPERATION_RECEIPTS) {
        return this.receiptUnavailable(input, "page_capacity_exceeded", "Page operation receipt capacity exceeded.", false, "not_dispatched");
      }
      this.receipts.set(input.operation_ref, {
        request_hash: hash,
        result: this.receiptUnavailable(input, "unknown_outcome", "Page operation is in progress.", false, "not_dispatched")
      });
    }

    let dispatchState: "not_dispatched" | "dispatched" = "not_dispatched";
    const markDispatched = () => {
      dispatchState = "dispatched";
      if (input.operation_ref) {
        const receipt = this.receipts.get(input.operation_ref);
        if (receipt) receipt.result = this.receiptFromResult(input, "unknown_outcome", dispatchState, undefined, "Page operation is in progress.");
      }
    };
    const result = await this.operateUnreconciled(input, markDispatched);
    const receipt = this.receiptFromResult(input, "failure_class" in result ? undefined : "completed", dispatchState, result);
    if (input.operation_ref) {
      const stored = this.receipts.get(input.operation_ref);
      if (stored) stored.result = receipt;
    }
    return receipt;
  }

  getOperation(operation_ref: string): ManagedPageOperationReceipt | undefined {
    const result = this.receipts.get(operation_ref)?.result;
    return result ? structuredClone(result) : undefined;
  }

  /** Control generation changes invalidate document-bound observations without changing Page identity. */
  invalidatePageBindings(): void {
    for (const page of this.byId.values()) if (!page.closed) page.page_ref = opaqueRef("page");
  }

  /** Provider loss invalidates the relation; old records are not reclassified as closed. */
  invalidateRelation(): void {
    this.relationFresh = false;
  }

  private async operateUnreconciled(input: ManagedPageOperationInput, markDispatched: () => void): Promise<ManagedPageFacts | ManagedPageUnavailable> {
    let dispatched: "not_dispatched" | "dispatched" = "not_dispatched";
    const dispatch = () => { dispatched = "dispatched"; markDispatched(); };
    try {
      await this.refresh();
      const allowed = new Set(input.authorized_origins ?? []);
      if (input.operation === "page.open") {
        if (!input.url) return this.unavailable("invalid_request", "Page open requires a URL.", false, input);
        const origin = safeOrigin(input.url);
        if (!origin || !allowed.has(origin)) return this.unavailable("navigation_origin_denied", "Page origin is not authorized.", false, input);
        if (this.livePageCount() >= MAX_PAGE_OBJECTS) return this.unavailable("page_capacity_exceeded", "The Page Registry has reached its bounded object capacity.", false, input);
        dispatch();
        const state = await this.controller.openPage(input.url, input.authorized_origins ?? []);
        this.sync(await this.controller.listPages());
        const record = this.byProvider.get(state.provider_page_ref);
        if (record && record.present && !record.closed) this.taskPageId = record.page_id;
        return record && record.present && !record.closed
          ? this.public(record)
          : this.unavailable("provider_unavailable", "Provider did not return the opened Page.", true, input, undefined, dispatched);
      }
      const record = this.resolve(input);
      if (!record) return this.unavailable(input.page_ref || input.page_id ? "stale_page" : "page_selection_required", "Page reference is missing or stale.", true, input);
      if (!this.visible(record, allowed)) return this.unavailable("navigation_origin_denied", "Page origin is not authorized.", false, input);
      if (input.document_generation !== undefined && input.document_generation !== record.document_generation) return this.unavailable("stale_document", "Document generation is stale.", true, input, record);
      if (input.operation === "page.list") return this.public(record);
      if (input.operation === "page.activate") {
        dispatch();
        const state = await this.controller.activatePage(record.provider_page_ref);
        this.sync(await this.controller.listPages());
        this.taskPageId = record.page_id;
        return this.updated(record, state);
      }
      if (input.operation === "page.close") return await this.close(record, allowed, input, dispatch);
      const action = input.operation === "page.navigate" ? "navigate" : input.operation.slice("page.".length) as "reload" | "back" | "forward";
      if (action === "navigate") {
        if (!input.url) return this.unavailable("invalid_request", "Page navigate requires a URL.", false, input, record);
        const origin = safeOrigin(input.url);
        if (!origin || !allowed.has(origin)) return this.unavailable("navigation_origin_denied", "Page origin is not authorized.", false, input, record);
      }
      dispatch();
      const state = await this.controller.navigatePage(record.provider_page_ref, action, input.url, input.authorized_origins ?? []);
      this.sync(await this.controller.listPages());
      const current = this.byProvider.get(state.provider_page_ref) ?? record;
      this.taskPageId = current.page_id;
      return this.updated(current, state);
    } catch (error) {
      const failureClass = error instanceof PageNavigationError
        ? error.failure_class
        : pageNavigationFailureClass(error);
      const providerDispatch = error instanceof PageNavigationError && error.dispatch_state === "dispatched";
      const finalDispatch = providerDispatch ? "dispatched" : dispatched;
      return this.unavailable(failureClass, safeMessage(error), failureClass !== "navigation_origin_denied" && failureClass !== "navigation_beforeunload_blocked", input, undefined, finalDispatch);
    }
  }

  private async close(record: PageRecord, allowed: Set<string>, input: ManagedPageOperationInput, markDispatched: () => void): Promise<ManagedPageFacts | ManagedPageUnavailable> {
    if (this.safeReturnablePageCount() <= 1) {
      return this.unavailable("no_safe_return_page", "The last usable Page cannot be closed without a safe return Page.", false, input, record);
    }
    const selected = record.page_id === this.taskPageId;
    const nativeActive = record.page_id === this.activePageId || record.provider_state.active === true;
    if (selected || nativeActive) {
      const fallback = this.safeFallback(record.page_id, allowed);
      if (!fallback) return this.unavailable("no_safe_return_page", "The selected Page has no safe return Page.", false, input, record);
      markDispatched();
      const states = await this.controller.closePage(record.provider_page_ref, fallback.provider_page_ref);
      const closedState = states.find(state => state.provider_page_ref === record.provider_page_ref);
      if (closedState && closedState.status !== "closed") {
        throw new PageNavigationError("page_relation_unavailable", "The Provider did not confirm the active Page close.", "dispatched");
      }
      record.closed = true;
      record.present = false;
      this.sync(states, true, new Set([record.provider_page_ref]));
      const next = this.byId.get(fallback.page_id);
      if (!next || next.closed || !next.present) return this.unavailable("provider_unavailable", "The safe return Page closed with the active Page.", true, input, record, "dispatched");
      // The safe return handle is an explicit internal task selection. The
      // provider may omit native focus, which must remain unknown publicly.
      this.taskPageId = next.page_id;
      return this.public(next);
    }
    markDispatched();
    const current = this.taskPageId ? this.byId.get(this.taskPageId) : undefined;
    const states = await this.controller.closePage(record.provider_page_ref, current?.provider_page_ref);
    const closedState = states.find(state => state.provider_page_ref === record.provider_page_ref);
    if (closedState && closedState.status !== "closed") {
      throw new PageNavigationError("page_relation_unavailable", "The Provider did not confirm the Page close.", "dispatched");
    }
    record.closed = true;
    record.present = false;
    this.sync(states, true, new Set([record.provider_page_ref]));
    const selectedAfterClose = this.taskPageId ? this.byId.get(this.taskPageId) : undefined;
    return selectedAfterClose && !selectedAfterClose.closed && selectedAfterClose.present && this.visible(selectedAfterClose, allowed)
      ? this.public(selectedAfterClose)
      : this.unavailable("page_not_found", "Page was closed.", false, input, record, "dispatched");
  }

  private safeFallback(closingPageId: string, allowed: Set<string>): PageRecord | undefined {
    const candidates = this.lastUsed.map(id => this.byId.get(id)).filter((record): record is PageRecord => {
      return record !== undefined && record.page_id !== closingPageId && !record.closed && record.present && this.safeReturnable(record) && this.visible(record, allowed);
    });
    return candidates[0] ?? [...this.byId.values()].find(record => record.page_id !== closingPageId && !record.closed && record.present && this.safeReturnable(record) && this.visible(record, allowed));
  }

  private safeReturnable(record: PageRecord): boolean {
    return record.provider_state.status === "ready" || record.provider_state.status === "loading";
  }

  private livePageCount(): number {
    return [...this.byId.values()].filter(record => !record.closed && record.present).length;
  }

  private safeReturnablePageCount(): number {
    return [...this.byId.values()].filter(record => !record.closed && record.present && this.safeReturnable(record)).length;
  }

  private rejectedUnattributedCount(pages: PageRecord[], allowed: Set<string>): number {
    return pages.reduce((total, record) => {
      const opener = record.provider_state.opener_provider_page_ref
        ? this.byProvider.get(record.provider_state.opener_provider_page_ref)
        : undefined;
      if (!opener || opener.closed || !opener.present || !this.visible(opener, allowed)) return total;
      const count = record.provider_state.facts
        .find(fact => fact.key === "page.rejected_unattributed_count" && fact.source === "validation_evidence")?.value;
      const parsed = count === undefined ? 0 : Number(count);
      return total + (Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, MAX_PAGE_EVENTS) : 0);
    }, 0);
  }

  private resolve(input: Pick<ManagedPageOperationInput, "page_id" | "page_ref">): PageRecord | undefined {
    if (input.page_id) {
      const record = this.byId.get(input.page_id);
      if (!record || record.closed || !record.present || (input.page_ref && record.page_ref !== input.page_ref)) return undefined;
      return record;
    }
    if (input.page_ref) return [...this.byId.values()].find(record => record.page_ref === input.page_ref && !record.closed && record.present);
    return undefined;
  }

  private sync(states: LocalProviderPageState[], allowNoActive = false, confirmedClosedProviderRefs: ReadonlySet<string> = new Set()): void {
    try {
      this.syncUnchecked(states, allowNoActive, confirmedClosedProviderRefs);
    } catch (error) {
      this.relationFresh = false;
      throw error;
    }
  }

  private syncUnchecked(states: LocalProviderPageState[], allowNoActive = false, confirmedClosedProviderRefs: ReadonlySet<string> = new Set()): void {
    if (!Array.isArray(states)) throw new PageNavigationError("page_relation_unavailable", "The Provider Page list is invalid.");
    if (states.length > MAX_PAGE_OBJECTS + MAX_PAGE_TOMBSTONES) throw new PageNavigationError("page_capacity_exceeded", "The Provider returned more Pages than Harbor can safely track.");
    if (states.length === 0 && [...this.byId.values()].some(record => !record.closed)) {
      throw new PageNavigationError("page_relation_unavailable", "The Provider Page list is empty while tracked Pages remain open.");
    }
    const refs = new Set<string>();
    for (const state of states) {
      if (!state || typeof state.provider_page_ref !== "string" || !state.provider_page_ref || refs.has(state.provider_page_ref)) {
        throw new PageNavigationError("page_relation_unavailable", "The Provider Page list did not prove unique Page identities.");
      }
      refs.add(state.provider_page_ref);
    }
    const newPageCount = [...refs].filter(providerRef => {
      const state = states.find(candidate => candidate.provider_page_ref === providerRef);
      if (state?.status === "closed") return false;
      const previous = this.byProvider.get(providerRef);
      return !previous || previous.closed || !previous.present;
    }).length;
    if (this.livePageCount() + newPageCount > MAX_PAGE_OBJECTS) {
      throw new PageNavigationError("page_capacity_exceeded", "The Page Registry cannot retain another Page identity.");
    }
    const openStates = states.filter(state => state.status !== "closed");
    const closedStates = states.filter(state => state.status === "closed");
    if (closedStates.some(state => state.active === true)) {
      throw new PageNavigationError("page_relation_unavailable", "The Provider marked a closed Page as active.");
    }
    const active = openStates.filter(state => state.active === true);
    const activeFacts = openStates.filter(state => typeof state.active === "boolean");
    if (active.length > 1) throw new PageNavigationError("page_relation_unavailable", "The Provider Page list proved more than one active Page.");
    if (activeFacts.length > 0 && active.length !== 1 && !allowNoActive) {
      throw new PageNavigationError("page_relation_unavailable", "The Provider Page list did not prove exactly one active Page.");
    }
    const seen = new Set(states.map(state => state.provider_page_ref));
    const missingOpen = [...this.byId.values()].filter(page => !page.closed && !seen.has(page.provider_page_ref));
    const unconfirmedMissing = missingOpen.filter(page => !confirmedClosedProviderRefs.has(page.provider_page_ref));
    for (const page of missingOpen) {
      page.present = false;
      if (confirmedClosedProviderRefs.has(page.provider_page_ref)) {
        page.closed = true;
        page.closed_at ??= Date.now();
      }
    }
    if (unconfirmedMissing.length > 0) {
      throw new PageNavigationError("page_relation_unavailable", "The Provider Page list omitted an open Page without a close confirmation.");
    }
    for (const state of states) {
      const previous = this.byProvider.get(state.provider_page_ref);
      if (state.status === "closed") {
        const page = previous ?? {
          page_id: opaqueRef("page_object"), provider_page_ref: state.provider_page_ref, provider_state: state,
          document_generation: Math.max(1, state.document_generation ?? 1), page_ref: opaqueRef("page"),
          closed: true, present: false, last_used_at: Date.now(), closed_at: Date.now()
        } satisfies PageRecord;
        page.provider_state = state;
        page.closed = true;
        page.present = false;
        page.closed_at ??= Date.now();
        this.byProvider.set(state.provider_page_ref, page);
        this.byId.set(page.page_id, page);
        continue;
      }
      // An omitted Provider Page is considered lost, not closed. If a later
      // Provider event reuses that private handle, allocate a new public Page
      // identity instead of reviving the old object.
      const existing = previous?.present && !previous.closed ? previous : undefined;
      const providerGeneration = state.document_generation ?? existing?.document_generation ?? 1;
      const generation = existing ? Math.max(existing.document_generation, providerGeneration) : Math.max(1, providerGeneration);
      const changed = Boolean(existing && (
        (existing.provider_state.current_url !== state.current_url && state.current_url) ||
        providerGeneration > existing.document_generation
      ));
      const page = existing ?? {
        page_id: opaqueRef("page_object"), provider_page_ref: state.provider_page_ref, provider_state: state,
        document_generation: generation, page_ref: opaqueRef("page"), closed: false, present: true, last_used_at: Date.now()
      } satisfies PageRecord;
      if (changed) {
        page.document_generation = Math.max(page.document_generation + 1, state.document_generation ?? 0);
        page.page_ref = opaqueRef("page");
      }
      page.provider_state = state;
      page.closed = false;
      page.present = true;
      page.closed_at = undefined;
      const opener = state.opener_provider_page_ref ? this.byProvider.get(state.opener_provider_page_ref) : undefined;
      page.opener_page_id = opener && !opener.closed && opener.present ? opener.page_id : undefined;
      this.byProvider.set(state.provider_page_ref, page);
      this.byId.set(page.page_id, page);
      if (state.active || state.task_selected === true) {
        this.lastUsed = [page.page_id, ...this.lastUsed.filter(id => id !== page.page_id)].slice(0, MAX_PAGE_OBJECTS);
      }
      if (state.active) {
        this.activePageId = page.page_id;
      }
      if (state.task_selected === true) this.taskPageId = page.page_id;
    }
    this.activePageId = active.length === 1 ? this.byProvider.get(active[0]!.provider_page_ref)?.page_id ?? null : null;
    // A valid list that omits an existing object does not prove that the
    // object was explicitly closed. Hide it from current public facts and
    // reject its old binding, but retain the distinction for diagnostics and
    // future identity allocation.
    this.pruneUnavailableRecords();
    if (this.taskPageId && !this.byId.get(this.taskPageId)?.present) this.taskPageId = null;
    if (!this.taskPageId && active.length === 1) {
      this.taskPageId = this.byProvider.get(active[0]!.provider_page_ref)?.page_id ?? null;
    }
    this.relationFresh = true;
  }

  private pruneUnavailableRecords(): void {
    for (const [pageId, page] of this.byId) {
      if (page.closed || page.present) continue;
      this.byId.delete(pageId);
      if (this.byProvider.get(page.provider_page_ref) === page) this.byProvider.delete(page.provider_page_ref);
    }
    const tombstones = [...this.byId.values()]
      .filter(page => page.closed)
      .sort((left, right) => (left.closed_at ?? left.last_used_at) - (right.closed_at ?? right.last_used_at));
    for (const page of tombstones.slice(0, Math.max(0, tombstones.length - MAX_PAGE_TOMBSTONES))) {
      this.byId.delete(page.page_id);
      if (this.byProvider.get(page.provider_page_ref) === page) this.byProvider.delete(page.provider_page_ref);
    }
    this.lastUsed = this.lastUsed.filter(pageId => this.byId.has(pageId));
    if (this.activePageId && !this.byId.has(this.activePageId)) this.activePageId = null;
    if (this.taskPageId && !this.byId.has(this.taskPageId)) this.taskPageId = null;
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
    record.present = true;
    if (state.task_selected === true) this.taskPageId = record.page_id;
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
      page_ref: record.page_ref, document_generation: record.document_generation, origin,
      ...(typeof page.active === "boolean" ? { active: page.active } : {}),
      ...(record.opener_page_id ? { opener_page_id: record.opener_page_id } : {})
    };
  }

  private unavailable(failure_class: ManagedPageUnavailableClass, message: string, retryable: boolean, input: ManagedPageOperationInput, record?: PageRecord, dispatch_state: "not_dispatched" | "dispatched" = "not_dispatched"): ManagedPageUnavailable {
    return {
      status: "unavailable", schema_version: HARBOR_PAGE_NAVIGATION_SCHEMA, failure_class,
      message: publicPageMessage(message), retryable, dispatch_state,
      runtime_session_ref: this.runtimeSessionRef, ...(record ? { page_id: record.page_id, page_ref: record.page_ref, document_generation: record.document_generation } : {}),
      ...(input.operation_ref ? { operation_ref: input.operation_ref } : {})
    };
  }

  private receiptFromResult(
    input: ManagedPageOperationInput,
    status: "completed" | "unknown_outcome" | undefined,
    dispatch_state: "not_dispatched" | "dispatched",
    result?: ManagedPageFacts | ManagedPageUnavailable,
    message?: string
  ): ManagedPageOperationReceipt {
    const unavailable = result && "failure_class" in result ? result : undefined;
    const completed = result && !("failure_class" in result) ? result : undefined;
    const finalStatus = status ?? (dispatch_state === "dispatched" ? "unknown_outcome" : "unavailable");
    return {
      status: finalStatus,
      schema_version: HARBOR_PAGE_NAVIGATION_SCHEMA,
      dispatch_state,
      operation_ref: input.operation_ref ?? opaqueRef("page_operation"),
      runtime_session_ref: this.runtimeSessionRef,
      observed_at: new Date().toISOString(),
      ...(completed ? { page: completed } : {}),
      ...(unavailable?.failure_class ? { failure_class: unavailable.failure_class } : {}),
      ...(unavailable?.message || message ? { message: (unavailable?.message ?? message)!.slice(0, 256) } : {}),
      ...(unavailable ? { retryable: unavailable.retryable } : {})
    };
  }

  private receiptUnavailable(
    input: ManagedPageOperationInput,
    failure_class: ManagedPageUnavailableClass,
    message: string,
    retryable: boolean,
    dispatch_state: "not_dispatched" | "dispatched"
  ): ManagedPageOperationReceipt {
    return this.receiptFromResult(input, undefined, dispatch_state,
      this.unavailable(failure_class, message, retryable, input, undefined, dispatch_state), message);
  }

  private relationFresh = true;
}

const PAGE_PROVIDER_FAILURES: ManagedPageUnavailableClass[] = [
  "navigation_origin_denied", "navigation_beforeunload_blocked", "stale_page", "page_not_found", "page_capacity_exceeded", "page_relation_unavailable", "provider_unavailable"
];

export class PageNavigationError extends Error {
  constructor(readonly failure_class: ManagedPageUnavailableClass, message: string, readonly dispatch_state?: "not_dispatched" | "dispatched") { super(message); }
}

export function pageNavigationFailureClass(error: unknown): ManagedPageUnavailableClass {
  if (error instanceof PageNavigationError) return error.failure_class;
  const message = safeMessage(error);
  return PAGE_PROVIDER_FAILURES.find(value => message.includes(value)) ??
    (/(?:native selected-window|page (?:mapping|relation|freshness)|selected Page)/i.test(message) ? "page_relation_unavailable" : "provider_unavailable");
}

function asPageNavigationError(error: unknown): PageNavigationError {
  return error instanceof PageNavigationError ? error : new PageNavigationError(pageNavigationFailureClass(error), safeMessage(error));
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

function publicPageMessage(message: string): string {
  return message.slice(0, 256)
    .replace(/[?&#][^ ]*/g, "")
    .replace(/\bprovider(?:[_ -]?page)?(?:[_ -]?ref)?\s*[:=]\s*[A-Za-z0-9:._/-]+/gi, "[redacted]")
    .replace(/\bprovider_page_[A-Za-z0-9:._/-]+\b/gi, "[redacted]");
}

function receiptToUnavailable(receipt: ManagedPageOperationReceipt): ManagedPageUnavailable {
  return {
    status: "unavailable",
    schema_version: HARBOR_PAGE_NAVIGATION_SCHEMA,
    failure_class: receipt.failure_class ?? "unknown_outcome",
    message: receipt.message ?? "Page operation is unavailable.",
    retryable: receipt.retryable ?? receipt.status !== "completed",
    dispatch_state: receipt.dispatch_state,
    runtime_session_ref: receipt.runtime_session_ref,
    operation_ref: receipt.operation_ref,
    ...(receipt.page ? { page_id: receipt.page.page_id, page_ref: receipt.page.page_ref, document_generation: receipt.page.document_generation } : {})
  };
}
