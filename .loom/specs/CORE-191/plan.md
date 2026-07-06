# Plan

## Steps

1. Extend Harbor admission input to require identity environment public facts alongside runtime session facts.
2. Persist a refs-only runtime session binding summary in Run Record admission and query projection.
3. Reject raw/private Harbor material before Run Record persistence.
4. Add schema fixture and runtime self-checks for accepted identity/session binding, auth-required identity, busy session, and raw endpoint rejection.
5. Validate Core runtime, schemas, conformance, typecheck, diff check, and Loom suite/carrier/evidence gates.
