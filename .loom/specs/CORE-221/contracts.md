# CORE-221 Contracts

## Harbor Input Contract

Core accepts only public Harbor facts:

- `harbor-local-identity-environment/v0` identity refs, login state, storage state, provider binding, and consumer boundary.
- `harbor-browser-provider-status/v0` provider install/launchability status.
- `harbor-core-runtime-facts/v0` runtime/session/provider/profile/viewer/control refs and status.
- `harbor-page-scene-refs/v0` snapshot/refmap/source/evidence refs.
- `harbor-core-resource-facts/v0` readiness fact keys with available/unavailable state.

Private browser material is rejected before persistence.

## Lode Input Contract

Core accepts package identity and resource declarations:

- package ref/source ref/lock ref/capability id/version/lifecycle.
- resource requirement id/version/profiles and `required_harbor_facts`.
- read and validate-only/write-preview boundaries only.

Core does not copy package implementation, fixture body, normalizer code, or source site adapter code.

## Run Record Contract

Run Records may store:

- task/capability/package refs.
- runtime binding refs and `runtime_session_binding` public refs/status.
- evidence refs and result refs.
- failure categories/codes/recovery hints.

Run Records must not store cookies, tokens, credentials, profile storage, raw DOM/HAR/network bodies, screenshot/video bodies, CDP/VNC/websocket endpoints, viewer URLs, provider private objects, production payloads, or user business data.
