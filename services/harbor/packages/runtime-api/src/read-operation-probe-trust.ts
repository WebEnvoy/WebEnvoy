import type {
  LocalProviderReadProbeInput,
  LocalProviderReadProbeResult,
  LocalProviderSiteResourceProbeInput,
  LocalProviderSiteResourceProbeResult
} from "./runtime-session-types.js";

export type ReadOperationProbe = (input: LocalProviderReadProbeInput) => Promise<LocalProviderReadProbeResult>;
export type SiteResourceProbe = (input: LocalProviderSiteResourceProbeInput) => Promise<LocalProviderSiteResourceProbeResult>;

// Only Harbor's concrete local-provider adapter may register a probe that can
// produce an operation completion. Test and fixture launchers remain fail-closed.
const trustedReadOperationProbes = new WeakSet<ReadOperationProbe>();
const trustedSiteResourceProbes = new WeakSet<SiteResourceProbe>();

export function trustLocalProviderReadProbe(probe: ReadOperationProbe): ReadOperationProbe {
  trustedReadOperationProbes.add(probe);
  return probe;
}

export function isTrustedLocalProviderReadProbe(probe: ReadOperationProbe | undefined): probe is ReadOperationProbe {
  return probe !== undefined && trustedReadOperationProbes.has(probe);
}

export function trustLocalProviderSiteResourceProbe(probe: SiteResourceProbe): SiteResourceProbe {
  trustedSiteResourceProbes.add(probe);
  return probe;
}

export function isTrustedLocalProviderSiteResourceProbe(probe: SiteResourceProbe | undefined): probe is SiteResourceProbe {
  return probe !== undefined && trustedSiteResourceProbes.has(probe);
}
