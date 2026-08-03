import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveIdentityEnvironmentLaunchConfiguration,
  validateIdentityEnvironmentConfiguration
} from "./identity-environment-configuration.js";
import { createLocalIdentityEnvironmentFacts } from "./identity-environment.js";
import { identityInput } from "./identity-environment-mutation-test-helpers.js";

function identityWithViewport(viewport: string) {
  return createLocalIdentityEnvironmentFacts({
    ...identityInput(`identity-${viewport}`, `profile-${viewport}`),
    viewport
  });
}

test("treats the legacy system-default viewport as an unset launch preference", () => {
  const facts = identityWithViewport("系统默认");
  const resolved = resolveIdentityEnvironmentLaunchConfiguration(facts, undefined);

  assert.notEqual(resolved, null);
  assert.equal(resolved?.viewport, null);
  assert.equal(
    validateIdentityEnvironmentConfiguration({ viewport: "系统默认" }, facts, {}),
    "unsupported_configuration",
    "new mutation input must not reintroduce the legacy display sentinel"
  );
});

test("keeps explicit viewport launch validation strict", () => {
  assert.deepEqual(
    resolveIdentityEnvironmentLaunchConfiguration(identityWithViewport("1440x900"), undefined)?.viewport,
    { width: 1440, height: 900 }
  );
  for (const viewport of [
    "",
    " ",
    "automatic",
    "系统默认 ",
    "199x900",
    "16385x900",
    "900x199",
    "900x16385"
  ]) {
    assert.equal(
      resolveIdentityEnvironmentLaunchConfiguration(identityWithViewport(viewport), undefined),
      null,
      `expected ${JSON.stringify(viewport)} to remain unsupported`
    );
  }
});
