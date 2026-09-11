# Camoufox Native Provider Contract V1

> 状态：Accepted；Provider-private implementation contract
> 版本：1.0
> 日期：2026-09-11
> owner：Harbor / Camoufox Provider Driver
> 产品归口：[Phase 1 native Camoufox validation #504](https://github.com/WebEnvoy/WebEnvoy/issues/504)
> 上位语义：[Page, Document and Navigation Runtime Contract V1](page-navigation-runtime-contract-v1.md)、[Camoufox Environment Continuity V1](camoufox-environment-continuity-v1.md)
> 架构依据：[ADR 0011](../adr/0011-v1-managed-browser-and-skill-delivery.md)、[ADR 0012](../adr/0012-runtime-capability-plane-and-plugin-first.md)

本文冻结 #504 使用的 **test-only Camoufox native adapter**、独立管理构件和三项私有 native protocol operation，以及一个固定的 Page reload 适配。它是 Harbor Driver 与受管测试构件之间的私有合同，不是 Core、MCP、Plugin 或 Agent 可见的公共 wire contract。本文不替代 #504 的公共合同或验收证据；构件、Provider 和 fixture 的实际验收仍须由链接 Work Item 的 exact-head evidence 证明。

## 1. 范围、owner 和边界

### 1.1 参与者

```text
qualified Camoufox source app
        │  read-only copy + exact four-entry patch
        ▼
independent native test artifact + manifest
        │
        ├─ Harbor Python Driver
        │       │  fixed Playwright adapter methods
        │       ▼
        └─ copied Playwright driver package (closed temporary tree)
                         │
                         ▼
             private Juggler Browser methods
```

- **Builder** 固定来源 Camoufox 版本、浏览器版本、资源 hash、patch anchor 和 test-only app identity，并把结果写入一个新构件目录。
- **Native Playwright adapter** 只在当前 Driver 进程安装，复制已核验的 Playwright driver package，在副本的 `coreBundle.js` 中增加固定方法，并在进程内替换 transport executable resolver。
- **Harbor Driver** 负责 Page Registry、native identity mapping、active state、导航/关闭失败和 tombstone；它不把 native handle 当作公共 Page identity。
- **Camoufox/Juggler patch** 负责从真实 `navigator:browser` tab/window 读取关系、在现有 window 中创建 tab，以及在同一 window 中安全切换并关闭 tab。

以下内容永远不得越过 Harbor：`targetId`、`tabId`、`browsingContextId`、`windowId`、`browserContextId`、Juggler endpoint、native protocol method、Profile 路径和构件内部路径。公共 Page facts 继续由 Harbor 的既有 Page contract 投影。

### 1.2 Design Obligation disposition

以下 disposition 只判断本 Provider-private adapter/artifact 合同是否触发对应设计义务；它不覆盖、缩小或改写 #504 Work Item 的整体 obligations。#504 的公共 Page、生命周期、授权、恢复和独立验收仍由其 owning spec/PR 维护。

| Trigger | disposition | 依据 |
| --- | --- | --- |
| `DO-PROVIDER-PRIVATE-SCHEMA` | `triggered` | 构件 manifest、native snapshot schema、background-create/safe-close relation 和 adapter closure 都是固定的 Provider-private versioned state/protocol。 |
| `DO-PLUGIN-EXPOSURE` | `not-triggered` | 本合同没有新增 Agent tool、MCP projection、capability discovery 或 availability policy。 |
| `DO-GRANT-WIRE` | `not-triggered` | 三项 operation 只在 Harbor Driver 内使用，不增加 Grant 字段、origin scope 或持久授权维度。 |
| `DO-NETWORK-CONTRACT` / `DO-CONSOLE-CONTRACT` | `not-triggered` | native relation 不形成 Network/Console public payload；既有诊断合同保持不变。 |
| `DO-APP-IA` | `not-triggered` | 本切片不新增 App surface、导航或工作台。 |

## 2. Managed native artifact

### 2.1 Artifact identity and manifest

Builder 产生的 manifest schema 是 `webenvoy.camoufox-native/v1`，并且必须包含下列固定字段：

```json
{
  "schema": "webenvoy.camoufox-native/v1",
  "patch_id": "managed-native-snapshot",
  "test_only": true,
  "distribution_or_production_use_authorized": false,
  "source": { "app": "<source path>", "browser_version": "152.0.4-beta.30", "<source hashes>": "..." },
  "output": { "app": "<artifact path>", "<output hashes>": "..." },
  "identity": {
    "bundle_identifier": "com.webenvoy.camoufox.native504",
    "bundle_name": "WebEnvoy Camoufox Native Test"
  },
  "provider": { "camoufox_version": "0.5.6", "browser_version": "152.0.4-beta.30" },
  "patched_entries": { "<entry>": { "before_sha256": "...", "after_sha256": "..." } }
}
```

`<source hashes>` 和 `<output hashes>` 不是可选的任意 metadata：builder 的 qualified pin 集覆盖 `omni.ja`、`properties.json`、Camoufox executable、`Info.plist` 和 `application.ini`；output 还覆盖 rewritten `Info.plist`、patched `omni.ja`、两个 `properties.json` 以及 application version。manifest 记录每个输出的 hash，validation 必须重新计算并比较，而不是只信任 manifest 内容。

构件必须满足：

1. 来源 app、`Info.plist`、executable、Resources、`application.ini`、`properties.json` 和 `omni.ja` 都是 regular file/directory；来源不能是 symlink。
2. 来源浏览器严格是 Camoufox `0.5.6`、browser `152.0.4-beta.30`，并匹配 builder 中固定的 source hash 集。
3. 输出目录此前不存在，且与来源目录分离；builder 使用独立 copy，不在来源 app 内写入、删除或替换文件。
4. 只在 `omni.ja` 的四个精确 entry 上执行 anchored textual patch：
   - `chrome/juggler/content/protocol/Protocol.js`
   - `chrome/juggler/content/protocol/BrowserHandler.js`
   - `chrome/juggler/content/TargetRegistry.js`
   - `chrome/juggler/content/protocol/PageHandler.js`
5. 输出 app 的 bundle identifier/name 被改为上面的 test identity；Resources 中的 `properties.json` 另外复制到 `Contents/MacOS/properties.json`，且两份内容必须相同。
6. manifest 的 `test_only` 必须为 `true`，`distribution_or_production_use_authorized` 必须为 `false`，`patch_id` 必须精确匹配；builder 会拒绝缺失/anchor 不唯一/source hash 不匹配，installed-binding preflight 会拒绝 manifest/output hash/版本不兼容。这个 preflight 是构件绑定门槛，不应被误读为 Python Driver 自己解析 manifest。

### 2.2 Installed binding

Real validation 只接受显式传入的 artifact 和 Profile：

- validation 拒绝 `/Applications/Camoufox.app` 这类原始安装 app，拒绝按 app name、默认路径或目录扫描发现构件。
- artifact 的 manifest、`Info.plist`、executable、application version、Resources/adjacent `properties.json` 和 output hashes 必须相互一致。
- Profile 必须是显式的真实目录，并位于临时测试 root；Profile 内容不是 artifact 的一部分，也不会被 builder 复制、清空或重写。
- helper、artifact、Profile 和验证 Python 都以显式路径绑定；失败时不换 artifact、不换 Provider、不创建 replacement Profile。

当前实现边界必须保留：`camoufox-native-validation.py`（以及产品启动路径中的 installed-artifact resolver）负责 manifest/binding preflight；`camoufox-driver.py` 直接 launch 时核对 executable、browser/application version、`properties.json` 和 adapter/package pins，但当前并不直接读取 native artifact manifest。因此绕过 preflight 不是本合同授权的调用方式；若将直接 Driver launch 作为正式入口，必须先补齐同等 manifest gate，不能在文档中声称它已经存在。

此构件不改变已安装 Camoufox 的 binary、`site-packages`、用户 Profile 或系统 app registration。它不构成可发行 app，也不授权生产使用。

## 3. Runtime closure and compatibility pins

### 3.1 Playwright closure

Native adapter 只接受 Python Playwright `1.60.0` 及其 qualified driver closure。安装前必须校验下列固定 hash：

| file | qualified SHA-256 |
| --- | --- |
| `lib/coreBundle.js` | `f74353fcb8e406756a70a6af0dfc4a5069acd577e35ec9d923ccf36ac009c2f5` |
| `cli.js` | `f1c4075aef116c766092250d7f37b3249a7cee6465d953207fc38c8f6145becd` |
| `lib/utilsBundle.js` | `5c42363c10d2f2f5bc91e07feaa9fa5f417a1a55e6559448d0c20d66f73db9e0` |
| `browsers.json` | `af53e32ffe35a024ddb34563700956b01ada00ac7e9270ba5df0604ec57e38e1` |
| `package.json` | `6f7b58cc55449321279f11ca97d4e451c391738b77db32cdbcedf02851e3f097` |

The adapter then:

1. copies the complete driver package into a fresh temporary root;
2. rejects symlinks and non-file/non-directory entries so the copied tree is closed;
3. patches only the exact `coreBundle.js` BrowserContext anchor and adds the three fixed adapter methods;
4. points the current Python transport at the copied `cli.js` without editing installed `site-packages`;
5. removes the adapter-owned temporary root on install failure and on `close()`.

The Node executable is resolved from the same qualified Playwright driver and must be a regular file. V1 does not expose it, use a second package tree, or claim an independent Node hash beyond the qualified driver closure. The helper source copied into Harbor `dist` is limited to `camoufox-driver.py` and `camoufox-native-playwright.py`; it is not an installed package mutation.

### 3.2 Pairing and rollback

The Camoufox artifact and Playwright closure are a compatibility pair. The reader accepts only `webenvoy.native-playwright/v1` and the exact pins above; it does not down-convert unknown fields, accept a future major version, or guess a compatible target from URL/title.

Rollback is an owner-selected operation performed before a new Driver launch:

- restore a matching prior artifact and matching driver closure as a pair;
- leave the installed source app, site-packages and Profile untouched;
- do not strip the manifest, remove a patch from the source app, or rewrite a running Driver;
- if the selected stack lacks native relation support, reject the v1 launch/operation rather than falling back inside the current Driver; historical single-Page behavior is not an active v1 compatibility guarantee, and native mapping must never be emulated by URL/title or a replacement window.

There is no in-process native swap, automatic downgrade, Provider switch, Profile replacement or random regeneration. A v1 incompatibility is a fail-closed startup/operation result, not permission to fall back to an unqualified relation implementation.

## 4. Private protocol schema

The patched Juggler Browser domain declares exactly three private methods. The patched Page domain also uses a fixed native reload implementation: it reloads the target's live `BrowsingContext` directly and does not call `activateAndRun` or the browser `Browser:Reload` command. `browserContextId` is dispatcher-internal. The optional `timeout` declaration exists only for Playwright's internal progress/deadline plumbing; Harbor callers cannot provide it as a user setting, it is not persisted, and the native handlers do not use an arbitrary caller timeout. The adapter obtains the normal BrowserContext timeout calculator from the private Playwright context.

### 4.1 `Browser.getWebEnvoyNativeSnapshot`

Parameters:

```text
browserContextId?: string       # dispatcher-internal
timeout?: number                # internal deadline only
```

Result:

```text
schemaVersion: "webenvoy.native-playwright/v1"
epoch: non-empty string
sampleSequence: safe integer >= 1
selectionStatus: "complete" | "empty" | "partial"
activeWindowId?: non-empty string
windows: WindowFact[]

WindowFact = {
  windowId: non-empty string,
  osForeground: boolean,
  selectedTabId?: non-empty string,
  pages: PageFact[]
}

PageFact = {
  targetId: non-empty string,
  tabId: non-empty string,
  browsingContextId: non-empty string,
  selected: boolean
}
```

The result contains no URL, title, DOM, storage, cookie, account, endpoint or browser object. There is no user-supplied array or expression. Windows and Pages are exactly the finite native tabs belonging to the requested BrowserContext; duplicate identity and incomplete relation are invalid. The protocol has no independent arbitrary count limit; Harbor's retained closed-page tombstone limit is fixed separately at 64 (§6.3).

### 4.2 `Browser.newPageInWindow`

Parameters:

```text
browserContextId?: string       # dispatcher-internal
windowId: non-empty string
timeout?: number                # internal deadline only
```

Result:

```text
targetId: non-empty string
windowId: non-empty string
tabId: non-empty string
browsingContextId: non-empty string
```

The returned `windowId` must equal the requested identity. No URL or Page wrapper is synthesized in the native layer; the adapter maps the returned target to an already-owned Playwright Page channel.

### 4.3 `Browser.closePageWithSafeReturn`

Parameters:

```text
browserContextId?: string       # dispatcher-internal
targetId: non-empty string
safeTargetId: non-empty string  # distinct from targetId
timeout?: number                # internal deadline only
```

Result:

```text
targetId: string                # exact input targetId
safeTargetId: string             # exact input safeTargetId
```

The operation owns no last-Page policy and is only the private primitive for a proven same-window safe return. Harbor decides whether a public close is allowed before calling it.

### 4.4 `Page.reload` artifact adapter

The artifact's `PageHandler.js` replaces the stock Juggler reload body with a
direct call to the target's live `linkedBrowser().browsingContext.reload()`
using `Ci.nsIWebNavigation.LOAD_FLAGS_NONE`. It preserves Playwright's existing
navigation wait and lifecycle-event handling, but does not call
`PageTarget.activateAndRun()` or `Browser:Reload`. This keeps reload bound to the
already-validated target/tab relation and avoids the Camoufox browser command's
remoteness/history side effect. The patch is test-artifact-only; the installed
Camoufox app is never modified.

## 5. Snapshot and Page mapping semantics

### 5.1 Native enumeration

`TargetRegistry.nativeSnapshot()` enumerates `navigator:browser` windows and their native `gBrowser.tabs`. Ownership is determined only by the native tab's `userContextId` mapped through `_userContextIdToBrowserContext`. URL, title, tab attributes, provider Page object, creation order and active request are not ownership or identity signals.

For every owned tab, a complete snapshot requires:

- a live Juggler target whose BrowserContext, native window and native tab are the exact same objects;
- a non-discarded linked BrowsingContext with a stable id;
- unique `targetId`, `tabId` and `browsingContextId` across the snapshot;
- the native tab count, native target set and `browserContext.pages` set to agree bidirectionally;
- exactly one selected tab per grouped native window when that window has Page entries.

`osForeground` is reported independently from tab selection. `activeWindowId` is the most-recent native browser window only when it belongs to the grouped relation; it may be absent when no owned window is present. A native tab with no live target is not represented as a closed Page: it makes the relation `partial`.

### 5.2 `complete`, `empty`, `partial`, epoch and sequence

- `complete` means all owned native tabs and all BrowserContext Page targets are mapped, identities are unique, and every grouped window has one selected tab.
- `empty` means there are no owned native tabs and no registered BrowserContext targets. It is a valid absence result; a launch that requires a Page must still fail if no Page is available.
- `partial` means any native target, tab, window or selection relation is missing, duplicated or inconsistent. Harbor does not publish a partial active Page.
- `epoch` is generated by one `TargetRegistry` instance and must remain unchanged for the lifetime of the Driver connection.
- `sampleSequence` increments for every native snapshot and must be a safe integer `>= 1`. Harbor rejects a sequence that is not strictly newer than the last trusted sample.

The adapter validates the wire schema, maps each native `targetId` to an existing Page channel in the same BrowserContext, checks `PageDispatcher` ownership and initialization, checks `selectedTabId` against the selected Page list, and requires every context Page to be mapped exactly once. It never creates a wrapper and never falls back to URL/title matching.

### 5.3 Atomic Harbor reconciliation

Before mutating Page state, Harbor resolves the entire relation:

1. validate schema, epoch and sequence;
2. map native facts to existing provider Page objects;
3. validate every known open state is present and every identity pair is unchanged;
4. prove one active selected Page when `activeWindowId` is present;
5. only then commit `native_selected`, `native_active`, native window/tab/target/BCID fields and `PAGE`.

If any validation fails, the last trusted relation remains unchanged and the operation returns unavailable/error. A relation that reports a different Page object for an existing `browsingContextId`, or changes a previously trusted target/tab/window/BCID identity, sets the Driver's relation-invalid latch and fails closed for the rest of that connection. It must not close and reopen a Page to repair the mapping.

## 6. Background creation and safe close

### 6.1 Background Page creation

`newPageInWindow` is allowed only after a complete trusted snapshot identifies the owner Page's native `windowId`:

1. Harbor refreshes and validates the current native relation.
2. TargetRegistry proves the BrowserContext, native window and user-context mapping; the window must already contain a Page owned by that BrowserContext.
3. It calls `TabManager.addTab({ focus: false, window, userContextId })`; it does not call `BrowserContext.newPage()` and does not open a new native window.
4. It waits for the target-created event, then proves target, BrowserContext, window and tab identity are the requested relation.
5. The adapter maps the returned target to the existing Playwright Page channel and waits for initialization; a closed or unknown channel is an error.
6. Harbor registers that exact Page, attaches diagnostics and applies the existing per-Page navigation guard before an optional URL navigation.

The operation must not steal OS focus or silently select a different active Page. If the native snapshot after creation cannot prove the original active relation and the new Page's relation, the result is unavailable; no URL/title-based repair is allowed.

### 6.2 Safe-return close

Harbor may call `closePageWithSafeReturn` only with two live, distinct Pages whose native identities were freshly reconciled. Target and safe return must:

- belong to the same BrowserContext and same native window;
- have live linked browsers and distinct native tabs;
- be present in that window's `gBrowser.tabs` and map back to the same BrowserContext by `userContextId`;
- have exact target/tab/BCID identities matching the trusted Page Registry.

The native primitive then:

1. selects `safeTab` directly through `gBrowser.selectedTab` and waits for `TabSwitchDone`;
2. verifies `safeTab` is selected;
3. calls `TabManager.removeTab(targetTab, { skipPermitUnload: false })`;
4. requires the target to be disposed and returns the exact two input identities.

Direct tab selection does not call `focus()` or `bringToFront()`; closing a Page must not steal OS focus from another application or another browser window. `skipPermitUnload: false` is mandatory: a `beforeunload` veto or dialog failure is surfaced as an unavailable close, never bypassed. If any relation check or safe-tab selection fails, the target is not removed.

The Harbor close path marks the target closed, refreshes the native relation, and requires the safe return Page to be the selected native active Page before returning success. The private primitive does not decide public control lease, idempotency, last-Page, or Run semantics.

### 6.3 Tombstones and stale identity

Every registered Page has one in-memory provider state. Native/external close marks it closed and removes the live object mapping; it is not reopened or assigned a new Page identity. A closed state is exposed internally only after a later trusted snapshot confirms native closure (`native_close_confirmed`). Harbor retains at most `64` confirmed closed Page tombstones; it prunes the oldest confirmed tombstones only after exceeding that limit. Live Pages and unconfirmed closed states are never pruned to make room.

Old public refs, provider handles and document generations remain stale. A new `open_page` creates a new Page object and new public binding; it never revives a tombstone or maps by a similar URL/title.

## 7. Compatibility and failure matrix

| Condition | Required behavior |
| --- | --- |
| Source app, browser, properties, manifest, output hash or patch anchor mismatch | Builder or installed-binding preflight rejects before the test launch; preserve source and Profile. Direct `camoufox-driver.py` launch currently does not parse the manifest and must not be treated as this gate. |
| Artifact is original installed app, production-authorized, or not the fixed test identity | Installed-binding preflight rejects; do not patch or launch it. The direct Driver path must remain behind that preflight. |
| Playwright version/hash/anchor mismatch, symlinked closure, or adapter install failure | Reject before native operation; restore only a separately qualified pair; do not edit `site-packages`. |
| Unknown protocol schema, field type, enum, duplicate identity or unknown active window | Return unavailable/error; no Page state commit. |
| `selectionStatus = partial`, stale sequence, or epoch change | Fail closed; preserve the last trusted relation. A changed epoch/identity does not trigger remapping. |
| Same BCID maps to a replacement Page object | Latch native relation invalid and stop using the connection; never close+open or match URL/title. |
| Background window/context/user-context ownership cannot be proven | Reject creation before adding a tab. |
| Safe target is missing, closed, different window/context, or identity changed | Reject close before removal. |
| `beforeunload` veto, tab-switch timeout, target-created timeout or provider disconnect | Return bounded unavailable/unknown; do not replay a mutating close/create automatically. |
| More than 64 confirmed closed tombstones | Prune oldest confirmed tombstones only; never prune live or unconfirmed states. |

Timeouts are bounded by the private Playwright BrowserContext timeout policy. They are not a public operation setting, are not persisted, and do not authorize a retry or replay of a mutating operation. No failure path regenerates identity, changes Provider, changes proxy, replaces Profile, swaps native binaries or changes the installed package tree.

### 7.1 Legacy and rollback compatibility

The v1 reader is exact-major-version compatible only. A legacy stack without these three native methods and the fixed Page reload patch is not a v1-compatible runtime: the current strict Driver launch/operation must reject it rather than advertise an active single-Page fallback. Historical single-Page behavior may explain an older stack's past capability, but is not an active #504 promise and cannot satisfy v1 multi-Page active mapping, background creation or safe-return close. Harbor must not invent a compatibility mapping.

An owner may roll back before launch by selecting a matching legacy artifact/driver pair. Rollback is outside the running v1 protocol, leaves Profile/source/site-packages unchanged, and does not convert an incomplete v1 live operation into success. A future v2 requires a new versioned contract and an explicit compatible builder/adapter pair.

## 8. Explicit non-goals and evidence boundary

- No native swap, binary patch of the installed Camoufox app, runtime Juggler endpoint, CDP exposure or production/distribution release.
- No public exposure of target/tab/window/BCID identities, native protocol fields, Profile paths or copied package paths.
- No URL/title/creation-order inference, synthetic Page channels, guessed opener relation or cross-window safe return.
- No Network body, Console body, Cookie, account, storage, raw DOM, HAR, screenshot or external proxy/geo readback.
- No public timeout contract, automatic retry/replay, Provider switch, proxy switch, Profile replacement or random regeneration.
- No claim of Windows/Linux compatibility; the qualified builder and artifact in this contract are the pinned macOS Camoufox test path.
- No claim that fixture, builder self-check or adapter unit checks constitute the installed live #504 acceptance. The exact artifact/profile run, required checks, independent review and Issue readback remain the authoritative evidence.

Implementation anchors for this contract are [`camoufox-native-builder.py`](../../services/harbor/scripts/camoufox-native-builder.py), [`camoufox-native-playwright.py`](../../services/harbor/packages/runtime-api/src/camoufox-native-playwright.py), [`camoufox-driver.py`](../../services/harbor/packages/runtime-api/src/camoufox-driver.py), [`copy-camoufox-driver.mjs`](../../services/harbor/scripts/copy-camoufox-driver.mjs) and [`camoufox-native-validation.py`](../../services/harbor/scripts/camoufox-native-validation.py). These files implement the pinned private boundary; they do not replace this specification or turn its current live status into an acceptance claim.
