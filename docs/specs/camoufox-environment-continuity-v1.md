# Camoufox Environment Continuity V1

> 状态：Retired（历史 #499 provider-private implementation contract；2026-09-12）
> 版本：1.1（历史 RGBA Canvas observation baseline）
> 日期：2026-09-12
> 归口：[Camoufox 环境连续性 #499](https://github.com/WebEnvoy/WebEnvoy/issues/499)
> 上位语义：[Profile Environment V1](profile-environment-v1.md)

本文保留 #499 切片的 Camoufox 私有持久化和 Driver readback 作为历史合同与 recovery 校验依据。它不是公共 fingerprint API，也不承诺不可检测、固定网络出口或所有 Camoufox optional features；当前 #519 B 的上游原版 Camoufox／Playwright 组合因 popup 首请求在派发前无法建立可信 Page 归属（[证据评论](https://github.com/WebEnvoy/WebEnvoy/issues/519#issuecomment-5643484622)）未通过 Qualification Gate，完整 installed、人工交还和环境连续性也尚未验收，Harbor 不再启动或 fallback 到该私有 binding。保留 bundle 只能由纯 stdlib validator 校验，不能创建新 bundle、生成新指纹或恢复 launchability；旧 patched/native Driver 和 live 证据均为历史记录。

## 1. Design Obligation disposition

- `DO-PROVIDER-PRIVATE-SCHEMA = triggered`（历史）：pinned Camoufox `launch_options()` 每次会生成 BrowserForge fingerprint、fonts、voices、WebGL 参数以及 `fonts:spacing_seed`、`audio:seed`、`canvas:seed`。这些值不会由 persistent Profile 自动证明为稳定，历史 Driver 曾要求先保存完整 provider config 再启动；该路径不属于当前 launch/support。
- `DO-GRANT-WIRE = not-triggered`：公共授权只在既有 `allowed_operations` 增加 `environment.read/update` 固定值；继续使用 Profile ceiling、Principal Grant 和 task scope，不新增 Grant 字段、scope dimension 或持久授权对象。
- `DO-PLUGIN-EXPOSURE = triggered`：environment.read/update 已成为 Installed Plugin 的稳定 operation projection；公共配置、授权和 envelope 见 [Profile Environment V1](profile-environment-v1.md)，本文件只负责 Driver-private readback。
- Network/Console contract：`not-triggered`。本文件不形成 Network/Console 公共 payload。
- App IA：`not-triggered`。本切片不新增 App 工作台或导航。

## 2. Private bundle schema

### 2.1 Location and owner

- Location: `<PROFILE_DIR>/.webenvoy-camoufox-environment.v1.json`。
- Owner: Harbor/Driver owns the file and the containing managed Profile; Camoufox only consumes the `config` passed to `launch_options()`.
- The file is private provider state. It must never be printed, returned in a Driver result, copied into public facts, or included in an error message. File mode is `0600`; temporary files are created in the same Profile directory.
- The bundle contains no proxy URL, Cookie, account state, request/response body, raw HAR, or external network observation.

### 2.2 JSON shape

The exact v1 object is:

```json
{
  "schema_version": 1,
  "provider": "camoufox",
  "camoufox_version": "0.5.6",
  "browser_version": "152.0.4-beta.30",
  "properties_sha256": "10d5cfb6c8eb3824485734362a3920e07b36c3801770fffcc14a3546e56f81f4",
  "config": { "<CAMOU_CONFIG key>": "<provider value>" },
  "config_sha256": "<sha256 of canonical config>",
  "identity_hash": "<sha256 of canonical identity config>",
  "baseline": null,
  "baseline_sha256": null
}
```

`config` is the complete JSON object reconstructed from the pinned provider's `env.CAMOU_CONFIG_1`, `CAMOU_CONFIG_2`, ... chunks after the first `launch_options()` call. It includes the generated BrowserForge fields, font/voice lists, WebGL fields, media-device defaults and the three seed fields. No hand-curated subset is used: omitted provider keys could be randomly filled again by `launch_options()`.

Canonical JSON for all hashes uses UTF-8, sorted object keys, compact separators and no ASCII escaping. `config_sha256` covers the exact stored `config`. `identity_hash` covers that same config after removing only launch-time dynamic keys:

- `timezone`;
- `locale:language`, `locale:region`, `locale:script`, `locale:all`, `navigator.language`;
- `window.outerWidth`, `window.outerHeight`, `window.innerWidth`, `window.innerHeight`, `window.screenX`, `window.screenY`.

The identity hash therefore stays stable when managed timezone/locale/viewport values change. It does not expose the config or any seed value.

`baseline` is either `null` or the first successful `environment_read` observation reduced to the fixed continuity fields below; it never contains raw font/voice materials, pixels, audio samples, or provider config. Its shape is `{ "observed_at": "<UTC>", "observed": { "<continuity field>": "<value or null>" }, "canvas": { "algorithm": "rgba8-240x60-v1", "instance_ref": "<32 lowercase hex Driver launch ref>", "hash": "<64 lowercase hex SHA-256 or null>" } }`. `baseline_sha256` covers that exact baseline object and is `null` iff `baseline` is `null`. Baseline creation/update uses the same private file and an atomic replacement.

The pre-1.1 baseline has no `canvas` member and its `observed.canvas_hash` is a PNG data-URL hash. The only supported observation upgrade adds the `canvas` member on the next safe read, retaining the entire original `observed` map, timestamp, config, seeds and identity hash. It does not compare PNG and RGBA hashes. The new Canvas baseline is `unknown` on that launch (including repeated reads); only a different Driver launch can verify it. This applies to fresh RGBA baselines too. Unknown algorithms fail closed. This is not a Provider/schema migration framework. A pre-1.1 reader rejects the extended baseline before launch; rollback requires the matching private backup, never automatic stripping of metadata or regeneration.

### 2.3 Historical creation and replay contract

以下步骤仅记录 #499 的历史 Driver 行为，不是当前 Harbor 的启动路径；当前请求在 launch binding gate 处以 `unsupported` 结束。

1. The historical Driver validated the existing qualified Python/package/browser/properties pins.
2. If the bundle exists, load and validate it before browser launch. A symlink, non-regular file, broad permissions, malformed JSON, wrong shape, hash mismatch, provider mismatch, or unsupported version is a hard failure.
3. If no bundle exists, only an empty managed Profile may be treated as first creation. A non-empty Profile without its bundle is a continuity failure, not permission to generate a replacement identity.
4. Historically, first creation called the pinned `launch_options()` once, reconstructed `config` from all `CAMOU_CONFIG_*` chunks, and atomically persisted the bundle before `sync_playwright()`/`NewBrowser()` started. The write used a same-directory temporary file, flush+fsync, and an atomic no-overwrite directory entry. A failed browser start left the bundle available for an exact retry.
5. Historically, replay passed a deep copy of the complete stored `config` to `launch_options(config=...)`. Pinned `merge_into()`/`set_into()` preserved existing keys, but BrowserForge could introduce optional keys absent on the original draw (observed: `screen.availLeft`). Stored absence was authoritative: replay retained only the original key set plus the explicit dynamic keys above, verified its identity hash, and re-encoded that exact map with the pinned `get_env_vars()` before browser launch. Newly sampled optional keys never reached the browser; changed or missing original identity fields failed closed. This did not rewrite the bundle or discard a known original value.
6. Historically, explicit non-empty `timezone` and `locale` inputs overrode the in-memory config for that launch. Timezone was also passed as native Playwright `timezone_id` through pinned `NewBrowser` to the persistent context. The Driver supplied `firefox_user_prefs["roverfox.s.timezone_0"]` with the same launch value: the pinned default persistent context (userContextId 0) otherwise reused its old Provider-owned preference before consulting `CAMOU_CONFIG`, overriding the requested timezone on navigation. This was a derived dynamic cache, not identity; the historical path updated only this exact preference via the normal launch API, never read/edited Profile files or cleared other Provider state. Explicit `viewport` updates replaced only the window geometry and clamped its existing position/chrome relationship to the stored screen. They did not rewrite the bundle or identity hash. The pinned API's `window=(w,h)` was an outer-window input, so replay did not rely on passing `window` a second time over an existing config.
7. Proxy is resolved and passed through the existing Playwright launch option. It is not silently changed, inferred, or stored in this bundle.

No migration platform is part of v1. An unsupported schema/provider/browser/properties version is rejected. The owner repair path is to restore a matching private bundle/Profile backup or perform an explicit Profile repair/recreation through the managed lifecycle; the Driver never invents a new fingerprint, switches Provider, or replaces the Profile.

### 2.4 Corruption, rollback and failure semantics

- Corrupt or incompatible bundle: fail closed before `NewBrowser`; preserve the file and Profile for owner diagnosis.
- Missing bundle on a non-empty Profile: fail closed; do not call the generator.
- First-write collision: fail closed rather than overwrite the other writer's bundle. Harbor's Profile lock remains the concurrency boundary.
- Browser/provider startup failure after first persistence: retry the same bundle; do not regenerate, switch Provider, switch proxy, or create a replacement Profile.
- Explicit dynamic override failure: the private bundle remains unchanged, so the prior identity can be retried with the prior effective configuration.
- There is no automatic Provider rollback or identity migration. Only the observation-algorithm extension in §2.2 is automatic; a human/owner restores a matching artifact for a reader rollback.

## 3. Historical `environment_read` private Driver result

`environment_read` was a fixed, read-only Driver command in the historical #499 path. It did not accept an expression, open a page, route a request, read Cookie/account/storage, or make an external network request. It evaluated one fixed `mw:` expression in the active original Page and returned only bounded facts. Current Harbor retains the result shape only as historical/recovery documentation; it does not launch this Driver.

Successful result shape:

```json
{
  "status": "completed",
  "observed_at": "2026-09-10T00:00:00.000Z",
  "provider": {
    "camoufox_version": "0.5.6",
    "browser_version": "152.0.4-beta.30",
    "properties_sha256": "10d5cfb6c8eb3824485734362a3920e07b36c3801770fffcc14a3546e56f81f4"
  },
  "bundle_hash": "<identity_hash>",
  "observed": {
    "language": "en-US",
    "languages": ["en-US"],
    "timezone": "America/New_York",
    "viewport": {"width": 1200, "height": 752},
    "screen": {"width": 1980, "height": 1286, "avail_width": 1980, "avail_height": 1238},
    "hardware_concurrency": 10,
    "device_memory": null,
    "webgl_vendor": "Apple",
    "webgl_renderer": "Apple M1, or similar",
    "fonts_hash": "<sha256 or null>",
    "voices_hash": "<sha256 or null>",
    "canvas_hash": "<sha256 or null>",
    "audio_hash": "<sha256 or null>"
  },
  "continuity": {
    "state": "match|drift|unknown",
    "checked_fields": ["screen", "hardware_concurrency"],
    "changed_fields": [],
    "unknown_fields": ["fonts_hash", "voices_hash"]
  }
}
```

All keys in `observed` are present. `null` means the current browser/page could not safely verify the field; it is not a claim that the value is absent. `viewport` reports the page's actual `innerWidth`/`innerHeight`; `screen` is bounded to the public screen geometry. The four hashes are SHA-256 of bounded local summaries only: no raw font names, voice list, canvas pixels, audio samples or seed/config values are returned.

`continuity` is optional only when a result cannot be associated with a valid private bundle; for a normal managed launch it is present. The fixed stable comparison set is `screen`, `hardware_concurrency`, `webgl_vendor`, `webgl_renderer`, `canvas_hash` and `audio_hash`. The first successful read stores the baseline and returns `unknown` because no cross-restart comparison exists yet. Later reads compare only non-null baseline/current values: any changed checked field yields `drift`; all stable fields matching yields `match`; missing/unsupported fields yield `unknown` unless a changed field already proves `drift`. `fonts_hash` and `voices_hash` are returned when available but are not treated as continuity proof in v1 because the current readback can be page-dependent or not-ready. Locale/language, timezone and viewport are mutable configuration and are deliberately excluded from this comparison.

The expression bounds strings/lists and catches unsupported APIs. WebGL uses the page's WebGL context and debug extension when available. Fonts hash the current bounded `document.fonts` descriptors, voices hash bounded `speechSynthesis.getVoices()` descriptors, and audio hashes a bounded fixed offline render when `OfflineAudioContext` is available. Canvas algorithm `rgba8-240x60-v1` hashes exactly the 240×60 fixed drawing's row-major RGBA8 bytes from `getImageData`, not a PNG/data URL or its metadata. The drawing is an opaque `#18324b` background and `#d7edf7` text `WebEnvoy continuity`, `16px sans-serif`, middle baseline at (8,30). Bytes are hashed inside the page and never returned. If an API is absent, not ready, or unsafe to verify, its hash is `null`.

## 4. Provider facts matrix

The matrix records facts historically verified from the pinned source and Driver, not Provider marketing claims. `V1 status` is the state of the historical #499 slice, not current Camoufox launch support.

| Fact | Owner / persistence | Apply or replay path | Readback / V1 status | Boundary |
| --- | --- | --- | --- | --- |
| Camoufox/package, browser, `properties.json` | WebEnvoy qualifies exact pins; observed every launch | Driver preflight and bundle metadata | `environment_read.provider`; verified for `0.5.6` / `152.0.4-beta.30` / given SHA | Mismatch rejects launch; no upgrade migration |
| Browser family / target OS / UA / platform / oscpu | Provider-generated on first launch, then WebEnvoy private bundle | Full `config` replay; `os` still maps host platform but stored keys win | JS language/device facts plus bundle hash; stable-config verified for pinned path | Host OS itself is not claimed stable; changing it is a qualified compatibility risk |
| Locale / language list | WebEnvoy configured; dynamic and excluded from identity hash | `locale`/`handle_locales()` override in memory | `language`, `languages`; explicit locale path supported | No locale is inferred from network in this slice |
| Timezone | WebEnvoy configured; dynamic and excluded from identity hash; Provider-owned derived preference | In-memory config, native `timezone_id` and exact `roverfox.s.timezone_0` preference on the default persistent context | `timezone`; IANA input validation does not replace actual browser readback | GeoIP-derived timezone is not enabled; no multi-container claim |
| Viewport / window | WebEnvoy configured; window geometry is dynamic and excluded from identity hash | Replay config geometry override; stored screen remains | `viewport` from `innerWidth`/`innerHeight`; explicit outer-window path limited to pinned Camoufox semantics | Does not claim screen/DPR or native-window continuity beyond observed facts |
| Screen | Provider-generated with BrowserForge and stored in bundle | Full config replay | `screen`; stable-config verified, actual display bounds are observed | Headful display changes can be drift/launch risk; no re-randomization |
| Proxy reference / server | Harbor/Core configured and resolved outside this bundle | Existing `proxy` Playwright option | Not returned by `environment_read`; not network-verified here | No proxy URL or exit inference is persisted/returned |
| Network exit | External network observation only | Not applied by this Driver command | Unsupported / no safe readback (`null` outside requested observed shape) | No external request and no live proxy evidence |
| Geo | Provider geolocation optional path, not passed by the historical Driver | Unsupported in this slice | Not safely read back | Do not infer geo from locale/timezone |
| WebRTC | Provider optional `geoip`/prefs path, not enabled by the historical Driver | Limited/unsupported for #499 | Not included in readback; no claim | Do not claim leak prevention or continuity |
| Hardware concurrency | Provider-generated BrowserForge config, persisted in bundle | Full config replay | `hardware_concurrency`; verified when page exposes it | Manager does not accept a user hardware override in this slice |
| Device memory | Not generated by current pinned launch path | No control path | `device_memory` or `null`; observed-only/limited | Firefox may not expose `navigator.deviceMemory` |
| WebGL vendor/renderer | Provider samples a screen-coherent pair and stores config | Full config replay | WebGL context/debug extension or `null`; limited observed verification | Browser sanitization may alter/limit page-visible values |
| Fonts | Provider generates random OS subset and stores it in bundle | Full `fonts` config replay | `fonts_hash` only; observed but not a continuity checked field because page font set can be incomplete/site-dependent | Never return raw font list |
| Media devices | Provider defaults are generated in config (`mediaDevices:*`) and stored | Full config replay | No dedicated readback in this result; provider-config verified only | No permission/account state read |
| Voices | Provider generates random voice objects and stores them in bundle | Full `voices` config replay | `voices_hash` or `null`; observed but not a continuity checked field because voices can be not-ready | Never return raw names/URIs |
| Canvas seed / drawing | Provider generates `canvas:seed`, stored in private config | Full config replay; browser consumption of this key is not verified | Bounded RGBA hash checks observed drawing continuity; PNG container hash is not pixel identity | Same pixels can encode differently; no claim of every Canvas path or seed enforcement |
| Audio seed | Provider randomizes once per first config and stores `audio:seed` | Full config replay | `audio_hash` or `null`; fixed offline render is continuity-checked when non-null | No raw samples or seed disclosure |
| Font spacing seed | Provider randomizes once per first config and stores `fonts:spacing_seed` | Full config replay | No direct safe public readback in this result; bundle continuity only | Do not expose seed |
| Interaction policy | Harbor Driver-owned fixed controlled interaction; not a bundle identity field | Existing `managed_interaction` path | No environment_read field | `mw:` helper is fixed; empty `aria-labelledby` IDs are filtered before `getElementById` |
| Profile storage / account state | Harbor owns managed `PROFILE_DIR`; Firefox persistent context owns browser storage | `user_data_dir=PROFILE_DIR`, same Profile on restart | No Cookie/account read; storage continuity is lifecycle evidence, not this result | Never use external active Profile or replace it silently |
| Provider generated state | Harbor Driver captures the complete `CAMOU_CONFIG_*` result | Versioned private bundle and exact replay | `bundle_hash`; config itself remains private | Missing/corrupt state rejects launch |
| `main_world_eval` | Driver launch policy; pinned provider maps it to `allowMainWorld` | Fixed `mw:` expressions for controlled/site/readback paths | `environment_read` uses one fixed expression; no script input | Enabling main-world evaluation is recorded fact, not a stealth defect by itself |
| Page evaluation | Harbor fixed helpers use `mw:`; site probe/read operation have fixed expressions | `managed_observe`, site/read probes, environment read | Environment read has no public script parameter | No raw debugger/CDP/Juggler endpoint is exposed |
| Route/interception | Driver only installs public-navigation/interaction guards for their existing managed scopes | Same-origin GET/redirect blocking; interaction route may fetch with `max_redirects=0` | No route facts in environment_read | These guards can affect managed navigation; environment_read itself does not route or request |

### 4.1 Historical installed-provider verification boundary

The historical installed `0.5.6` / `152.0.4-beta.30` live run on 2026-09-09 used the same isolated Profile and retained the original bundle across normal Instance restarts and a full Runtime restart. The bounded storage marker, screen, hardware concurrency, WebGL pair, voices hash and audio hash remained unchanged in the observed runs. The pre-1.1 PNG hash changed, but local-page raw RGBA and decoded-PNG RGBA hashes matched across the measured drawings. PNG chunk types included `IHDR,IDAT,deBG,IEND`; this does not prove which chunk caused the difference. This is historical evidence only and does not qualify the current upstream combination or reopen the retired launch path.

The historical qualified `properties.json` declares `canvas:seed`, but declaration and Python replay alone do not establish browser-side use. Read-only inspection did not find that key in the installed XUL binary; this is supporting diagnostic evidence, not proof of every browser implementation path or a settled root cause. The same historical live found config-only UTC failed browser readback, motivating the native timezone path above. Exact installed commit, public hashes/refs, verification of both fixes and individual lifecycle outcomes belong to the linked PR/Issue live evidence. Neither the measurement correction nor its fixtures alone satisfied #499 acceptance or qualifies the current #519 B candidate.

Pinned-source timezone audit: [`TimezoneManager::GetTimezone`](https://github.com/daijro/camoufox/blob/v152.0.4-beta.30/patches/timezone-spoofing.patch) checks stored `timezone_<userContextId>` before config and reapplies it to new documents. [`RoverfoxStorageManager`](https://github.com/daijro/camoufox/blob/v152.0.4-beta.30/patches/anti-font-fingerprinting.patch) prefixes keys with `roverfox.s.` and uses Firefox Preferences; [parent-process synchronization](https://github.com/daijro/camoufox/blob/v152.0.4-beta.30/patches/cross-process-storage.patch) writes them with `Preferences::SetCString`. This explains why config-only and native-only restart attempts can retain the previous timezone. The launch preference aligns the existing cache; no page init-script, setter exposure or browser binary patch is added.

## 5. Explicit non-goals

- No migration framework for future schema versions.
- No public raw Camoufox config, fingerprint, font/voice list, seed, CDP/Juggler endpoint or HAR.
- No external proxy/geo/network-exit verification from `environment_read`.
- No automatic Provider switch, proxy switch, replacement Profile or random regeneration on failure.
- No claim that main-world evaluation, disabled `humanize`, or any unused optional flag is a continuity or stealth defect without direct evidence.
