# Runtime Continuity V1 verification

状态：2026-09-14，#526 的确定性实现与合同证据；不替代正式安装、Provider live 或真实 Agent 验收。

本记录覆盖官方 public Playwright async Driver 的 Runtime 连续性边界。所有
Playwright 对象由同一个 owning asyncio event loop 使用；stdin reader 只在
`asyncio.to_thread` 中读取字节，普通 Provider 操作仍在一个串行 command lock
内执行，owner `close` 走独立 lifecycle consumer。

## 已验证边界

- 普通 JSONL 输入有界：单一 ordinary consumer 串行处理一个在途命令，缓冲
  queue 为 `MAX_PENDING_COMMANDS - 1`（63），因此缓冲+在途总数严格不超过 64；
  队列满时拒绝新的普通行并返回带原 `id` 的 error，reader 不会因普通队列满而
  错过后续 close 或 EOF。
- close 独立可达：close queue 为单项有界队列，不等待 ordinary consumer；它通过公开
  `BrowserContext.close()` 中断仍在 Provider 中的 wait/file operation。未派发的
  普通请求返回 `not_dispatched`，已进入 Provider 的 wait 超时返回
  `status: unavailable`、`dispatch_state: dispatched`，不得重放。
- EOF 先立关闭屏障：reader 发布 EOF sentinel 后，主 loop 先设置 closing、关闭
  public Context，再等待 close consumer、ordinary consumer 和已派发任务，保留其
  真实 JSONL 结果；不会在 sentinel 尚未入队时取消 reader。
- 下载取消保持隔离：deadline/quota/owner close 先调用公开 `Download.cancel()`；
  不取消在途 asyncio/Playwright task。取消或 action 未在 bounded grace 内收敛时，
  再调用公开 Context close，保留 pending task、监听器和 task-owned 临时空间，
  并以 `driver_closing` fence 拒绝复用，直到 deferred cleanup 收敛。
- close 失败保持隔离：公开 `Context.close()` 或 `playwright.stop()` 的原始错误写入
  sticky lifecycle state；失败的 Context/Playwright 资源留在 closing 槽位，后续
  Driver/TypeScript owner stop 重复调用仍返回同一错误，不释放 ephemeral Profile。
- Core handoff 关联：Runtime Session 在 mutating Provider operation 在途时先建立
  handoff intent、递增 control generation 并拒绝新的 Agent input；passive wait
  不制造伪造的 Provider clear hook。旧结果保持 `unknown_outcome`/
  `dispatched`，交还后必须重新取得 fresh Page observation。

## 可重复证据

证据源码位于：

- `services/harbor/packages/runtime-api/src/camoufox-upstream-driver.py`
- `services/harbor/packages/runtime-api/src/camoufox-upstream-driver.ts`
- `services/harbor/packages/runtime-api/src/camoufox-upstream-driver.test.ts`
- `services/harbor/packages/runtime-api/src/runtime-session.ts`
- `services/harbor/packages/runtime-api/src/index.ts`
- `services/harbor/packages/runtime-api/src/control-interaction.test.ts`
- `services/harbor/packages/runtime-api/src/managed-interaction.test.ts`

在 `services/harbor` 下运行：

| 检查 | 结果 | 覆盖 |
| --- | --- | --- |
| `python3 -m py_compile packages/runtime-api/src/camoufox-upstream-driver.py` | pass | Python async bridge 语法 |
| `pnpm --filter @webenvoy/harbor build` | pass | TypeScript build、Driver bundle copy |
| `node --test dist/packages/runtime-api/src/camoufox-upstream-driver.test.js` | pass，20/20 | public async Driver、Download cancel/cleanup、bounded queue、close/EOF、sticky close failure 与 TS owner stop |
| `node --test dist/packages/runtime-api/src/control-interaction.test.js` | pass，12/12 | control/handoff generation 与 settling fence |
| `node --test dist/packages/runtime-api/src/managed-interaction.test.js` | pass，10/10 | Core unavailable+dispatched wait、no replay、Page/lease/handoff |

这些检查使用 deterministic fakes，不启动浏览器、不访问账号或生产站点，也不把
fixture 结果提升为 `installed`、`live` 或 `plugin_verified`。正式 Provider 安装、
真实 Agent 和运行时材料应另以带 source/tree/manifest/实际读回的证据记录。
