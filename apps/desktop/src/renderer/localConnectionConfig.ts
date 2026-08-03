export type LocalConnectionConfig = {
  coreEndpoint: string;
  harborEndpoint: string;
  lodeEndpoint: string;
};

export type LocalConnectionConfigValidation =
  | { ok: true; config: LocalConnectionConfig }
  | { ok: false; errors: Partial<Record<keyof LocalConnectionConfig, string>> };

export const localConnectionStorageKey = "webenvoy.localConnectionConfig.v1";

export const defaultConnectionConfig: LocalConnectionConfig = {
  coreEndpoint: "http://127.0.0.1:8787",
  harborEndpoint: "http://127.0.0.1:8788",
  lodeEndpoint: "http://127.0.0.1:8789",
};

const endpointFields = ["coreEndpoint", "harborEndpoint", "lodeEndpoint"] as const;
const maxEndpointLength = 2048;
const sensitiveEndpointPattern =
  /\b(token|cookie|secret|bearer|profile|credential|password|authorization)\b|raw[\s_-]*evidence/i;

export function loadLocalConnectionConfig(): LocalConnectionConfig {
  const storedConfig = window.localStorage.getItem(localConnectionStorageKey);

  if (!storedConfig) {
    return defaultConnectionConfig;
  }

  try {
    const validation = validateLocalConnectionConfig({
      ...defaultConnectionConfig,
      ...JSON.parse(storedConfig),
    });

    return validation.ok ? validation.config : defaultConnectionConfig;
  } catch {
    return defaultConnectionConfig;
  }
}

export function saveLocalConnectionConfig(
  config: LocalConnectionConfig,
): LocalConnectionConfigValidation {
  const validation = validateLocalConnectionConfig(config);

  if (validation.ok) {
    window.localStorage.setItem(localConnectionStorageKey, JSON.stringify(validation.config));
  }

  return validation;
}

export function validateLocalConnectionConfig(
  config: LocalConnectionConfig,
): LocalConnectionConfigValidation {
  const sanitizedConfig = { ...defaultConnectionConfig };
  const errors: Partial<Record<keyof LocalConnectionConfig, string>> = {};

  for (const field of endpointFields) {
    const endpoint = normalizeConnectionEndpoint(config[field]);

    if ("error" in endpoint) {
      errors[field] = endpoint.error;
    } else {
      sanitizedConfig[field] = endpoint.value;
    }
  }

  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, config: sanitizedConfig };
}

export function normalizeConnectionEndpoint(
  value: string,
): { value: string; error?: undefined } | { value?: undefined; error: string } {
  const input = value.trim();

  if (!input) {
    return { error: "Endpoint is required." };
  }

  if (input.length > maxEndpointLength) {
    return { error: "Endpoint is too long." };
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(input);
  } catch {
    return { error: "Endpoint must be a valid URL." };
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return { error: "Endpoint must use http or https." };
  }

  if (parsedUrl.username || parsedUrl.password) {
    return { error: "Endpoint cannot include username or password." };
  }

  if (parsedUrl.search || parsedUrl.hash) {
    return { error: "Endpoint must be an origin or base URL without query/hash." };
  }

  if (sensitiveEndpointPattern.test(decodeEndpoint(input))) {
    return {
      error: "Endpoint cannot include token, cookie, secret, bearer, profile, or evidence fragments.",
    };
  }

  const pathname = parsedUrl.pathname.replace(/\/+$/, "");

  return { value: `${parsedUrl.origin}${pathname === "" ? "" : pathname}` };
}

function decodeEndpoint(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
