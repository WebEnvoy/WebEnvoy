import assert from "node:assert/strict";

import { createApiServer } from "./server.js";

async function getJson(port: number, path: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  return {
    status: response.status,
    body: await response.json()
  };
}

async function main(): Promise<void> {
  const server = createApiServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();
  assert(address && typeof address === "object");
  const port = address.port;

  try {
    assert.deepEqual(await getJson(port, "/health"), {
      status: 200,
      body: {
        service: "webenvoy-api-server",
        status: "ok"
      }
    });

    assert.deepEqual(await getJson(port, "/readiness"), {
      status: 200,
      body: {
        service: "webenvoy-api-server",
        status: "ready",
        checks: {
          apiServer: "ok"
        }
      }
    });

    assert.deepEqual(await getJson(port, "/missing"), {
      status: 404,
      body: {
        error: {
          code: "not_found",
          message: "Route not found"
        }
      }
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

await main();

