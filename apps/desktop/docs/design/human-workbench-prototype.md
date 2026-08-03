# Human Workbench High-Fidelity Prototype

## Status

This is the interactive high-fidelity prototype for App #305. It uses sample
data and does not connect to Core, Harbor or Lode runtime services. It is an
isolated Vite entry and does not change the production renderer entry.

User approval is the product Gate. Build success, automated checks, a PR or a
Loom review cannot replace that approval.

## Approved Baseline

- Status: `approved`.
- Approval source: 2026-07-19 当前 Codex 任务中用户明确回复“批准当前用户故事和高保真原型，继续目标”。
- Approved prototype: `prototype.html` and `src/renderer/prototype/**` at head
  `ddcd13d6cb556cfbe65a72f466d9f12992d438fc`.
- Frozen scope: canonical IA, Story scenarios S1-S34, and the visual and
  interaction baseline at that head.
- This approval allows production UI Work Item planning. It does not approve a
  production implementation or prove live Core, Harbor or Lode runtime behavior.

## Run

```bash
npx vite --config vite.prototype.config.ts
```

Open `http://127.0.0.1:5174/prototype.html`.

## Review Journeys

1. Work results: open collection, readable content, download and not-submitted
   write results. For batch data, select applicable rows and confirm the action
   summary and per-item success, failure or skipped outcome.
2. Work navigation: hover or focus the task-list heading, open its overflow
   menu, and switch grouping between Site Skill and Account Identity or sorting
   between priority and recent update; confirm every view shows the same
   threads, preserves the selected thread, and uses the left-edge rail to move
   between task turns without replacing center or right-panel content.
3. Task turns: confirm the center shows every turn in chronological order, with
   each business input followed by a collapsed `正在执行` or `已处理` action record
   and its business result or unresolved state. Expand the action record to inspect
   atomic page actions; waiting and partial outcomes remain honest.
4. Result consumption: inspect the App-owned collection, article, media/file and
   write-result components in the center. Open the Taobao product result to view
   the skill-provided `商品对比` surface in the right panel, verify its skill source
   and view version, then switch to the retained structured JSON. Trigger a view
   action and confirm it returns to the App execution flow; simulate an unavailable
   view and confirm the standard result remains usable.
5. Work creation: open the empty task page, choose a recommended Account Identity
   + Site Skill combination or make both compatible selections manually, complete
   the skill-declared fields and create the sample task.
6. Thread input: while a turn runs, keep the Composer and next draft visible but
   disable submission. Switch threads and restart the prototype to check per-thread
   draft restoration, attachment revalidation and clearing only after acceptance.
7. Account Identity: inspect independent login, environment, instance, Provider
   and health facts, edit the identity, and manage its environment from one surface.
   Verify target-specific proxy checks before saving, then delete an identity using
   each deletion option and confirm historical threads become read-only with a route
   to choose a compatible identity for a new thread.
8. Identity creation: confirm the center toolbar does not repeat the current
   create action; switch between login-required and no-login flows. The former
   requires a target URL and offers `创建环境并去登录`; the latter requires only a
   local name. Use one-click randomization, then expand Advanced Settings to
   inspect the coherent device tuple without changing proxy or geography.
9. Provider recovery: in Environment Dependencies, verify the Harbor-managed path
   can install or repair and validate launch; a system-installed Provider can be
   located and rechecked; an externally managed Provider opens its manager and is
   rechecked after return. None becomes available before its own validation passes.
10. Human takeover: open `读取收藏夹中的竞品笔记`, take over in the browser, then
    verify both successful validation and the failed-validation exits for retry,
    another takeover or termination.
11. One-time execution decision: reach an action whose effective mode is `确认`,
    inspect its business target, allow it once, then repeat with refusal. Confirm
    each decision expires with the action and changes no thread, skill or global setting.
12. Empty, failed and unknown results: inspect one empty result and one hard failure,
    use their input, login, retry or termination recovery actions, and confirm an
    unknown state passes through checking, may remain unknown, and can be explicitly
    terminated without being presented as success or failure.
13. Library: filter by site and business tag, open a skill, and use `去使用`. Review
    an update that adds or reclassifies an action and confirm the user must adopt or
    revise its recommended execution mode before installation. Disable the skill,
    verify task creation is unavailable, then enable it again.
14. Missing identity: use the Taobao skill, create a Taobao identity, and confirm
    the prototype returns to the original task form with that identity selected.
15. Execution modes: change the global default in Settings, `我的技能默认` in
    Library, and the current-thread choice in Work; confirm a one-time decision is
    available only when a specific action with effective mode `确认` is imminent.
16. Reconnection: interrupt the App or network during an active turn, return to
    the thread and confirm it reads the owner state before offering retry. While the
    state is unknown, preserve the turn and draft, disable submission and do not run
    the accepted input again.
17. Write revision and action history: restore a prepared write result into the
    Composer, revise its structured fields, then continue to publish. Confirm the
    turn retains both the prepare and publish execution mode/source records.
18. Settings: click the avatar/name entry, then inspect execution defaults,
    Connections and Technical Logs as separate pages.
19. Keyboard and narrow windows: complete task creation, one-time decision, human
    takeover, turn navigation and result preview by keyboard. At 200% zoom and at
    or below 720px, confirm focus stays visible and the right preview opens full-width
    or over the center without making the primary task controls unusable.

## Deliberate Product Corrections

- Reuses the existing Codex-like shell, density, toolbar and list grammar, not
  the current page hierarchy or status-heavy composition.
- Business results are the default Work body. Source facts are compact and
  execution details are collapsed.
- Work uses the existing Codex-like three-panel shell for task detail: grouped
  threads on the left, multiple task turns and business results in the center,
  and a generic multi-tab artifact preview on the right.
- The current task thread owns the center timeline. The center keeps all task
  turns in chronological order and each turn follows
  business input -> collapsed atomic action record -> business result or unresolved
  state. Raw parameters, repeated internal events, logs and traces stay out of the
  default timeline; actual technical logs use a separate entry. The rail only
  navigates this timeline; the right preview opens only from an explicit center action.
- A Task Thread is fixed by Site Skill + Account Identity. The left navigator
  can project the same threads by Site Skill or by Account Identity; switching
  grouping or sorting preserves selection and does not duplicate task facts.
- Task grouping and sorting live in the list-heading overflow menu. The heading
  reveals overflow and new-task actions on hover or keyboard focus, following
  the existing Codex-like project-list interaction instead of showing a
  persistent segmented control.
- Work, Browser and Library are the only primary product domains.
  Settings is a utility destination opened from the user identity area.
- Account Identity keeps site-account facts, instance actions and environment
  management together. Provider installation and repair live in a sibling
  Environment Dependencies tab.
- Account Identity creation separates login-required and no-login environments.
  Login-required creation starts from a target URL and opens the isolated
  browser; no-login creation uses a local name and is admitted only to skills
  that do not require login. CloakBrowser-compatible device settings support a
  coherent one-click random preset, while detailed fingerprint fields remain
  collapsed by default. A no-login identity remains bound to its selected site.
  Import records the selected local source and blocks incompatible Providers.
- Removing an Account Identity does not mutate historical task facts. Each affected
  thread records whether only the App entry or the local environment was removed,
  disables further submission, and offers a compatible-identity recovery route.
- Harbor/CloakBrowser profile and session research informs the independent
  login, environment, instance, Provider and health facts. Raw paths,
  endpoints and full fingerprint fields remain folded into technical detail.
- Task creation is generated from Site Skill inputs rather than an open prompt.
- Structured output remains the durable result. App-owned renderers cover common
  result types and retain a generic fallback; a Site Skill may optionally provide
  a richer right-panel view. The prototype uses a trusted fixture to demonstrate
  that composition and does not implement the production sandbox or resource
  protocol.
- Execution modes are configured at their owner surface: global defaults in
  Settings, `我的技能默认` in Library, current-thread changes in Work, and one-time
  allow or refuse only when a confirming action is about to run.
- A turn keeps ordered execution records per concrete business action. A publish
  action appends its own effective mode and source instead of replacing the earlier
  prepare record.
- Evidence refs, endpoints, raw runtime facts and owner explanations are not
  part of the default product surface.
