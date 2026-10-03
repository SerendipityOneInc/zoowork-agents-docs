# Quickstart 与 Claude 的对应关系

参照：2026-09-11 读取的 [Claude Managed Agents Quickstart](https://platform.claude.com/docs/en/managed-agents/quickstart)。
本次范围是 Quickstart 文档；下列 SDK/API 项目是后续建议，没有实现或发布新接口。

## 页面结构

沿用 Claude 的顺序：简介 → 核心概念 → 前置条件与安装 → 创建第一个 Session（分步调用）→ 执行过程说明 → 下一步。
ZooWork 的清理操作放在末尾，示例只完成一个销售报告任务。TypeScript 代码按页面顺序拼成 `quickstart.mts`，直接用 `node quickstart.mts` 运行；curl 在同一个 Bash 终端逐块执行。

已重新逐块核对官方 Markdown 中的 TypeScript 示例：Claude 创建 Agent 时只导入 `Anthropic`。ZooWork 对应步骤只导入当前需要的 `createZooworkClient`；`assistantText`、`toolCall`、`isRunFinished`、`runOutcome` 在读取事件流的代码块才引入，不集中放进第一步。

## 保留的差异及原因

| 差异 | 原因与本次处理 |
|---|---|
| 只提供 TypeScript 和 curl | 本轮明确不增加 Python SDK 或 CLI。TypeScript 的 Node.js 口径统一为 22.20+。 |
| 安装区只保留 SDK 安装命令 | 示例使用 Node.js 22.20 已支持的原生类型擦除，`.mts` 明确使用 ES module，因此不需要 `npm init`、`npm pkg set type=module` 或 `tsx`。见 [Node.js 22.20 TypeScript 说明](https://nodejs.org/download/release/v22.20.0/docs/api/typescript.html#determining-module-system)。 |
| 使用销售报告任务 | 避免在 API 调用语言之外引入 Python。保留工具操作文件、读取结果的演示。 |
| 使用默认 Environment | ZooWork 当前可使用默认沙箱，无需为入门任务单独创建 Environment。自定义配置链接到已有文档。 |
| 显式启动 Agent | ZooWork 的 Session API 要求 `status.desired_state` 为 `running`。当前 Engine 的 `startAgent` 在返回前提交该状态，因此示例仅等待启动请求成功，不额外调用 `waitUntilRunning()` 或用 curl 查询状态。此状态不代表沙箱已创建；默认沙箱由运行时按需创建或复用。 |
| 创建空 Session 后发送消息，再读取流 | 对应 Claude 的会话与消息分步教学。ZooWork 会保存事件；新会话的默认事件流可以回放已发送消息后的进度。当前 `streamEvents()` 是惰性异步生成器，创建生成器本身不代表连接已打开。 |
| 以 `run.finished` 和 `payload.status` 判断结果 | ZooWork 的回合结束事件不是 Claude 的 `session.status_idle`。示例使用实际协议并区分 `succeeded`、`failed`、`aborted`。 |
| curl 提供原始 SSE 请求 | Claude 当前在发送消息与流处理步骤引导使用 SDK。本页保留完整的 curl 调用路径，用直接请求、原始输出和 Ctrl+C 展示，不实现 Shell 事件解析器。 |
| TypeScript 显式关闭流 | 当前 SDK 的流读取退出后需要显式取消 HTTP 请求。示例保留 `AbortController` 和 `finally`，避免连接占用；没有加入重连和超时框架。 |
| 末尾停止再删除 Agent | ZooWork 单独删除 Agent 不等于释放其沙箱。curl 通过 `&&` 保证停止失败时不继续删除；TypeScript 按顺序 await。错误提前退出时根据打印的 ID 手动清理。 |

## 后续 SDK/API 对齐项

| 优先级 | 建议 | 当前证据与边界 |
|---|---|---|
| 优先 | SDK 流对象在循环 break/return 时自动释放 reader 和 HTTP 连接，提供明确的关闭方式 | 已核对本地 `src/sse.ts`、`src/client.ts`，并用已发布 SDK 0.5.2 的本地 HTTP fixture 验证当前示例通过显式 abort 关闭连接。这样后续 Quickstart 可以去掉 controller/finally。 |
| 后续 | 提供 `agents`、`sessions`、`sessions.events` 等资源分组入口 | 当前使用 `createAgent`、`createSession`、`postEvents`、`streamEvents`。可逐步增加兼容入口；本页不提前使用尚不存在的方法。 |
| 后续 | 明确流建立时机与类型化事件访问方式 | 当前异步生成器在开始迭代时才发起请求，事件使用 `eventType` 和 payload。若希望采用 Claude 的“先打开流、再发送消息”代码形式，需要明确可等待的连接建立接口。事件语义仍需保持 ZooWork 的真实契约。 |

本次 Quickstart 没有缺失的 SDK/API 阻塞项。curl 需要 Bash、curl 7.76+ 和 jq 1.6+；这些是本机工具依赖。

## 验证范围

- 使用已发布 SDK 0.5.2，在 Node.js 22.20 上对拼接后的 TypeScript 示例做类型检查和本地 HTTP/SSE 验证。
- 简化安装后，在仅安装 SDK 的新目录中，用 Node.js 22.20 直接运行生成页面拼接出的 `quickstart.mts`，本地 HTTP/SSE 成功流程通过；该目录没有 `type` 设置，也没有安装 TypeScript 或 tsx。
- 本地检查覆盖 TypeScript 成功、回合失败、事件流提前关闭、消息未接受、停止失败。
- 在真实 PTY 中运行 Bash/curl 示例，覆盖 Ctrl+C 关闭事件流后保留 ID、继续清理，以及停止失败时不删除。
- 中英文 HTML 的 18 个代码块与生成的 Markdown 一致；检查 llms.txt、llms-full.txt 和构建结果。
- 预览发现并修复标签同步问题：恢复 curl 选择时同时恢复对应代码块，避免标签显示 curl 而内容仍是 TypeScript。浏览器检查覆盖刷新恢复、单处切换同步全部 8 组代码，以及中英文跨页保留选择。
- 未使用真实 API Key，未调用真实 ZooWork API；报告内容和输出仍需真实环境验证。未发布文档或 SDK。
