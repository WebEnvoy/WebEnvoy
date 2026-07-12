# CORE-270 Consistency Analysis

- Core owns task intent, admission, durable Run Record and outcome; Harbor owns session, page, operation and evidence facts; Lode owns capability truth.
- App/callers may select only an opaque Core-projected ref and cannot construct target URLs or identifiers.
- A detail ref is bound to one real search run/site/identity/session and is fresh/single-use.
- Missing, stale, replayed, cross-bound or malformed facts fail closed before or after dispatch according to outcome certainty.
- BOSS production admission remains disabled and no BOSS capability is restored.
