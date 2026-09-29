---
title: 云沙箱参考
description: 查看 ZooWork 默认云沙箱中的编程语言、数据库客户端、实用工具和资源规格。
source: /en/build/cloud-sandbox-reference
source_hash: 6fb73f86bcbe4ade105384bab1e1ec5347435687b5c84e7a46597b2bf7b818cc
---

# 云沙箱参考

ZooWork 默认云沙箱是 Agent 执行命令、处理文件和使用浏览器的隔离 Linux 环境，由托管的 E2B
backend 提供。下面列出的软件无需创建自定义 [Environment](./environments.md) 就能使用。

本页描述默认沙箱镜像。自定义 Environment 以托管基础镜像为起点，可以添加 apt、npm、pip
包、文件和构建步骤。基础镜像重建后，软件的 patch 版本可能变化。如果应用依赖精确版本，
请在沙箱内检查，或在自定义 Environment 中固定所需依赖。

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
`playwright-core`。

默认镜像的基础清单以本页列出的版本和工具为准。依赖其他版本或工具前，请先检查实际运行环境。

## 数据库

| 数据库 | 沙箱内可用内容 |
|---|---|
| PostgreSQL | `psql` 客户端；没有预装或启动 PostgreSQL 服务端。 |
| Redis | `redis-cli` 客户端；没有预装或启动 Redis 服务端。 |
| SQLite | `sqlite3` 命令，以及 Python `sqlite3` 模块等语言绑定。 |

`psql` 和 `redis-cli` 可以连接你提供的服务，但还要遵守 Environment 的
[网络策略](./environments.md#一个-environment-里有什么)。客户端存在，不表示沙箱内有本地数据库服务。

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
`PATH`。Firefox 和 WebKit 不在基础镜像已验证的浏览器清单中。

## 沙箱规格

| 属性 | 默认托管沙箱 |
|---|---|
| 操作系统 | Ubuntu 22.04 |
| 架构 | x86_64（amd64） |
| 默认用户与工作目录 | 非 root 用户 `user`，工作目录为 `/workspace`；`sudo` 无需密码。 |
| 计算规格 | `starter`：2 vCPU、2 GiB；`pro`：4 vCPU、4 GiB；`ultra`：8 vCPU、8 GiB |
| 网络访问 | 由 Environment 的 `networking` 策略决定；省略时默认 `unrestricted`。 |

平台为 Agent 选择计算规格。沙箱内的软件来自它解析到的 Environment version；比较不同时间
创建的 Agent 时，应查看各自固定的版本。添加依赖和绑定 Environment 的方法见
[Environments](./environments.md)。
