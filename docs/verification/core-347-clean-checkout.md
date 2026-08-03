# Core #347 clean-checkout, provenance and rollback evidence

This record is the local, no-release evidence for Work Item #347. It binds the
Desktop artifact to one monorepo commit, keeps Lode as an independently pinned
clean checkout, and records a recoverable pre-switch replay. The machine-readable
record is [`core-347-release-artifact-provenance-v1.json`](core-347-release-artifact-provenance-v1.json).

## Current clean checkout

- Monorepo: `WebEnvoy/WebEnvoy@39a6454ed55fe04873153c2fb3466d47784b3200`, tree `4e06acaaad7792ecf9dcc6a59f68c14c71c11af1`.
- Packaged paths: Core `packages/api-server` (tree `f6760ff173d54ffebfe51599db58839b0dec69ae`), App `apps/desktop` (tree `8e0a9302d526419c01437fc1453205af18fa8c62`), Harbor `services/harbor` (tree `4ea37e3123c63c98289e32467e35368d48ae0609`).
- Lode: `WebEnvoy/Lode@1fbef74b4bf1b4f0a86aacd885386d7a62181207`, tree `cda20d44a8a8b48f6ba13c598325a95d50eff962`, raw `registry` + `sites` archive SHA-256 `419eaa0fd7792edc9090e47fe45a342c9b459bdb8bf9ca02a90e8bbd019a9a4a`; the checkout was clean and independent of the dirty source checkout.
- Toolchain: Node `v24.16.0`, pnpm `10.30.3`, Corepack `0.34.6`; `pnpm-lock.yaml` SHA-256 `71a2dc3525d29cd04cb721c9cefb04fc29432be2586a959519109010e6a2d456`.

The artifact content manifest covers 703 files under `apps/desktop/dist-electron/`:
relative-file-list SHA-256 `0f0d334389a11b03709ea0b7bf452c403c7be5805932c6a24fcea405614f2874`,
content-manifest SHA-256 `e5273bd7326211b9637dc17fdae9235fa4e179ab3dc96d44ef5bc52f66833a65`,
`runtime/packaging-state.json` SHA-256 `cfeae0de03a33c5fc3f098894367f7416b062a80d91999d331c429f27124074b`,
and `lode/provenance.json` SHA-256
`da7aa536363aa1feba56173b5b740aa4c11e7a1a58cfc248d6391f90e6378e52`.
This is an unsigned local packaged runtime; no installer or release bundle was
created.

## Checks and boundaries

The frozen install, root build/typecheck/test/lint/conformance/smoke, Harbor
typecheck and fixture runtime-API smoke, Desktop smoke plus four packaged variants
passed. Packaged runtime and readonly smokes started independent Core and Harbor
child processes, verified Core `/threads`, Lode action/policy admission and
fixture fail-closed behavior, then left no runtime process or user-data residue.
The completed root `pnpm test` reported Harbor 186 passing and 1 skipped; a
separate direct Harbor test invocation encountered a local fake-browser
navigation-ack hang, was interrupted, and left no residual process.

No real account, browser profile, production page, credential/cookie/token/raw
DOM/HAR, submit/publish/send action, signing, notarization, publication, deploy,
source archive, or source deletion was used. This is a local `no_release` record;
the smoke screenshots were generated as local fixtures, then restored to the
committed fixture state; they are not retained or hashed as release artifacts.

## Four-state offline fixture matrix

The machine-readable carrier lists the same four states. The executable
assertions are in [`readonly-vertical-slice-self-check.ts`](../../packages/api-server/src/readonly-vertical-slice-self-check.ts)
and the contract is [`readonly-vertical-slice.md#四态及保护路径`](readonly-vertical-slice.md#四态及保护路径).

| State | Assertion | Expected result |
| --- | --- | --- |
| `offline_read_success` | `assertSuccess` | Read succeeds against the offline fixture with no failure attribution. |
| `structured_unavailable` | `assertUnavailable` | Structured unavailable state; attribution is `runtime`. |
| `failure_attribution` | `assertFailure` | Failed run; attribution is `capability`. |
| `bounded_rollback` | `assertRollback` | Rollback trace completes and fixture cleanup returns to idle. |

Canonical network/5xx/session-missing/malformed guards are separately asserted
fail-closed by `assertCanonicalGuards`; they are not a fifth success state.

## Rollback rehearsal

The previous multi-repository assembly was replayed in disposable clean
checkouts. The exact inputs were monorepo `26704259b5acb428a29e954eebad144b14bc640e`
(tree `16cd70d190750e35bea3c2807bc41891b73ee5ff`, App prefix tree
`7405c3db75db54c1000948d95a16619e73c62eb3`), Core
`2c401cf90c0cf7150e8156b904975cefaf435fa8` (tree
`b34b94ea980d01e9326c5606e58af5d705e72941`), Harbor
`f9e13311ccd3f80cf8ef54cb97245a42da49882b` (tree
`fa756ee3b37bfc85daab1f4bcde1c8080e1df046`), and the same Lode pin above.

After frozen installs, the old Desktop build and both
`smoke:packaged:readonly` and `smoke:packaged:runtime` fixture replays passed.
The baseline output was 684 files with relative-file-list SHA-256
`8f6e2c07f6040856136d2beb073e0c67663fa4b89f52d4046bc1d877598ac653`,
content-manifest SHA-256
`42b8ceb9bda3ce3ec1e401cfa6797b84a97de261db9ede9f35f2d76e5f531564` and
packaging-state SHA-256 `76197a6addceba03485a16e8911fd1128120ffdd00ed8af586a1926e75cfe2e8`.
The old script had no Lode `provenance.json`; that missing fact is preserved as
part of the rollback baseline, while the new v1 record supplies it.

Rollback therefore means restoring these exact inputs and replaying the recorded
commands in separate checkouts. It does not reset the current branch, rewrite
history, delete artifacts, archive a source repository, or change external state.
