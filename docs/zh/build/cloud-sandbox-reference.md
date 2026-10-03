---
title: 云沙箱参考
description: 查看 ZooWork 默认云沙箱中的编程语言、数据库客户端、实用工具和资源规格。
source: /en/build/cloud-sandbox-reference
source_hash: 3fa416cf30e3cc668e9f1c30d4cd621327feb07fae14586348007432beaaa06a
---

# 云沙箱参考

ZooWork 默认云沙箱是 Agent 执行命令、处理文件和使用浏览器的隔离 Linux 环境，由托管的 E2B
backend 提供。下面列出的软件无需单独配置就能使用。

本页描述默认沙箱镜像。基础镜像重建后，所列语言和工具系列中的具体版本可能变化。
应用依赖精确版本时，请检查实际 runtime。Platform API key 目前不能管理自定义 Environment，
见 [Environments](./environments.md#api-availability)。

## 编程语言

| 语言 | 默认镜像版本 | 包管理与构建工具 |
|---|---|---|
| Python | 3.12 | pip、uv |
| Node.js | 24 | npm、yarn、pnpm |
| Go | 1.22 | Go modules |
| Rust | 1.77 | cargo |
| Java | Temurin 21 | Maven 3、Gradle 8 |
| Ruby | 3.3 | gem、Bundler |
| PHP | 8.3 | Composer |
| C/C++ | GCC 和 G++ 13 | make、CMake |

镜像还为 `python3` 安装了 pandas、Matplotlib、Pillow、openpyxl、python-docx、
python-pptx、pypdf、ReportLab、pdfplumber、pdf2image、pytesseract、markitdown
等数据与文档库。Node.js 的共享模块路径中有 `docx`、`pptxgenjs` 和
`playwright-core`。镜像设置的 `NODE_PATH` 可供 CommonJS 的 `require()` 查找这些包；
项目中的 ESM `import` 不使用这条回退路径。使用 ESM 时，可以通过 `createRequire()` 加载，
或把依赖安装在项目的 `node_modules` 中。

默认镜像的基础清单以本页列出的版本和工具为准。依赖其他版本或工具前，请先检查实际运行环境。

## 数据库

| 数据库 | 沙箱内可用内容 |
|---|---|
| PostgreSQL | `psql` 客户端；没有预装或启动 PostgreSQL 服务端。 |
| Redis | `redis-cli` 客户端；没有预装或启动 Redis 服务端。 |
| SQLite | `sqlite3` 命令，以及 Python `sqlite3` 模块等语言绑定。 |

`psql` 和 `redis-cli` 可以连接你提供的服务，但还要遵守 sandbox 的网络访问条件。
客户端存在，不表示沙箱内有本地数据库服务。
通过 `agent_db` 工具使用的独立托管数据库，见 [Agent Database](./data-storage.md)。

## 实用工具

### 系统与开发

- `git`、`ssh`、`scp`：版本控制和远程访问。
- `curl`、`wget`：HTTP 请求；`jq`：JSON 处理。
- `tar`、`zip`、`unzip`：归档文件。
- `ripgrep`（`rg`）、`tree`、`htop`、`tmux`、`screen`。
- `make`、`cmake`、`gcc`、`g++`：构建工具。
- `docker` CLI。默认镜像不提供沙箱内的 Docker daemon。

### 文本、文档和媒体

- `sed`、`awk`、`grep`、`diff`、`patch`；`vim` 和 `nano` 编辑器。
- LibreOffice、`pandoc`：文档转换。
- Poppler 的 `pdftotext`、`pdftoppm` 等工具，以及用于 OCR 的 `tesseract`。
- `ffmpeg`、`ffprobe`：媒体处理；`rsvg-convert`：SVG 渲染。
- Noto 拉丁字体和 CJK 字体，以及用于文档和浏览器渲染的 WOFF 字体。

### 浏览器自动化

镜像包含 Chromium 和 Node.js 的 `playwright-core` 包。Chromium 位于共享的 Playwright
浏览器缓存中，由 `PLAYWRIGHT_BROWSERS_PATH` 指向；这里不保证它作为独立命令出现在
`PATH`。默认镜像不包含 Firefox 和 WebKit。

## 沙箱规格

| 属性 | 默认托管沙箱 |
|---|---|
| 操作系统 | Ubuntu 22.04 |
| 架构 | x86_64（amd64） |
| 默认用户与工作目录 | 非 root 用户 `user`，工作目录为 `/workspace`；`sudo` 无需密码。 |
| 计算规格 | 通过 Platform API key 创建的 Agent 使用 4 vCPU、4 GiB（`pro`）。 |
| 网络访问 | 默认 Environment 的 sandbox 出站访问为 `unrestricted`。 |

计算规格由平台分配，Platform API key 不能修改它。
Agent 在创建时固定默认 Environment，因此不同时间创建的 Agent 可能使用不同的基础镜像 revision。
默认流程和当前自定义限制见 [Environments](./environments.md)。

## 工作区与 Session scope {#workspace-and-session-scope}

一个 Agent 的 sessions 共享其 `/workspace`，使用不同 sandbox 实例的 sessions 也是如此。持久化和文件隔离见[文件与产物](./files.md#file-isolation)，对话生命周期见 [Sessions](./sessions.md)。
