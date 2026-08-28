---
title: 能力矩阵
source: /en/reference/capabilities
source_hash: 87f7203b09bbb91c6d3302792d684a7f2984a0c5655cd1158280413374899167
---

# 能力矩阵

哪些能用、哪些存在但从没被驱动过、哪些根本没有。一行一个能力，那条真正要紧的提醒写在说明列里。

敲定架构之前先读这一页。缺口的分布并不均匀：agent–session–event 这条核心链路是扎实的、跑过的，而它周边的好几个资源，只是我们读过的路由，没有真跑过。

## 验证级别

| 级别 | 含义 |
|---|---|
| **已实测** | 我们在一套真实部署上跑过，并观察到了结果。 |
| **可用，未实测** | 路由存在，契约也有文档，但我们没有驱动过它。它可能完全按描述工作。把它当成你还得自己做的活儿，别放进你的演示路径。 |
| **不存在** | 它就是没有。[不支持的能力](/zh/reference/not-supported)会说明改用什么。 |

所有标着**已实测** 的，都是在一套真实部署上、用一个组织 API key 观察到的——和你的 key 走的是同一条路径：主体在 2026-08-06，较新的面（system prompt、artifacts、outcome）在 2026-08-14，内置技能凭证链路在 2026-08-16。

## Agents

| 能力 | 状态 | 说明 |
|---|---|---|
| `listModels()` | 已实测 | 返回你的组织能选的模型别名目录——检查一个 key 是否可用最便宜的方式。提交别名（`litellm/...`），永远不要提交厂商的模型名。 |
| `createAgent()` | 已实测 | 返回一份**扁平的创建回执** ，`config_version` 在顶层。 |
| agent 创建时的 `Idempotency-Key` | 可用，未实测 | 这个 header 会被接受，带着它的创建能成功。我们从没用同一个 key 重放过一次创建来观察去重，所以别假设重试是免费的。 |
| `getAgent()` | 已实测 | 返回的**结构和创建时不一样** ：配置在 `declared` 下，版本在 `status.config_version`，顶层既没有 `config_version` 也没有 `name`。读版本请写 `agent.status?.config_version ?? agent.config_version`。 |
| `startAgent()` | 已实测 | 必须调。新 agent 是 `stopped`。`desired_state` 会在远不到一秒内翻成 `running`。返回里的 `channel_routes_reload_failed` 警告在纯 API 的 agent 上是正常噪声，不是失败。 |
| `stopAgent()` | 已实测 | 亚秒级。之后 `createSession()` 返回 `409 agent_not_running`。 |
| 用 `status.desired_state` 把关就绪 | 已实测 | 唯一正确的就绪信号。轮询到它是 `running` 为止。 |
| 用 `status.actual_state` 把关就绪 | 不存在 | `actual_state` 报的是聊天渠道的连通性，不是 API 是否就绪。没绑渠道的 agent 永远停在 `activating`，`active` 到不了；绑定[渠道](/zh/build/channels)之后它报告的是渠道健康——无论哪种情况，`running` 都根本不在它的枚举里，等它的循环永远不会返回。 |
| `updateAgent()` | 已实测 | **按小节合并** 。你省略的小节会被保留：只带 `labels` 的一次 PUT 不会动 `name`、`model` 和 `persona`。 |
| `tool_policy` / `system_prompt` 整体替换 | 可用，未实测 | 合并规则的两个例外：每一次 PUT 都整体替换这两个小节。`{}` 会恢复完整的工具清单。我们只在其他小节上跑过合并行为。 |
| `system_prompt` pin | 已实测 | 新建 agent 会自动 pin 创建那一刻 active 的平台模板版本——2026-08-14 观察到 `{source:'platform',version:1}`——而且这个 pin **自己永远不跟随**之后的平台 activation。`{source:'custom',base_version,template}` 整体覆盖模板（13 个功能 slot 各出现一次，64 KiB 上限）。要挪 pin 只有一个显式调用——见下一行。 |
| `getSystemPrompt()` / `previewSystemPrompt()` | 已实测 | 声明 + 实际生效的渲染模板；以及按你给定的运行时事实做确定性的完整 prompt 装配——13 个 `slot_hashes`，`transcript` 恒为 `[]`，过期的 `config_version` 返回 `409 config_version_changed`。2026-08-14 实测。 |
| `upgradeSystemPrompt()` | 已实测 | 把 pin 挪到当前 active 的平台版本（或用 `template_version` 指定一个）。`expected_config_version` 是真 CAS：过期返回 `409 config_version_changed`，200 回执带**新的** `config_version`——升级就是一次普通的配置写入。2026-08-14 实测；更老的网关部署上，这一个调用会撞网关 404。 |
| 把 `config_version` 当幂等回执 | 不存在 | 每一次成功的 PUT 都会 bump 它，值完全相同的 PUT 也一样，而且不是你发起的写入同样会 bump 它。它是一个变更计数器，不是内容哈希。见[错误与重试](/zh/reference/errors)。 |
| `deleteAgent()` | 已实测 | 软删除。它不停止 agent，不删除它的定时任务，也不释放它的沙箱。先调 `stopAgent()`，定时任务自己删。 |
| 列出 agent | 可用，未实测 | `listAgents(opts?)` 调的就是它。线协议上的路由把 `owner_uid` 加 `org_id` 当成精确 AND 选择器，所以同一组织内由另一个 key 创建的 agent，能按 id 读到，却永远不会出现在你的列表里；这类 id 自己记一份。`labels` 按声明的 label 过滤，`page` 从 1 开始，每页大小固定为 100。`{ labels: { workspace_id: '...' } }` 能把一个聊天 URL 里的 workspace id 解析成它对应的 agent。 |
| 其他组织的 agent id | 已实测 | 返回 **404** ，不是 403。存在性被隐藏，所以 404 不代表「已删除」。 |
| key 无效或缺失 | 已实测 | `401`，`error.type` 是 `service_token.invalid`。匹配 `ZooworkError.status` 和 `.type`，永远不要匹配报错文本。 |
| `persona.docs[]` | 可用，未实测 | 只有带内联 `content` 的条目会被存下来。`MEMORY.md` 和任何 `memory/` 名字会被 `400 invalid_persona_doc_name` 拒绝。规范名字集合之外的文档会被保存，但不会被组装进提示词。 |
| 固定 `environment_id` / `environment_version` | 可用，未实测 | 创建时接受写在 `resource` 顶层，PUT body 里也接受。只给版本是 `400`。 |
| Agent 版本历史、固定、回滚 | 不存在 | 没有任何路由能列出或取到过去的 `config_version`，也没有任何东西能把一个 session 固定到某个版本上。 |
| 凭证 API | 不存在 | 客户端没有凭证 API——平台在创建 agent 时自动注入模型凭证；你自己的密钥应留在你自己的服务里。 |

## Sessions

| 能力 | 状态 | 说明 |
|---|---|---|
| `createSession(agentId, input)` | 已实测 | session 是 **agent 的子资源** ：`POST /agents/{id}/sessions`。 |
| 带 `user.message` 的 `initial_events` | 已实测 | 这里只接受 `user.message`，最多 50 条。 |
| session 创建时的 `Idempotency-Key` | 已实测 | 有效。用同一个 key 重试创建是安全的。 |
| `409 agent_not_running` | 已实测 | 稳定，可以按 `error.type` 匹配。跳过 `startAgent()` 拿到的就是它。 |
| `getSession()` | 已实测 | 这条路径上 `status` 回来是 `null`；run 的状态在 `run_status` 里。 |
| `getSession({ history: true, limit })` | 已实测 | `history[]` 的每一行是 `{ seq, entry_type, entry, created_at }`。`entry_type: 'message'` 时，文本在 `entry.message`。这是唯一能看到 token 用量和实际作答模型的地方。 |
| 创建时的 session `metadata` | 可用，未实测 | 创建时会被接受；我们没有断言它能原样读回来。 |
| 列出一个 agent 下的 session | 可用，未实测 | 有一条分页路由（固定每页 50，最新在前）。`listSessions(agentId, { page })` 调的就是它；`page` 从 1 开始，没有游标。 |
| 归档、软删除一个 session | 可用，未实测 | `archiveSession()` 会盖上 `archived_at`：之后写入返回 `409 session_archived`，读取照常，所以先把进行中的 run 打断。`deleteSession()` 是软删除（`204`），会先取消进行中的 run，转录和事件留作审计。没有 `patchSession`：session 上的 PATCH 通过网关返回 `405`，所以 `metadata` 在创建时写一次就定了。 |
| 跨所有 agent 列出 session | 不存在 | 没有顶层的 session 集合。 |
| `resources[]`、文件挂载、`vault_ids`、`agent_with_overrides` | 不存在 | `createSession` 只收 `initial_events` 和 `metadata`。没别的了。 |

## 事件与流式

| 能力 | 状态 | 说明 |
|---|---|---|
| 带 `user.message` 的 `postEvents()` | 已实测 | 多回合可用：agent 在同一个 session 里记得起之前的回合。 |
| 对进行中的 run 发 `user.interrupt` | 已实测 | 返回 `accepted: true`，run 以带 `status: 'aborted'` 的 `run.finished` 结束。在我们那次运行里大约花了 20 秒才生效，所以别指望立刻停下。 |
| 没有 run 在跑时发 `user.interrupt` | 已实测 | `202`，`accepted: false`。那是一次空操作，不是错误。不要当成失败处理。 |
| `system.message` | 已实测 | 会被接受，模型在**下一个** 回合的上下文里拿到它。一条带外注入通道——你自己应用掌握的状态，不以用户发言的形式塞进去。 |
| `user.tool_confirmation` | 可用，未实测 | 作为写入侧类型会被接受。文档里的 body 是 `{ type, approval_id, decision }`，`decision` 取 `allow-once`、`allow-always` 或 `deny`；其他结构会被拒。我们从没造出过一个真实的待处理审批，所以这个往返没有被证明过。 |
| 其他任何写入侧事件类型 | 不存在 | 写入面就是四种类型：`user.message`、`user.interrupt`、`user.tool_confirmation`、`system.message`。 |
| `listEvents()` | 已实测 | 服务端默认 100，最大 500，**一次调用只给一页** 。长 session 会静默截断，不报错。`listAllEvents()` 替你把页翻完。 |
| `listEvents()` 上的 `types` 过滤 | 已实测 | `?types=agent.assistant` 会按预期收窄结果。 |
| `streamEvents()`（SSE） | 已实测 | 这个流是 **session 级** 的：一个回合结束时它不会关闭。用 `isRunFinished` 判断一个回合的结束。session 转入空闲后，服务端才关掉连接。 |
| 断线续传 | 已实测 | 重放发生在服务端，所以重连不花你任何代价，也不需要客户端做一轮去重。把最后一帧 `id:` 行的值发回去即可——它是一个不透明的续传令牌，SDK 把它放在 `ev.cursor` 上，用 `{ cursor }` 传回（直接调 HTTP 就是`?cursor=` 或 `Last-Event-ID` 请求头）。`?after=<seq>` 也能重放，但会切到废弃的 engine-only 通道，那条通道不含你自己发的 input 事件。 |
| `?deltas=` 增量预览 | 可用，未实测 | 是**快照替换** 语义，不是前缀追加：每一帧都是到目前为止的全文。把它们拼起来会得到重复的文本。delta 通道没接线的地方返回 `501 not_configured`。SDK 会跳过这些帧。 |
| 用 `run.finished` 判断回合结束 | 已实测 | `payload.status` 是 `succeeded`、`failed` 或 `aborted`。 |
| `agent.tool` 的 `start` 和 `end` 阶段 | 已实测 | 一次调用每个 phase 发一个事件，共享同一个 `toolCallId`；调用并发时它们并不相邻，所以按 id 配对，永远不要按位置配对。 |
| `agent.tool` 的 `blocked` 阶段 | 可用，未实测 | 第三种阶段，含义是这次调用正在等审批、还没有执行。把它当成待定，永远不要当成结束。 |
| 工具失败不会让 run 失败 | 已实测 | 带 `isError: true` 的 `agent.tool` 之后，照样跟着一个 `succeeded` 的 `run.finished`。永远不要用「没出现工具错误」推断一个回合成功。 |
| `agent.approval` | 可用，未实测 | 在事件词表里。我们没有观察到过。 |
| 同一个事件的两种线格式拼写 | 已实测 | REST 返回 snake_case，SSE 返回 camelCase，两边都没有顶层的 `type`，SDK 把两种归一成同一个 `SessionEvent`。 |
| 完整事件词表 | 可用，未实测 | 一个正常回合会产生 `run.started`、`agent.lifecycle`、`agent.item`、`agent.thinking`、`agent.assistant`、`agent.tool`、`run.finished`，这些我们都观察到了。`SESSION_EVENT_TYPES` 里剩下的成员是契约声明的，我们没有每一个都见过。未知类型会原样穿过 SDK，而不是抛错。 |
| `session.status_*`、`span.*`、`stop_reason` | 不存在 | 不在词表里。`status_idle` 加 `stop_reason.type === 'requires_action'` 那套编程模型在这里没有对应物；用 `run.finished`。 |
| 把事件推送到你的服务器 | 不存在 | 见[不支持的能力](/zh/reference/not-supported)。要么挂住流，要么用 `after` 轮询。 |

## 渠道 {#channels}

2026-08-28 在 SDK 默认指向的那套部署上实测。早于渠道版本的部署返回的 404 是引擎透传的信封（`{"error":{"type":"not_found"}}`），靠这个区分。见[渠道](/zh/build/channels)。

| 面 | 状态 | 说明 |
|---|---|---|
| 能绑哪些平台 | 已实测 | `feishu`、`slack`、`wecom` 可以通过 `addChannel` 绑定；`feishu`、`wecom`、`weixin` 可以走扫码流。`weixin`/`wechat` 调 `addChannel` 返回 `400 channel.weixin_setup_required`——它指向的扫码流是存在的，照着走即可。`discord`、`telegram`、`msteams`、`dingtalk-connector`，以及大小写写错的 `WECOM`，都是 `400 channel.invalid_request`。 |
| `dingtalk` | 可用，未实测 | 这个名字在渠道服务的平台列表里，绑定会返回 `201`——所有其他没写进文档的名字都不会——但我们没有让任何一份 `config` 在这套 API 上真正跑通。 |
| 绑定一个没启动的 agent | 已实测 | 这里没有「agent 必须在运行」的前置条件：从没启动过的 agent，两条路径都照收。渠道在 agent 启动之后才上线。 |
| `dm_policy: 'pairing'` | 不存在 | 创建和更新都返回 `400 channel.pairing_unsupported`。 |
| `listChannels()` | 已实测 | 纯 API agent 返回 `{ channels: [] }`。 |
| `addChannel()` | 已实测 | 返回 `201`——但**绑定时不校验凭证**。编造的凭证同样返回 `201`，带 `health: 'unknown'` / `status: 'configured'`，随后在列表里变成 `health: 'unhealthy'` / `status: 'error'`。判定要从后续的 list 里读，绝不能只看 201。请求体里的 `allow_from` 会被收下然后忽略——真正生效的值由 `dm_policy` 推导，也没有任何地方把它回显出来。请求体完全相同时重发会回放同一个 `201`，但同一个 `platform` + `account` 换一份**不同的 `config`** 会返回 `409 channel.conflict`——换凭证要先 remove 再 add。 |
| `updateChannel()` | 已实测 | 直接返回渠道的新状态。`enabled: false` 还会把 `status` 变成 `'disabled'`、`health` 重置为 `'unknown'`。该平台没有绑定时返回 `404 channel.not_found`。 |
| `removeChannel()` | 已实测 | `{ ok: true }`，下一次 list 里就没有了。 |
| 扫码流 —— `startChannelSetup()` / `pollChannelSetup()` / `cancelChannelSetup()` | 已实测 | 三个平台都实测过。飞书：`verification_uri_complete`、`expires_in: 600`、`poll_interval: 5`，`brand: 'lark'` 确实会把 URI 域名换成 `open.larksuite.com`。企业微信和微信：`qrcode_url`、`expires_in: 300`、没有 `poll_interval`。被取消的 session 在下一次轮询时返回 `404 channel.{platform}_session_not_found`。 |
| 微信 setup 的请求体 | 已实测 | 只读 `dm_policy`，而且只接受 `'open'`/`'disabled'`——`'allowlist'` 返回 `400 channel.allowlist_unsupported`。account 钉死为 `'default'`、group policy 钉死为 `'disabled'`，请求体里其他字段被忽略而不是报错。 |
| `waitForChannelSetup()` | 已实测 | 按服务端的间隔驱动循环，并把 body 报告的终态当返回值交回。session 不存在的情况是抛异常——见渠道页的告诫。只针对飞书的旧拼写（`startFeishuSetup()` 等）仍然可用，内部调的就是这几个。 |
| 真人扫码完成的绑定 | 可用，未实测 | 每条路由都跑过了，但没有任何一次运行让真人走完 QR 批准，所以 `status: 'success'` 和一个健康的渠道都没有被观察到。 |
| `deleteAgent()` 的渠道清理 | 可用，未实测 | 删除成功后 best-effort 解绑该 agent 的渠道——是删除，不是停用；清理失败永远不会把删除变成报错。已确认的只有：agent 删除后，渠道路由返回 `404 service_api.not_found`。 |

## 工具 {#tools}

| 能力 | 状态 | 说明 |
|---|---|---|
| 模型可用的内置工具 | 已实测 | 一个正常回合会产生成对的 `agent.tool` 事件。确切的工具名在运行时随这些事件到达；没有公开的目录路由让你先枚举它们。 |
| `tool_policy` 的 allow 和 deny | 可用，未实测 | `{}` 表示完整清单。非空对象会被读成一份收窄可用工具面的 allow/deny 策略。我们没有跑过收窄后的策略，所以请通过观察 `agent.tool` 里出现哪些工具，来确认你的策略生效了。 |
| 客户端执行的自定义工具 | 不存在 | 没有自定义工具类型，也没有 `user.custom_tool_result` 事件。这是最大的一个缺口。围绕它做设计之前，先[读一下替代方案](/zh/reference/not-supported#client-executed-custom-tools)。 |
| 远程 HTTP MCP server | 已实测 | 声明在 agent 上（`resource.mcp[]`），不是独立资源；传输是 `streamable-http`（默认）和 `sse`。工具在模型清单里以 `mcp__<server>__<tool>` 出现——server 名不能带下划线——并且对公开 server **真的会执行**。目录按 `config_version` 固定；探测失败的 server 会 pin 一个空目录并发一条 `kind: 'mcp_connection_failed'` 的 `agent.error`，不会让 run 失败。这是唯一一条能让你自己的代码撑起一个 agent 工具的路径，但**只支持无鉴权**：`credential` slug 能声明进去，其背后的存储过网关是 404，所以需要鉴权的 server 今天做不起来。 |
| stdio MCP server、MCP OAuth | 不存在 | 就只有远程 HTTP。 |
| 端到端的审批门控工具执行 | 不存在 | 零件在词表里都有；闭环没有被证明过。`listApprovals()` 和 `resolveApproval()` 驱动的是一个 REST 资源，不是 `user.tool_confirmation` 那条事件闭环，而且在那个后端没接线的地方它们返回 `501 not_configured`。卡在审批上的 run 会把整个回合预算耗光。见[不支持的能力](/zh/reference/not-supported#end-to-end-human-approval)。 |
| `POST /agents/{id}/exec` | 可用，未实测 | 一个运维扩展，在 agent 的沙箱里跑一条命令，不是给 agent 用工具的通路。`exec(agentId, args)` 调的就是它，`args` 是 argv：要 shell 语义就写 `['bash', '-lc', 'pwd']`。它要求 agent 级的沙箱：session 级的 agent 拿到 `409 exec_requires_agent_scope`，没有沙箱后端的部署拿到 `501 not_configured`。 |

## Skills

| 能力 | 状态 | 说明 |
|---|---|---|
| `listAgentSkills()` | 已实测 | 一个全新的 agent 已经**挂上了整个全局目录** ，docx、pptx、xlsx、pdf 都在里面。你不用装它们；它们从创建那一刻就在。 |
| 调用平台服务的内置技能（语音、视频、三方 connector） | 已实测 | 在 API 创建的 agent 上零配置可用：平台会在沙箱创建时把这些技能需要的服务凭证注入进去。你这边没有任何凭证步骤——也没有塞入自己凭证的口子，见[不支持](/zh/reference/not-supported)。 |
| 读取 skill 目录 | 已实测 | `listSkills({ scope, q, page })` 读的就是它。目录路由返回 200。我们看到的每一条 `scope` 都是 `global`。`q` 按名字匹配；`page` 从 1 开始，每页固定 100。 |
| 对全局目录里的 skill 调 `putAgentSkill()` | 不存在 | 通过网关返回 `404`。安装路由只对你自己租户上传的 skill 有意义。既然全局 skill 在创建时就挂上了，这条更多是「你已经有了，只是管不了」，而不是「你用不了」。 |
| 对 `org` skill 调 `putAgentSkill()` | 已实测 | 装上和读回来都成立：skill 从 `listAgentSkills()` 回来时带 `eligible: true`，下一个回合就从它自己的内容作答。 |
| 对 `personal` skill 调 `putAgentSkill()`、以及 `deleteAgentSkill()` | 可用，未实测 | 网关会转发这两个 scope。删除的结果用 `listAgentSkills()` 确认，不要只信返回的 `config_version`。 |
| 上传你自己的 skill | 可用，未实测 | 一个 multipart 创建接口，收一个 `.zip` 加一个 `org` 或 `personal` 的 scope；`name` 和 `description` 默认取自压缩包内 `SKILL.md` 的 frontmatter，显式传入的 `description` 选项会覆盖 frontmatter 里的那个。`fileName` 选项用来命名上传的那一部分。全局 scope 用组织 key 写不了。 |
| session 级的 skill 选择 | 不存在 | skill 挂在 agent 上。没有按 session 划分的 skill 集合。 |

## Environments

Environment 是一份可选的、不可变的沙箱镜像，你把它固定在 agent 上：预装好的包、受控文件、一个构建脚本，以及一份网络策略。

| 能力 | 状态 | 说明 |
|---|---|---|
| 通过网关能触达 Environments | 已实测 | `listEnvironments()` 返回 `200` 和一个空列表。我们跑过的就这些：下面构建路径上的每一条都没跑过。 |
| 创建一个 environment 并构建一个版本 | 可用，未实测 | 版本不可变，它的 `status` 按 `queued -> submitting -> building -> verifying -> ready` 推进，`failed` 从任何构建阶段都可达。轮询那个版本的 `status`，不要轮询 environment 的顶层行。 |
| apt、npm、pip 预装 | 可用，未实测 | 安装顺序是固定的：先 apt，再 npm，最后 pip。 |
| cargo、gem、go | 不存在 | 三个包管理器，不是六个。 |
| 网络策略 | 可用，未实测 | `unrestricted`，或者 `limited` 加一份域名的 `allowed_hosts` 列表（`*.` 前缀覆盖一层子域名）。在 `unrestricted` 上给 `allowed_hosts` 是 `400`。 |
| 受控文件和构建脚本 | 可用，未实测 | 文件落在一个固定目录下；顶层 `bin/*` 里可执行的条目会被链接到 path 上。构建脚本只在镜像构建时运行。 |
| 大文件直传、构建日志、重试、归档 | 可用，未实测 | 上传流程、体积上限、重试的行为都见 [Environments](/zh/build/environments)。 |
| Environment 锁 | 可用，未实测 | agent 的 environment 在它第一次成功创建沙箱之前可以改，之后返回 `409 environment_locked`。停掉 agent 也不会解锁。第一次就固定准。 |
| Secret、运行时环境变量、沙箱启动钩子 | 不存在 | Environment 是一份构建期产物。这些它一个都不收。 |
| 继承任意基础镜像 | 不存在 | 自定义 environment 永远继承平台的基础镜像。 |
| 在你自己的机器上跑工具 | 不存在 | 见[不支持的能力](/zh/reference/not-supported#self-hosted-tool-execution)。 |

## 自动化 {#automation}

| 能力 | 状态 | 说明 |
|---|---|---|
| 作为 agent 子资源的定时任务 | 可用，未实测 | 列出、创建、替换、删除、触发、读取运行记录，全都在 `/agents/{id}/schedules` 下，这七个方法在 client 上都有：`listSchedules`、`createSchedule`、`getSchedule`、`updateSchedule`、`deleteSchedule`、`triggerSchedule`、`listScheduleRuns`。有两件事类型帮不了你。改周期只能靠 `schedule: { kind: 'cron', expr, tz }`；读回来的那个 `scheduleSpec` 会被 `ScheduleUpdate` 拒收，服务端也会忽略它。还有，对一个已禁用的定时任务调 `triggerSchedule`，返回的是 `triggered: true`，而运行投影里记的是 `status: 'skipped'`。 |
| `cron`、`every`、`at` | 可用，未实测 | cron 最多五个字段，没有宏。重叠策略被服务端固定为 SKIP，不可配置。 |
| cron job 上的 outcome 门（`payload.outcome`） | 已实测 | 「做完长什么样」，在 run 内部检查：一段 `description`，一个 `command`（沙箱命令，exit 0 即满足；`timeoutSec` 1–600、默认 120，另有可选的 `cwd` 和 `skipIfUnchanged`，命令 ≤8 KiB）或 `rubric`（独立上下文里的 LLM 评审；`rubric.type` 必须是 `text`，≤32 KiB，可选 `model`）evaluator，`maxIterations` 1–5、默认 3，以及 `publish: after_satisfied \| always \| never`——默认策略下，没通过评估的结果不会被 announce。`description` 是评审据以判断的内容，≤4096 字符。还有第三种 evaluator 类型 `subagent`，是一个 API 目前仍然拒绝的保留位。校验在每一层都是写严格的：outcome 对象里任何一处出现未知的键，都会返回一个点名该字段的 400。agent 级默认写在 `resource.outcome`；job 自己的值覆盖默认，显式 `null` 让该 job 退出默认。只作用于 cron 触发。我们 2026-08-14 实测的是**存储往返**——接受、存储、原样读回、不注入默认值；还没有观察过一次真正被评估的触发。 |
| 调度后端没接线的地方 | 不存在 | 那些部署返回 `501 not_configured`。不要原样重试。在你把产品建在调度能力上之前，先确认这一点。 |
| Heartbeat | 可用，未实测 | 不是一条路由：是 agent declared 配置里的一个 `heartbeat` 小节。`AgentResource` 上没有 `heartbeat` 这个成员，所以创建时带不进去——它只能经 `updateAgent(agentId, sections)` 到达 agent，并在每一次 PUT 时被协调一次。把 `every` 设成 `0` 会暂停它并保留运行历史。协调是尽力而为的，失败不会回报给你的调用。 |
| Wake | 可用，未实测 | `wake(agentId, { text, mode })` 给下一个 heartbeat 回合排一条提醒，或者立刻触发 heartbeat 定时任务。立刻模式在没有启用 heartbeat 时返回 `409`。传 `deliverToUser: false` 可以让这条提醒只留在 agent 的推理里，不浮到用户面前。 |
| 从定时任务做 webhook 投递 | 不存在 | `delivery` 只接受 `none` 和一种带类型的 `announce`。webhook 投递会被拒。 |
| 暂停与恢复、归档、跨定时任务的运行历史 | 不存在 | 删掉重建，运行记录一次读一个定时任务。 |
| 删除 agent 时自动清理 | 不存在 | 定时任务在 agent 被停掉和被删除之后都还活着。你得先自己列出来删掉，否则它们会继续触发。 |

## 文件

| 能力 | 状态 | 说明 |
|---|---|---|
| 写、读、下载工作区文件 | 不存在 | 线协议上确实有这些路由，但**没有任何 `ZooworkClient` 方法覆盖文件** ，它们背后的后端也没接线。文件放你自己的库。 |
| 用户文件的持久存储 | 不存在 | 后端没有接到一个共享的持久工作区上。不要把它当成你的权威存储。 |
| 给 session 附加文件 | 不存在 | 见[不支持的能力](/zh/reference/not-supported#session-file-attachment-and-repository-mounting)。 |
| 从你自己的代码发布 artifact | 不存在 | 发布只在循环内：模型的 `artifact_publish` 工具把工作区文件变成一份不可变快照，配一个可撤销的 capability URL。你的进程造不出一个来。 |
| 列出与读取已发布的 artifact | 已实测 | `listArtifacts()` / `getArtifact()`。一次一页，带真实的 `has_more`（这个列表——和 `listEvents` 不同——会告诉你它截断了），支持 `session_id` / `source_path` / `created_before` 过滤。这些路由强制要求 `owner_uid`+`org_id` 选择器且网关不注入；SDK 从 agent 自己的投影里推导。2026-08-14 对一个没有 artifact 的 agent 实测——**有内容的行形状仍未观察过**。 |
| 重新解析与删除 artifact | 可用，未实测 | `downloadArtifact()` 为 `ready` 的 artifact 换发一个新访问 URL——把 URL 当密钥对待，未 finalize 的行返回 `409 artifact_not_ready`；`deleteArtifact()` 删除一个。两条路由都可达（未知 id 是 404，和其他外部 id 一样被隐藏），但都没对一个真实存在的 artifact 跑过。 |

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
| 模型自己派生的子 agent | 可用，未实测 | 模型可能在 session 内派生工作（嵌套深度一层，并发子任务数有上限），并且能沿父子边用 `sessions_send` 运行时工具传消息——durable fire-and-forget、有跳数上限、不支持同步等待、只限 parent↔child。这一切都在模型侧：你没法配置它、没法寻址它、也没法从 API 观察它，所以不管往哪个方向都别围着它做设计。 |

## 怎么报缺口

联系给你签发 API key 的人。带上请求发生的时间、错误信封里的 HTTP 状态码和 `error.type`，以及能复现的最小调用。说清楚你依赖的是这一页的哪一行：一行标着**已实测** 却在你这边失败，那是一次回归，我们想尽快知道；一行标着**可用，未实测** 却失败了，那是会改写这一页的新信息。这个 preview 阶段没有公开的 issue tracker，也没有支持邮箱，所以给你 key 的那个团队就是唯一的通道。
