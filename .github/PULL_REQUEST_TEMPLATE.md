## 改变的真实路径

-

## 规则与复用

- 规则 owner／是否新增重复：
- 复用或删除：
- 临时兼容层消费者与退出条件（无则 N/A）：

## 风险与验证

- 防御的风险、作用域和用户处理入口：
- 已运行检查与结果：
- 未验证部分、影响范围与回退：
- Work Item 与规范章节：

Python 编译检查使用 `make py-compile` 或 `python3 tools/py_compile_clean.py ...`，不要在 checkout 中直接运行会生成缓存的裸 `py_compile`。
