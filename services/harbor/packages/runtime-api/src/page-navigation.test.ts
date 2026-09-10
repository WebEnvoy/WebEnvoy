import assert from "node:assert/strict";
import test from "node:test";
import { PageRegistry, type ManagedPageFacts } from "./page-navigation.js";
import type { LocalProviderPageController, LocalProviderPageState } from "./runtime-session-types.js";

function controller(initial: LocalProviderPageState[]): LocalProviderPageController {
  let pages = structuredClone(initial);
  return {
    listPages: async () => structuredClone(pages),
    openPage: async (url = "about:blank") => {
      const page = { provider_page_ref: `provider:${pages.length + 1}`, current_url: url, title: "new", status: "ready" as const, facts: [], active: false, document_generation: 1 };
      pages = [...pages, page];
      return structuredClone(page);
    },
    activatePage: async (ref) => {
      pages = pages.map(page => ({ ...page, active: page.provider_page_ref === ref }));
      return structuredClone(pages.find(page => page.provider_page_ref === ref)!);
    },
    closePage: async (ref) => {
      pages = pages.filter(page => page.provider_page_ref !== ref);
      return structuredClone(pages);
    },
    navigatePage: async (ref, _action, url) => {
      pages = pages.map(page => page.provider_page_ref === ref ? { ...page, current_url: url ?? page.current_url, document_generation: (page.document_generation ?? 1) + 1 } : page);
      return structuredClone(pages.find(page => page.provider_page_ref === ref)!);
    }
  };
}

const page = (provider_page_ref: string, current_url: string, active = false, opener_provider_page_ref?: string): LocalProviderPageState => ({
  provider_page_ref, current_url, title: provider_page_ref, status: "ready", facts: [], active, ...(opener_provider_page_ref ? { opener_provider_page_ref } : {})
});

test("PageRegistry keeps stable page_id, rotates document page_ref, preserves popup opener and filters origins", async () => {
  const registry = new PageRegistry("session:test", controller([
    page("provider:one", "https://s1.example/start", true),
    page("provider:two", "https://s2.example/popup", false, "provider:one"),
    page("provider:three", "https://s3.example/secret", false)
  ]));
  await registry.refresh();
  const first = registry.list(["https://s1.example", "https://s2.example"]);
  assert.equal(first.pages.length, 2);
  assert.equal(first.filtered_page_count, 1);
  const one = first.pages.find(item => item.current_url?.startsWith("https://s1"))!;
  const popup = first.pages.find(item => item.current_url?.startsWith("https://s2"))!;
  assert.equal(popup.opener_page_id, one.page_id);
  assert.equal(popup.active, false);
  const navigated = await registry.operate({ operation: "page.navigate", page_id: one.page_id, page_ref: one.page_ref, url: "https://s1.example/next?token=hidden#fragment", authorized_origins: ["https://s1.example"], operation_ref: "run:navigate" });
  assert.equal("failure_class" in navigated, false);
  assert.equal((navigated as ManagedPageFacts).page_id, one.page_id);
  assert.notEqual((navigated as ManagedPageFacts).page_ref, one.page_ref);
  assert.equal((navigated as ManagedPageFacts).current_url, "https://s1.example/next");
});

test("PageRegistry refuses closing the last active Page and returns to a safe Page when possible", async () => {
  const registry = new PageRegistry("session:test", controller([
    page("provider:one", "https://s1.example", true),
    page("provider:two", "https://s2.example", false)
  ]));
  await registry.refresh();
  const pages = registry.list(["https://s1.example", "https://s2.example"]).pages;
  const active = pages.find(item => item.active)!;
  const result = await registry.operate({ operation: "page.close", page_id: active.page_id, page_ref: active.page_ref, authorized_origins: ["https://s1.example", "https://s2.example"], operation_ref: "run:close" });
  assert.equal("failure_class" in result, false);
  assert.equal((result as ManagedPageFacts).active, true);
  const secondRegistry = new PageRegistry("session:test", controller([page("provider:one", "https://s1.example", true)]));
  await secondRegistry.refresh();
  const last = secondRegistry.list(["https://s1.example"]).pages[0]!;
  const refused = await secondRegistry.operate({ operation: "page.close", page_id: last.page_id, page_ref: last.page_ref, authorized_origins: ["https://s1.example"] });
  assert.equal("failure_class" in refused && refused.failure_class, "no_safe_return_page");
});

test("closing a background Page returns the unchanged active Page", async () => {
  const registry = new PageRegistry("session:test", controller([
    page("provider:one", "https://s1.example", true),
    page("provider:two", "https://s2.example", false)
  ]));
  await registry.refresh();
  const pages = registry.list(["https://s1.example", "https://s2.example"]).pages;
  const background = pages.find(item => !item.active)!;
  const active = pages.find(item => item.active)!;
  const result = await registry.operate({ operation: "page.close", page_id: background.page_id, page_ref: background.page_ref, authorized_origins: ["https://s1.example", "https://s2.example"] });
  assert.equal("failure_class" in result, false);
  assert.equal((result as ManagedPageFacts).page_id, active.page_id);
  assert.equal((result as ManagedPageFacts).active, true);
});

test("closing an authorized background Page does not project an unauthorized active Page", async () => {
  const registry = new PageRegistry("session:test", controller([
    page("provider:one", "https://s1.example", true),
    page("provider:two", "https://s2.example", false)
  ]));
  await registry.refresh();
  const pages = registry.list(["https://s1.example", "https://s2.example"]).pages;
  const background = pages.find(item => !item.active)!;
  const result = await registry.operate({
    operation: "page.close", page_id: background.page_id, page_ref: background.page_ref,
    authorized_origins: ["https://s2.example"]
  });
  assert.equal("failure_class" in result && result.failure_class, "page_not_found");
  assert.equal(JSON.stringify(result).includes("s1.example"), false);
  const remaining = registry.list(["https://s1.example", "https://s2.example"]);
  assert.equal(remaining.pages.some(item => item.current_url?.startsWith("https://s1.example") && item.active), true);
});

test("PageRegistry rotates the document binding for same-URL reloads and rejects the old ref", async () => {
  const registry = new PageRegistry("session:test", controller([page("provider:one", "https://s1.example/detail", true)]));
  await registry.refresh();
  const before = registry.list(["https://s1.example"]).pages[0]!;
  const reloaded = await registry.operate({
    operation: "page.reload", page_id: before.page_id, page_ref: before.page_ref,
    document_generation: before.document_generation, authorized_origins: ["https://s1.example"]
  });
  assert.equal("failure_class" in reloaded, false);
  assert.equal((reloaded as ManagedPageFacts).page_id, before.page_id);
  assert.notEqual((reloaded as ManagedPageFacts).page_ref, before.page_ref);
  assert.equal((reloaded as ManagedPageFacts).document_generation, before.document_generation + 1);
  const stale = await registry.operate({
    operation: "page.navigate", page_id: before.page_id, page_ref: before.page_ref,
    url: "https://s1.example/other", authorized_origins: ["https://s1.example"]
  });
  assert.equal("failure_class" in stale && stale.failure_class, "stale_page");
});

test("PageRegistry rejects ambiguous targets, unauthorized opens, and idempotency conflicts", async () => {
  const registry = new PageRegistry("session:test", controller([
    page("provider:one", "https://s1.example", true),
    page("provider:two", "https://s2.example", false)
  ]));
  await registry.refresh();
  const ambiguous = await registry.operate({ operation: "page.navigate", url: "https://s1.example/other", authorized_origins: ["https://s1.example", "https://s2.example"] });
  assert.equal("failure_class" in ambiguous && ambiguous.failure_class, "page_selection_required");
  const denied = await registry.operate({ operation: "page.open", url: "https://s3.example/secret", authorized_origins: ["https://s1.example", "https://s2.example"] });
  assert.equal("failure_class" in denied && denied.failure_class, "navigation_origin_denied");
  const opened = await registry.operate({ operation: "page.open", url: "https://s2.example/detail?topic=fixture#section", authorized_origins: ["https://s1.example", "https://s2.example"] });
  assert.equal("failure_class" in opened, false);
  assert.equal((opened as ManagedPageFacts).active, false);
  assert.equal((opened as ManagedPageFacts).current_url, "https://s2.example/detail");
  const first = await registry.operate({ operation: "page.navigate", page_id: (opened as ManagedPageFacts).page_id, page_ref: (opened as ManagedPageFacts).page_ref, url: "https://s2.example/one", authorized_origins: ["https://s1.example", "https://s2.example"], operation_ref: "run:page-navigation" });
  const replay = await registry.operate({ operation: "page.navigate", page_id: (opened as ManagedPageFacts).page_id, page_ref: (opened as ManagedPageFacts).page_ref, url: "https://s2.example/one", authorized_origins: ["https://s1.example", "https://s2.example"], operation_ref: "run:page-navigation" });
  assert.deepEqual(replay, first);
  const conflict = await registry.operate({ operation: "page.navigate", page_id: (opened as ManagedPageFacts).page_id, page_ref: (opened as ManagedPageFacts).page_ref, url: "https://s2.example/two", authorized_origins: ["https://s1.example", "https://s2.example"], operation_ref: "run:page-navigation" });
  assert.equal("failure_class" in conflict && conflict.failure_class, "unknown_outcome");
});

test("PageRegistry removes an opener reference when the Provider can no longer confirm it", async () => {
  let states = [
    page("provider:one", "https://s1.example", true),
    page("provider:popup", "https://s2.example/popup", false, "provider:one")
  ];
  const pageController: LocalProviderPageController = {
    listPages: async () => structuredClone(states),
    openPage: async () => structuredClone(states[1]!),
    activatePage: async ref => structuredClone(states.find(item => item.provider_page_ref === ref)!),
    closePage: async ref => { states = states.filter(item => item.provider_page_ref !== ref); return structuredClone(states); },
    navigatePage: async ref => structuredClone(states.find(item => item.provider_page_ref === ref)!)
  };
  const registry = new PageRegistry("session:test", pageController);
  await registry.refresh();
  const popup = registry.list(["https://s1.example", "https://s2.example"]).pages.find(item => item.current_url?.includes("popup"))!;
  assert.equal(typeof popup.opener_page_id, "string");
  states = states.map(item => item.provider_page_ref === "provider:popup" ? { ...item, opener_provider_page_ref: undefined } : item);
  await registry.refresh();
  const refreshed = registry.list(["https://s1.example", "https://s2.example"]).pages.find(item => item.page_id === popup.page_id)!;
  assert.equal(refreshed.opener_page_id, undefined);
});
