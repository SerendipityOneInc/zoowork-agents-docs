---
title: 不支持的能力
source: /en/reference/not-supported
source_hash: 3d8043dadc326129ddae47cf54ffdcb2025c9e9184263630ad5c923d609e6365
---

# 不支持的能力

这里没有的东西。每一条都写清楚：你会想拿它建什么、你真去建时实际发生什么、以及最接近的可行替代——或者根本没有替代。

::: danger 不支持
这一页上的任何一条都不是「找对参数就能解决」的问题。这些能力在 API 里就是不存在。如果你的产品依赖其中之一，现在就改设计，别等到第一次集成测试之后。
:::

按你在上面建起一整个产品的可能性排序。就算后面的你只是扫一眼，前三条也要读完。存在的东西见[能力矩阵](/zh/reference/capabilities)。

## 客户端执行的自定义工具 {#client-executed-custom-tools}

**你想建的：** agent 调用一个你定义的工具，你的进程去查你的数据库或你的 API，你把结果交回去，agent 接着把这一回合走完。

**实际发生的：** 没有可以在 agent 上声明的自定义工具类型，也没有 `user.custom_tool_result` 事件可以用来回答。写入侧只接受四种事件类型：`user.message`、`user.interrupt`、`user.tool_confirmation`、`system.message`。

**替代：** 把决策留在你自己的进程里：等 `run.finished`，把活干完，下一个回合再把答案作为 `user.message` 发回去。这条路慢一个回合。唯一另一种能把你的代码放到一个 agent 工具背后的形态是在 agent 上声明**远程 HTTP MCP server**——见[工具](/zh/build/tools)。

## 保险库式的终端用户凭证托管 {#vault-style-end-user-credential-storage}

**你想建的：** 你的每个用户接上自己的 Notion、GitHub 或 Slack 账号，agent 用那个用户的凭证去行动。

**实际发生的：** 没有可供你写入的凭证资源。agent 上的凭证端点通过网关返回 `404`，这是设计如此；平台自己代种模型凭证，别的什么都不暴露。没有 OAuth broker，也没有按 session 注入凭证的机制。

**替代：** 就「按终端用户区分凭证」这件事而言，没有替代——而且今天连一份共享凭证都做不到：MCP server 声明里的 `credential` slug 能被接受，但它指向的存储返回 404，bearer 实际上挂不上去。在你自己的后端做第三方调用，再把结果作为文本传进 session。

## 给 session 附加文件与挂载代码仓 {#session-file-attachment-and-repository-mounting}

**你想建的：** 用户上传一个 CSV，agent 给它画图；或者你挂载一个代码仓，agent 改代码并提 PR。

**实际发生的：** `createSession` 只接受 `initial_events` 和 `metadata`，没别的。没有 `resources[]` 数组，没有 `mount_path`，也没有任何形式的代码仓资源。

**替代：** 部分可行。agent 级的 Files API 能往 agent 的工作区里写，但它是一个 agent 一个工作区，不是一个 session 一个，而且它的后端没有接上持久存储，所以别把它当成权威存储。小的输入直接放进 `user.message` 里。代码仓这件事，没有人验证过 agent 能用 token 通过 bash 克隆一个下来，所以别指望它。

## 交互式 session 上的结果定义 {#outcome-definitions-on-interactive-sessions}

**你想建的：** 开一个 session，把验收 rubric 随第一条消息交给 agent，让它一直迭代到评分器判定达标。

**实际发生的：** `initial_events` 只接受 `user.message`。session 上没有 outcome 类型的事件，session 事件词表里也没有任何「达标 / 未达标」的信号。一次 run 以 `run.finished` 结束，状态是 `succeeded`、`failed` 或 `aborted`，它描述的是这一回合有没有跑完，不是答案好不好。

**替代：** 两条真实路径。**无人值守的 cron 工作**，outcome 门是全套存在的：把 `payload.outcome` 写在 schedule 上——或者在 `resource.outcome` 放一个默认——配一个 `command` 或 `rubric` evaluator，run 会对着它迭代，并且在达标之前扣住发布。见[能力矩阵](/zh/reference/capabilities#automation)。**交互式 session**，在你自己的进程里评分：从 `agent.assistant` 事件里读出 assistant 文本，你想怎么打分就怎么打分，再发一条 `user.message` 继续迭代。这个循环的每一步都是已实测的。

## 端到端的人工审批 {#end-to-end-human-approval}

**你想建的：** agent 提议一个危险动作，你的 UI 弹出一张同意或拒绝的卡片，run 根据这一次点击继续或停止。

**实际发生的：** 零件是分开存在的——`agent.approval` 在事件词表里，`agent.tool` 有一个 `blocked` 阶段，`user.tool_confirmation` 是被接受的写入类型——但从没造出过一个真实的待处理审批，所以这个往返没有任何一环被证明过，而一个在等审批的 agent 会把这一回合耗在等待上。见[能力矩阵](/zh/reference/capabilities#tools)。

**替代：** 在你这边做门控。把危险能力从 agent 的 `tool_policy` 里拿掉，让 agent 用文字描述它想做什么，在你自己的 UI 里做决定，再把结果作为 `user.message` 发回去。

## 跨 agent 的顶层 session 列表 {#top-level-session-listing-across-agents}

**你想建的：** 一个收件箱，按时间倒序列出你所有 agent 下的每一段对话。

**实际发生的：** 没有顶层的 session 集合可调。`listSessions(agentId)` 能读一个 agent 下的 session——按 `updated_at` 最新在前，每页 50，`page` 从 1 开始，没有游标——而我们没有驱动过它。它仍然要求你跨 agent 扇出再手动合并。

**替代：** 把你自己的代码创建的 `session_id` 记下来，连同 `agent_id` 和它属于哪个用户。你的数据库就是索引。这件事第一天就该做，因为事后没有任何办法把它重建出来。

## 一个记忆存储资源 {#a-memory-store-resource}

**你想建的：** 一个几个 agent 共享的知识库，或者一份你能做版本、能审计、能回滚的记忆。

**实际发生的：** 没有记忆资源，没有挂载，没有版本，没有后台的记忆整合进程，也没有任何跨 agent 共享的东西。模型可能有仅属于单个 agent 的记忆工具，但它们可以在部署层面被关掉，而且在 API 上不可见。在 `persona.docs` 里声明 `MEMORY.md` 或一个 `memory/` 路径，返回 `400 invalid_persona_doc_name`。

**替代：** 状态放你自己的数据库，在一个回合开始时用 `system.message` 把要紧的注入进去。模型在下一个回合读到它，而审计记录和回滚都留在你手里。

## 平台签名的 webhook {#platform-signed-webhooks}

**你想建的：** run 结束时平台往你的服务器发一个请求，你在收到的投递上验签。

**实际发生的：** 没有 webhook 资源，没有签名密钥，也没有投递配置。定时任务的 `delivery` 字段只接受 `none` 和一种带类型的 `announce`；webhook 投递会被拒。

**替代：** 挂住 SSE 流，或者用 `after` 轮询 `listEvents`——每一帧都带一个持久的 `seq`，服务端会从它开始重放，掉一次连接不花你任何代价。

## Agent 版本固定与回滚 {#agent-version-pinning-and-rollback}

**你想建的：** 把百分之十的流量切到配置 v3 的灰度，或者一次调用回滚到上一个版本。

**实际发生的：** `config_version` 每次 PUT 都会涨（见[错误](/zh/reference/errors)），但没有任何路由能列出版本、取回旧版本，或者把一个 session 固定到某个版本上。

**替代：** 你 PUT 过的每一份配置自己留一份，这样回滚就是把上一份 body 再 PUT 一次。要做灰度，就跑两个配置不同的 agent，在你自己的代码里分流。

## 自托管的工具执行 {#self-hosted-tool-execution}

**你想建的：** 工具跑在你自己的机器上，平台把活派发给你运维的 worker。

**实际发生的：** 没有 worker 注册，没有任务队列，也没有 environment key。工具只在托管沙箱里跑。Environment 能让你预装包、设一份网络白名单，但执行仍然留在平台上。

**替代：** 远程 HTTP MCP server 是唯一能把执行挪到你这边的形态——已实测，但只支持无鉴权的 server。你的代码要做的其他一切，都属于你自己的进程，在 session 外围，不在 session 里面。

## 其他同样不存在的 {#also-absent}

更小的缺口，规则一样：它们不存在，所以别把计划建在它们上面。

| 缺什么 | 要知道的 |
|---|---|
| 命令行工具 | 只有 TypeScript SDK。 |
| 按 session 覆盖工具或 MCP、session 创建时的 `agent_with_overrides` | `createSession` 只收 `initial_events` 和 `metadata`，没别的。session 上的 PATCH 通过网关返回 `405`。所以既没有覆盖的通路，也没有 `patchSession`。 |
| `session.status_*`、`span.*`、`stop_reason` 事件 | 不在词表里。用 `run.finished` 和它的 `payload.status`。 |
| 从全局目录安装 skill | `404`。全局 skill 在 agent 创建时就已经挂上了。 |
| environment 里的 cargo、gem 或 go 包 | 只有 apt、npm 和 pip。 |
| 凭证 API；Environment secret、运行时环境变量、沙箱启动钩子 | 平台为它自己的内置技能注入凭据，那条通道不对你开放；environment 配置也不收 secret、环境变量和启动钩子。你自己的密钥留在你自己的服务里。 |
| 定时任务的暂停与恢复、归档、跨定时任务的运行历史、删除 agent 时自动清理定时任务 | 没有——删掉重建，运行记录一次读一个定时任务。定时任务在停止和删除之后都还活着，你得先自己删掉。 |
| 文件的 SDK 方法 | 文件路由在线协议上存在，但后端没有接线；`ZooclawClient` 对它什么都没暴露，所以你得用自己的 `fetch` 调。artifact 从 0.0.6 起进了 client（`listArtifacts` / `getArtifact` / `downloadArtifact` / `deleteArtifact`）；审批、定时任务、environment、session 的归档与删除从 0.0.5 起就在——见[能力矩阵](/zh/reference/capabilities)。 |
| 从你自己的代码轮换或吊销 key | 没有 API。ZooClaw App 的 **设置 → API Keys** 可以立即轮换或吊销一把 key，新密钥只显示一次。 |
| 按 scope、按用户或只读的 API key | 只有一个组织级的 key，对组织内每一个 agent 都有完整的读写权限。 |
