## 改变的真实路径

-

## 规则与复用

- 规则 owner／是否新增重复：
- 复用或删除：
- 临时兼容层消费者与退出条件（无则 N/A）：

## Design Obligations

- Owning Work Item／FR：
- 适用基础 ADR／Spec：

| Trigger | disposition | artifact／理由 |
| --- | --- | --- |
| `DO-PLUGIN-EXPOSURE` | `triggered` / `conditional` / `not-triggered` | |
| `DO-GRANT-WIRE` | `triggered` / `conditional` / `not-triggered` | |
| `DO-NETWORK-CONTRACT` | `triggered` / `conditional` / `not-triggered` | |
| `DO-CONSOLE-CONTRACT` | `triggered` / `conditional` / `not-triggered` | |
| `DO-PROVIDER-PRIVATE-SCHEMA` | `triggered` / `conditional` / `not-triggered` | |
| `DO-APP-IA` | `triggered` / `conditional` / `not-triggered` | |

判定规则见 [`docs/specs/README.md`](../docs/specs/README.md)。`not-triggered` 必须写具体理由；`conditional` 必须写转为 `triggered` 的条件；已经触发的 artifact 未合并前不得把对应 Work Item 标记为 completed。

- 是否新增/改变稳定跨进程 API、MCP／Plugin tool projection、wire payload、持久字段、enum、Grant 维度或 Provider-private versioned config：
- 如是，对应正式 spec／schema／migration：

## 风险与验证

- 防御的风险、作用域和用户处理入口：
- 已运行检查与结果：
- 未验证部分、影响范围与回退：
- Work Item 与规范章节：

## Exact-head 独立审查

- Exact head SHA：
- 独立审查证据：
- 结论：`APPROVE` / `REQUEST_CHANGES` / pending

单账号开发无需为了形式制造第二 GitHub 身份。无法使用不同账号原生 `Approve` 时，与实现执行者分离的审查会话／进程／工作树可以在 PR 顶级评论中记录 exact head SHA、审查范围、实际读取/运行的检查、findings 和明确结论；该评论可替代原生 Approve。实现执行者自己的自审不能替代独立审查。

Python 编译检查使用 `make py-compile` 或 `python3 tools/py_compile_clean.py ...`，不要在 checkout 中直接运行会生成缓存的裸 `py_compile`。
