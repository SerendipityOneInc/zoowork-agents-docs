---
title: 能力矩阵
source: /en/reference/capabilities
source_hash: 14e55a2f45b1e84a05b43d6bfaac28ad9536c0ae30a24ccec92c7c07f7ca78d6
---

# 能力矩阵

哪些能用、哪些存在但从没被驱动过、哪些根本没有。一行一个能力，那条真正要紧的提醒写在说明列里。

敲定架构之前先读这一页。缺口的分布并不均匀：agent–session–event 这条核心链路是扎实的、跑过的，而它周边的好几个资源，只是我们读过的路由，没有真跑过。

## 验证级别

| 级别 | 含义 |
|---|---|
| **已实测** | 我们在一套真实部署上跑过，并观察到了结果。这里大部分行来自一个可重放的 harness：它建一个一次性 agent，走完整个生命周期，再把它删掉。 |
| **可用，未实测** | 路由存在，契约也有文档，但我们没有驱动过它。它可能完全按描述工作。把它当成你还得自己做的活儿，别放进你的演示路径。 |
| **不存在** | 它就是没有。[不支持的能力](/zh/reference/not-supported)会说明改用什么。 |

所有标着**已实测** 的，都是 2026-08-06 在一套真实部署上、通过公开网关、用一个组织 API key 观察到的——和你的 key 走的是同一条路径。这里没有任何一条是仅凭规范推断出来的。

如果某一行写着已实测，而它在你这边失败了，那是一次回归，值得报上来。如果某一行写着可用，未实测，而它在你这边失败了，那是你先于我们拿到了答案。

## Agents

| 能力 | 状态 | 说明 |
|---|---|---|
| `listModels()` | 已实测 | 返回你的组织能选的模型别名目录。检查一个 key 是否可用最便宜的方式：它不碰任何 agent，也不创建任何东西。提交别名（`litellm/...`），永远不要提交厂商的模型名。 |
| `createAgent()` | 已实测 | 返回一份**扁平的创建回执** ，`config_version` 在顶层。网关会用你 key 自己的锚点覆盖你传的 `ownership`，所以传占位符就行。 |
| 创建时的 `Idempotency-Key` | 可用，未实测 | 这个 header 会被接受。我们从没用同一个 key 重放过一次创建来观察去重，所以别假设重试是免费的。 |
| `getAgent()` | 已实测 | 返回的**结构和创建时不一样** ：配置在 `declared` 下，版本在 `status.config_version`，顶层既没有 `config_version` 也没有 `name`。读版本请写 `agent.status?.config_version ?? agent.config_version`。 |
| `startAgent()` | 已实测 | 必须调。新 agent 是 `stopped`。`desired_state` 会在远不到一秒内翻成 `running`。返回里的 `channel_routes_reload_failed` 警告在纯 API 的 agent 上是正常噪声，不是失败。 |
| `stopAgent()` | 已实测 | 亚秒级。之后 `createSession()` 返回 `409 agent_not_running`。 |
| 用 `status.desired_state` 把关就绪 | 已实测 | 唯一正确的就绪信号。轮询到它是 `running` 为止。 |
| 用 `status.actual_state` 把关就绪 | 不存在 | `actual_state` 报的是聊天渠道的连通性，不是 API 是否就绪。纯 API 的 agent 没有任何渠道，所以它永远停在 `activating`，`active` 到不了。`running` 甚至根本不在它的枚举里，所以等它的循环永远不会返回。 |
| `updateAgent()` | 已实测 | **按小节合并** 。你省略的小节会被保留：只带 `labels` 的一次 PUT 不会动 `name`、`model` 和 `persona`。 |
| `tool_policy` 整体替换 | 可用，未实测 | 文档把它写成合并规则的例外：每一次 PUT 都整体替换 `tool_policy`，`{}` 会恢复完整的工具清单。我们只在其他小节上跑过合并行为。 |
| 把 `config_version` 当幂等回执 | 不存在 | 每一次成功的 PUT 都会 bump 它，值完全相同的 PUT 也一样。创建时的凭证代种还会再多 bump 两次，所以创建回执上的 `1`，到你第一次 `getAgent()` 时已经是 `3`。它是一个变更计数器，不是内容哈希。 |
| `deleteAgent()` | 已实测 | 软删除。它不停止 agent，不删除它的定时任务，也不释放它的沙箱。先调 `stopAgent()`，定时任务自己删。 |
| 列出 agent | 可用，未实测 | 线协议上的路由把 `owner_uid` 加 `org_id` 当成精确 AND 选择器，所以同一组织内由另一个 key 创建的 agent，能按 id 读到，却永远不会出现在你的列表里。SDK 没有暴露 `listAgents()`。id 自己记一份。 |
| 其他组织的 agent id | 已实测 | 返回 **404** ，不是 403。存在性被隐藏，所以 404 不代表「已删除」。 |
| key 无效或缺失 | 已实测 | `401`，`error.type` 是 `service_token.invalid`。匹配 `ZooclawError.status` 和 `.type`，永远不要匹配报错文本。 |
| `persona.docs[]` | 可用，未实测 | 只有带内联 `content` 的条目会被存下来。`MEMORY.md` 和任何 `memory/` 名字会被 `400 invalid_persona_doc_name` 拒绝。规范名字集合之外的文档会被保存，但不会被组装进提示词。 |
| 固定 `environment_id` / `environment_version` | 可用，未实测 | 创建时接受写在 `resource` 顶层，PUT body 里也接受。只给版本是 `400`。 |
| 创建时的 `warm: true` | 可用，未实测 | 表示在创建时预热沙箱。后端接线缺失的地方，创建照样成功，预热静默变成空操作。 |
| `heartbeat` 小节 | 可用，未实测 | 见[自动化](#automation)。 |
| Agent 版本历史、固定、回滚 | 不存在 | 没有任何路由能列出或取到过去的 `config_version`，也没有任何东西能把一个 session 固定到某个版本上。 |
| `putCredential()` / `listCredentials()` | 不存在 | SDK 接口上有，通过网关一律 `404`，这是设计如此。平台自己代种模型凭证。 |

## Sessions

| 能力 | 状态 | 说明 |
|---|---|---|
| `createSession(agentId, input)` | 已实测 | session 是 **agent 的子资源** ：`POST /agents/{id}/sessions`。从顶层 `/sessions` API 移植过来的代码，在这个 SDK 上编译不过。 |
| 带 `user.message` 的 `initial_events` | 已实测 | 这里只接受 `user.message`，最多 50 条。 |
| session 创建时的 `Idempotency-Key` | 已实测 | 有效。用同一个 key 重试创建是安全的。 |
| `409 agent_not_running` | 已实测 | 稳定，可以按 `error.type` 匹配。跳过 `startAgent()` 拿到的就是它。 |
| `getSession()` | 已实测 | 这条路径上 `status` 回来是 `null`；run 的状态在 `run_status` 里。响应里还带一个 `pending_approvals` 计数。 |
| `getSession({ history: true, limit })` | 已实测 | `history[]` 的每一行是 `{ seq, entry_type, entry, created_at }`。`entry_type: 'message'` 时，文本在 `entry.message`。这是唯一能看到 token 用量和实际作答模型的地方。 |
| 创建时的 session `metadata` | 可用，未实测 | 创建时会被接受；我们没有断言它能原样读回来。 |
| 列出一个 agent 下的 session | 可用，未实测 | 有一条分页路由（固定每页 50，最新在前）。SDK 没有暴露对应方法。 |
| 归档、软删除、PATCH metadata | 可用，未实测 | 路由存在。PATCH 只是对 `metadata` 的浅层替换；发 `tools` 或 `mcp` 返回 `501 reserved_for_session_overrides`。这三个 SDK 一个都没暴露，所以你得用自己的 `fetch` 调。 |
| 跨所有 agent 列出 session | 不存在 | 没有顶层的 session 集合。 |
| `resources[]`、文件挂载、`vault_ids`、`agent_with_overrides` | 不存在 | `createSession` 只收 `initial_events` 和 `metadata`。没别的了。 |

## 事件与流式

| 能力 | 状态 | 说明 |
|---|---|---|
| 带 `user.message` 的 `postEvents()` | 已实测 | 多回合可用：agent 在同一个 session 里记得起之前的回合。 |
| 对进行中的 run 发 `user.interrupt` | 已实测 | 返回 `accepted: true`，run 以带 `status: 'aborted'` 的 `run.finished` 结束。在我们那次运行里大约花了 20 秒才生效，所以别指望立刻停下。 |
| 没有 run 在跑时发 `user.interrupt` | 已实测 | `202`，`accepted: false`。那是一次空操作，不是错误。不要当成失败处理。 |
| `system.message` | 已实测 | 会被接受，模型在**下一个** 回合的上下文里拿到它。一条带外注入通道，Claude Managed Agents 里没有对应物。 |
| `user.tool_confirmation` | 可用，未实测 | 作为写入侧类型会被接受。文档里的 body 是 `{ type, approval_id, decision }`，`decision` 取 `allow-once`、`allow-always` 或 `deny`；其他结构会被拒。我们从没造出过一个真实的待处理审批，所以这个往返没有被证明过。 |
| 其他任何写入侧事件类型 | 不存在 | 写入面就是四种类型：`user.message`、`user.interrupt`、`user.tool_confirmation`、`system.message`。 |
| `listEvents()` | 已实测 | 服务端默认 100，最大 500，**一次调用只给一页** 。长 session 会静默截断，不报错。用 `after` 翻页，直到返回的行数少于你的 limit。 |
| `listEvents()` 上的 `types` 过滤 | 已实测 | `?types=agent.assistant` 会按预期收窄结果。 |
| `streamEvents()`（SSE） | 已实测 | 这个流是 **session 级** 的：一个回合结束时它不会关闭。用 `isRunFinished` 判断一个回合的结束。session 转入空闲后，服务端才关掉连接。 |
| 用 `?after=<seq>` 续传 | 已实测 | 每个 SSE 帧的 `id:` 行里都带一个持久的 `seq`，服务端会从那个 seq 开始重放。重连不花你任何代价，也不需要客户端去重。 |
| 用 `Last-Event-ID` 请求头续传 | 可用，未实测 | 文档说它等价。SDK 用的是 query 参数，那才是我们跑过的路径。 |
| `?deltas=` 增量预览 | 可用，未实测 | 是**快照替换** 语义，不是前缀追加：每一帧都是到目前为止的全文。把它们拼起来会得到重复的文本。delta 通道没接线的地方返回 `501 not_configured`。SDK 会跳过这些帧。 |
| 用 `run.finished` 判断回合结束 | 已实测 | `payload.status` 是 `succeeded`、`failed` 或 `aborted`。 |
| `agent.tool` 的 `start` 和 `end` 阶段 | 已实测 | 一次调用产生两个事件，共享同一个 `toolCallId`。调用并发时它们并不相邻，所以按 id 配对，不要按位置配对。 |
| `agent.tool` 的 `blocked` 阶段 | 可用，未实测 | 第三种阶段，含义是这次调用正在等审批、还没有执行。把它当成待定，永远不要当成结束。 |
| 工具失败不会让 run 失败 | 已实测 | 带 `isError: true` 的 `agent.tool` 之后，照样跟着一个 `succeeded` 的 `run.finished`。永远不要用「没出现工具错误」推断一个回合成功。 |
| `agent.approval` | 可用，未实测 | 在事件词表里。我们没有观察到过。 |
| 同一个事件的两种线格式拼写 | 已实测 | REST 返回 snake_case（`event_type`、`run_id`、`created_at`），SSE 返回 camelCase（`eventType`、`runId`、`createdAt`）。两边都没有顶层的 `type`。SDK 把两种归一成同一个 `SessionEvent`；直接调 HTTP API 意味着你要自己写两套映射。 |
| 完整事件词表 | 可用，未实测 | 一个正常回合会产生 `run.started`、`agent.lifecycle`、`agent.item`、`agent.thinking`、`agent.assistant`、`agent.tool`、`run.finished`，这些我们都观察到了。`SESSION_EVENT_TYPES` 里剩下的成员是契约声明的，我们没有每一个都见过。未知类型会原样穿过 SDK，而不是抛错。 |
| `session.status_*`、`span.*`、`stop_reason` | 不存在 | 不在词表里。`status_idle` 加 `stop_reason.type === 'requires_action'` 那套编程模型在这里没有对应物；用 `run.finished`。 |
| 把事件推送到你的服务器 | 不存在 | 见[不支持的能力](/zh/reference/not-supported)。要么挂住流，要么用 `after` 轮询。 |

## 工具

| 能力 | 状态 | 说明 |
|---|---|---|
| 模型可用的内置工具 | 已实测 | 一个正常回合会产生成对的 `agent.tool` 事件。确切的工具名在运行时随这些事件到达；没有公开的目录路由让你先枚举它们。 |
| `tool_policy` 的 allow 和 deny | 可用，未实测 | `{}` 表示完整清单。非空对象会被读成一份收窄可用工具面的 allow/deny 策略。我们没有跑过收窄后的策略，所以请通过观察 `agent.tool` 里出现哪些工具，来确认你的策略生效了。 |
| 客户端执行的自定义工具 | 不存在 | 没有自定义工具类型，也没有 `user.custom_tool_result` 事件。这是最大的一个缺口。围绕它做设计之前，先[读一下替代方案](/zh/reference/not-supported#client-executed-custom-tools)。 |
| 远程 HTTP MCP server | 可用，未实测 | 声明在 agent 上，不是一个独立资源。只有远程 HTTP 传输加一个静态 bearer。工具名以 `mcp__<server>__<tool>` 出现，并按 `config_version` 固定。这是唯一一条能让你自己的代码撑起一个 agent 工具的路径，而我们没有端到端跑通过。 |
| stdio MCP server、MCP OAuth | 不存在 | 就只有远程 HTTP 加静态 bearer。 |
| 端到端的审批门控工具执行 | 不存在 | 零件在词表里都有；闭环没有被证明过。见[不支持的能力](/zh/reference/not-supported#end-to-end-human-approval)。 |
| `POST /agents/{id}/exec` | 可用，未实测 | 一个运维扩展，在 agent 的沙箱里跑一条命令，不是给 agent 用工具的通路。它要求 agent 级的沙箱：session 级的 agent 拿到 `409 exec_requires_agent_scope`，没有沙箱后端的部署拿到 `501 not_configured`。 |

## Skills

| 能力 | 状态 | 说明 |
|---|---|---|
| `listAgentSkills()` | 已实测 | 一个全新的 agent 已经**挂上了整个全局目录** ，docx、pptx、xlsx、pdf 都在里面。你不用装它们；它们从创建那一刻就在。 |
| 读取 skill 目录 | 已实测 | 目录路由返回 200。我们看到的每一条 `scope` 都是 `global`。 |
| 对全局目录里的 skill 调 `putAgentSkill()` | 不存在 | 通过网关返回 `404`。安装路由只对你自己租户上传的 skill 有意义。既然全局 skill 在创建时就挂上了，这条更多是「你已经有了，只是管不了」，而不是「你用不了」。 |
| 对 `org` 或 `personal` skill 调 `putAgentSkill()` / `deleteAgentSkill()` | 可用，未实测 | 网关会转发这两个 scope。我们手上从来没有过一个非全局的 skill 可装，所以整个「装完再读回来」的循环都没测过。 |
| 上传你自己的 skill | 可用，未实测 | 一个 multipart 创建接口，收一个 `.zip` 加一个 `org` 或 `personal` 的 scope；`name` 和 `description` 取自压缩包内 `SKILL.md` 的 frontmatter。全局 scope 用组织 key 写不了。 |
| session 级的 skill 选择 | 不存在 | skill 挂在 agent 上。没有按 session 划分的 skill 集合。 |

## Environments

Environment 是一份可选的、不可变的沙箱镜像，你把它固定在 agent 上：预装好的包、受控文件、一个构建脚本，以及一份网络策略。

| 能力 | 状态 | 说明 |
|---|---|---|
| 通过网关能触达 Environments | 已实测 | 一次列表调用返回 `200` 和一个空列表。我们跑过的就这些：下面构建路径上的每一条都没跑过。 |
| 创建一个 environment 并构建一个版本 | 可用，未实测 | 版本不可变，按 `queued -> submitting -> building -> verifying -> ready` 推进，`failed` 从任何构建阶段都可达。轮询具体那个版本，不要轮询 environment 的顶层状态。 |
| apt、npm、pip 预装 | 可用，未实测 | 安装顺序是固定的：先 apt，再 npm，最后 pip。 |
| cargo、gem、go | 不存在 | 三个包管理器，不是六个。 |
| 网络策略 | 可用，未实测 | `unrestricted`，或者 `limited` 加一份域名的 `allowed_hosts` 列表（`*.` 前缀覆盖一层子域名）。在 `unrestricted` 上给 `allowed_hosts` 是 `400`。 |
| 受控文件和构建脚本 | 可用，未实测 | 文件落在一个固定目录下；顶层 `bin/*` 里可执行的条目会被链接到 path 上。构建脚本只在镜像构建时运行。 |
| 大文件直传 | 可用，未实测 | 一个四步的 declare、upload、finalize、reference 流程。内联内容每次请求上限 1 MB；总量上限 50 MB。 |
| 构建日志、重试、归档 | 可用，未实测 | 日志按 offset 增量读取。重试会重跑同一个版本，并保留审计记录。 |
| Environment 锁 | 可用，未实测 | agent 的 environment 在它第一次成功创建沙箱之前可以改，之后返回 `409 environment_locked`。停掉 agent 也不会解锁。第一次就固定准。 |
| Secret、运行时环境变量、沙箱启动钩子 | 不存在 | Environment 是一份构建期产物。这些它一个都不收。 |
| 继承任意基础镜像 | 不存在 | 自定义 environment 永远继承平台的基础镜像。 |
| 在你自己的机器上跑工具 | 不存在 | 见[不支持的能力](/zh/reference/not-supported#self-hosted-tool-execution)。 |

## 自动化 {#automation}

| 能力 | 状态 | 说明 |
|---|---|---|
| 作为 agent 子资源的定时任务 | 可用，未实测 | 列出、创建、替换、删除、触发、读取运行记录，全都在 `/agents/{id}/schedules` 下。SDK 一个都没暴露。 |
| `cron`、`every`、`at` | 可用，未实测 | cron 最多五个字段，没有宏。重叠策略被服务端固定为 SKIP，不可配置。 |
| 调度后端没接线的地方 | 不存在 | 那些部署返回 `501 not_configured`。不要原样重试。在你把产品建在调度能力上之前，先确认这一点。 |
| Heartbeat | 可用，未实测 | 不是一条路由：是 agent declared 配置里的一个 `heartbeat` 小节，在创建时和每一次 PUT 时被协调一次。把 `every` 设成 `0` 会暂停它并保留运行历史。协调是尽力而为的，失败不会回报给你的调用。 |
| Wake | 可用，未实测 | 给下一个 heartbeat 回合排一条提醒，或者立刻触发 heartbeat 定时任务。立刻模式在没有启用 heartbeat 时返回 `409`。 |
| 从定时任务做 webhook 投递 | 不存在 | `delivery` 只接受 `none` 和一种带类型的 `announce`。webhook 投递会被拒。 |
| 暂停与恢复、归档、跨定时任务的运行历史 | 不存在 | 删掉重建，运行记录一次读一个定时任务。 |
| 删除 agent 时自动清理 | 不存在 | 定时任务在 agent 被停掉和被删除之后都还活着。你得先自己列出来删掉，否则它们会继续触发。 |

## 文件

| 能力 | 状态 | 说明 |
|---|---|---|
| 往 agent 工作区写文件 | 可用，未实测 | `POST /agents/{id}/files`，带一个路径和内容。写入一份上下文文档还会产生一份新的配置快照。 |
| 读文件 | 可用，未实测 | `path`、`owner_uid`、`org_id` **三个都必须给** 。省掉 `path` 是 `400`，所以这不是一个「列出我的文件」的端点。路径必须待在 agent 根目录之下。 |
| 下载原始字节 | 可用，未实测 | 有一个单独的内容端点返回字节，不做 UTF-8 强制转换，每个文件上限 100 MB。 |
| 用户文件的持久存储 | 不存在 | 后端没有接到一个共享的持久工作区上。不要把它当成你的权威存储。 |
| 给 session 附加文件 | 不存在 | 见[不支持的能力](/zh/reference/not-supported#session-file-attachment-and-repository-mounting)。 |
| 从你自己的代码发布 artifact | 不存在 | 模型有一个在循环内的发布工具，能把工作区里的文件变成一个 URL。没有任何 API 让你的进程去发布、列出或撤销它，而且这个 URL 能活多久取决于部署。 |

## 记忆

| 能力 | 状态 | 说明 |
|---|---|---|
| 一个记忆存储资源 | 不存在 | 没有 CRUD，没有挂载，没有版本，没有乐观并发控制，也没有任何东西能跨 agent 挂上去。 |
| 模型侧的记忆工具 | 可用，未实测 | 模型可能有作用域限定在单个 agent 上的记忆工具。它们可以在部署层面被关掉，在 API 上不可见，你没法读、没法种、没法审计、也没法回滚。不要把东西建在你看不见的状态上。 |
| 用 `persona.docs` 给记忆做种 | 不存在 | `MEMORY.md` 和 `memory/` 命名空间是保留的：声明其中任何一个都返回 `400 invalid_persona_doc_name`。 |
| 你自己的状态，按回合注入 | 已实测 | 状态放你自己的数据库，用 `system.message` 把要紧的推进去。模型在下一个回合读到它。这是给 agent 一份你自己掌控的记忆的、受支持的做法。 |

## 多 agent

| 能力 | 状态 | 说明 |
|---|---|---|
| 从你自己的代码驱动多个 agent | 已实测 | 建 N 个 agent，跑它们的 session，在你自己的进程里给它们排序。这里涉及的每一个原语都是已实测的。这是受支持的多 agent 模式。 |
| 声明式的协调者名册 | 不存在 | 没有名册资源，也没有委派配置。 |
| session 线程与 `thread_*` 事件 | 不存在 | 事件词表里没有任何东西对应子 agent 线程。 |
| 模型自己派生的子 agent | 可用，未实测 | 模型可能在 session 内派生工作，嵌套深度为一层，并发的子任务数有上限。你没法配置它、没法寻址它、也没法从 API 观察它，所以不管往哪个方向都别围着它做设计。 |

## 怎么报缺口

联系给你签发 API key 的人。带上请求发生的时间、错误信封里的 HTTP 状态码和 `error.type`，以及能复现的最小调用。说清楚你依赖的是这一页的哪一行：一行标着**已实测** 却在你这边失败，那是一次回归，我们想尽快知道；一行标着**可用，未实测** 却失败了，那是会改写这一页的新信息。这个 preview 阶段没有公开的 issue tracker，也没有支持邮箱，所以给你 key 的那个团队就是唯一的通道。
