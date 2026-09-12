import { createServer } from "node:http";

const HOST = "127.0.0.1";
const SERVICES = ["S1", "S2", "S3"];
const DELAYED_RESPONSE_MS = 3_000;
const ports = new Map();
const servers = [];
const counters = new Map(SERVICES.map(service => [service, {
  access_count: 0,
  action_count: 0,
  popup_count: 0,
  path_counts: Object.create(null)
}]));

function json(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "null"
  });
  response.end(JSON.stringify(value));
}

function html(response, body) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
  });
  response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${body.title}</title></head><body><main><h1>${body.heading}</h1>${body.content}</main><script>${body.script}</script></body></html>`);
}

function pageBody(service, path) {
  const lower = service.toLowerCase();
  const other = SERVICES.filter(item => item !== service);
  const popupService = service === "S1" ? "S2" : "S1";
  const popupUrl = `http://${HOST}:${ports.get(popupService)}/popup?from=${lower}`;
  const links = other.map(item => `<a href="http://${HOST}:${ports.get(item)}/from-${lower}/${item.toLowerCase()}">${item} direct</a>`).join(" ");
  const title = path.startsWith("/same-name/") ? "Same-name Page" : `${service} Phase 1 Page`;
  const marker = `${lower}-${path.replaceAll("/", "-").replace(/^-|-$/g, "") || "root"}`;
  return {
    title,
    heading: `${service} · ${path}`,
    content: `
      <p id="service-label" data-service="${service}">service=${service}; page-marker=${marker}</p>
      <p id="network-marker">network=${lower}-network</p>
      <p id="console-marker">console=${lower}-console</p>
      <label for="safe-input">Safe input</label>
      <input id="safe-input" name="safe_input" type="text" autocomplete="off" aria-label="Safe input">
      <p id="storage-marker">storage-marker=</p>
      <button id="count-button" type="button">Count action</button>
      <output id="count-result" aria-live="polite"></output>
      <button id="popup-button" type="button">Open popup</button>
      <nav aria-label="phase-1 routes">
        <a href="/${lower}-query?value=phase1#${lower}-fragment">Query and fragment</a>
        <a href="/history?step=one#${lower}-history">History page</a>
        <a href="/same-name/a">Same-name A</a>
        <a href="/same-name/b">Same-name B</a>
        <a href="/same-origin-redirect">Same-origin redirect</a>
        ${service === "S1" ? '<a href="/redirect/s2">S1 to S2 redirect</a> <a href="/redirect/s3">S1 to S3 redirect</a>' : ""}
        ${links}
      </nav>
      <p><a id="history-link" href="/history?step=link#${lower}-link">History link</a></p>`,
    script: `
      console.info("phase1-${lower}-console");
      const storageKey = "phase1-safe-input";
      const safeStoredValue = value => value === "safe-input" ? value : "";
      const safeInput = document.querySelector("#safe-input");
      const storageMarker = document.querySelector("#storage-marker");
      let storedValue = "";
      try { storedValue = safeStoredValue(localStorage.getItem(storageKey)); } catch {}
      safeInput.value = storedValue;
      const updateStorageMarker = value => {
        const nextValue = safeStoredValue(value);
        try {
          if (nextValue) localStorage.setItem(storageKey, nextValue);
          else localStorage.removeItem(storageKey);
        } catch {}
        storageMarker.textContent = "storage-marker=" + nextValue;
      };
      updateStorageMarker(storedValue);
      safeInput.addEventListener("input", event => updateStorageMarker(event.currentTarget.value));
      const updatePageTitle = () => {
        const queryPhase1 = ${service === "S2"} && location.pathname === "/query" && new URLSearchParams(location.search).get("phase") === "1";
        const fragmentS2 = ${service === "S2"} && location.pathname === "/query" && location.hash === "#s2-fragment";
        if (queryPhase1 && fragmentS2) {
          document.title = "S2 Phase 1 Page marker-q1-f1";
        } else if (location.pathname === "/history") {
          document.title = "${service} Phase 1 History";
        } else {
          document.title = ${JSON.stringify(title)};
        }
      };
      updatePageTitle();
      fetch("/__phase1/network/${lower}", { cache: "no-store" }).catch(() => {});
      document.querySelector("#count-button").addEventListener("click", async () => {
        const value = document.querySelector("#safe-input").value;
        const response = await fetch("/__phase1/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "count", value }) });
        const result = await response.json();
        document.querySelector("#count-result").textContent = "action-count=" + result.action_count;
      });
      document.querySelector("#popup-button").addEventListener("click", async () => {
        await fetch("/__phase1/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "popup" }) });
        window.open(${JSON.stringify(popupUrl)}, "phase1-popup");
      });
      document.querySelector("#history-link").addEventListener("click", event => { event.preventDefault(); history.pushState({ phase1: true }, "", "/history?step=link#${lower}-link"); });
      window.addEventListener("popstate", updatePageTitle);
      window.addEventListener("hashchange", updatePageTitle);`
  };
}

function recordAccess(service, pathname) {
  const state = counters.get(service);
  if (!state) return;
  state.access_count += 1;
  state.path_counts[pathname] = (state.path_counts[pathname] ?? 0) + 1;
}

async function requestBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body;
}

function safeAction(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!["count", "popup"].includes(value.action)) return null;
  if (value.value !== undefined && (typeof value.value !== "string" || value.value.length > 128 || /(?:password|token|cookie|secret|credential|authorization)/i.test(value.value))) return null;
  return value;
}

function createService(service) {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${HOST}`);
    if (url.pathname === "/__phase1/status" && request.method === "GET") {
      const state = counters.get(service);
      json(response, 200, {
        schema_version: "webenvoy.phase1-pages-status/v1",
        service,
        host: HOST,
        port: ports.get(service),
        access_count: state.access_count,
        action_count: state.action_count,
        popup_count: state.popup_count,
        path_counts: { ...state.path_counts }
      });
      return;
    }
    recordAccess(service, url.pathname);
    if (request.method === "GET" && url.pathname === "/delayed-response") {
      await new Promise(resolve => setTimeout(resolve, DELAYED_RESPONSE_MS));
      html(response, pageBody(service, url.pathname));
      return;
    }
    if (url.pathname === "/__phase1/network/" + service.toLowerCase() && request.method === "GET") {
      json(response, 200, { schema_version: "webenvoy.phase1-network/v1", service, marker: `${service.toLowerCase()}-network` });
      return;
    }
    if (url.pathname === "/__phase1/action" && request.method === "POST") {
      let action;
      try { action = safeAction(JSON.parse(await requestBody(request) || "null")); } catch { action = null; }
      if (!action) {
        json(response, 400, { status: "invalid_request" });
        return;
      }
      const state = counters.get(service);
      state.action_count += 1;
      if (action.action === "popup") state.popup_count += 1;
      json(response, 200, { status: "completed", action: action.action, action_count: state.action_count });
      return;
    }
    if (service === "S1" && request.method === "GET" && url.pathname === "/redirect/s2") {
      response.writeHead(302, { location: `http://${HOST}:${ports.get("S2")}/from-s1/s2` });
      response.end();
      return;
    }
    if (service === "S1" && request.method === "GET" && url.pathname === "/redirect/s3") {
      response.writeHead(302, { location: `http://${HOST}:${ports.get("S3")}/from-s1/s3` });
      response.end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/popup") {
      counters.get(service).popup_count += 1;
      html(response, pageBody(service, "/popup"));
      return;
    }
    if (request.method === "GET" && url.pathname === "/same-origin-redirect") {
      response.writeHead(302, { location: `/same-name/${service === "S1" ? "a" : "b"}?redirected=1#same-origin` });
      response.end();
      return;
    }
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/history" || url.pathname.startsWith("/same-name/") || url.pathname.startsWith("/from-") || url.pathname.startsWith("/s1-to-"))) {
      html(response, pageBody(service, url.pathname));
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/")) {
      html(response, pageBody(service, url.pathname));
      return;
    }
    json(response, 404, { status: "not_found" });
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, () => {
      server.removeListener("error", reject);
      resolve(server.address().port);
    });
  });
}

async function shutdown() {
  await Promise.all(servers.map(server => new Promise(resolve => server.close(() => resolve()))));
  process.exit(0);
}

for (const service of SERVICES) {
  const server = createService(service);
  servers.push(server);
  ports.set(service, await listen(server));
}

console.log(JSON.stringify({
  schema_version: "webenvoy.phase1-pages-server/v1",
  host: HOST,
  servers: Object.fromEntries(SERVICES.map(service => [service, { port: ports.get(service), base_url: `http://${HOST}:${ports.get(service)}` }]))
}));
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
