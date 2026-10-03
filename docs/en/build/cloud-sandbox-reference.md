---
description: Check the languages, database clients, utilities, and resource sizes in the default ZooWork cloud sandbox.
---

# Cloud sandbox reference

The default ZooWork cloud sandbox is an isolated Linux environment for an agent's commands,
files, and browser-based work. It runs on the managed E2B backend. The software below is
available without a separate setup step.

This page describes the default sandbox image. Exact versions within the listed language and
tool series can change when the base image is rebuilt. Check the runtime when your application
requires an exact version. Custom Environment management is currently unavailable with
Platform API keys; see [Environments](./environments.md#api-availability).

## Programming languages

| Language | Default image | Package and build tools |
|---|---|---|
| Python | 3.12 | pip, uv |
| Node.js | 24 | npm, yarn, pnpm |
| Go | 1.22 | Go modules |
| Rust | 1.77 | cargo |
| Java | Temurin 21 | Maven 3, Gradle 8 |
| Ruby | 3.3 | gem, Bundler |
| PHP | 8.3 | Composer |
| C/C++ | GCC and G++ 13 | make, CMake |

The image includes Python data and document libraries such as pandas, Matplotlib, Pillow,
openpyxl, python-docx, python-pptx, pypdf, ReportLab, pdfplumber, pdf2image, pytesseract,
and markitdown. They are installed for `python3`. For Node.js document
work, `docx`, `pptxgenjs`, and `playwright-core` are available in the shared module path.
The image sets `NODE_PATH` for CommonJS `require()` resolution; an ESM `import` from your own
project does not use that fallback. In ESM, use `createRequire()` or install the dependency in
your project's `node_modules`.

Only the versions and tools listed here are part of the default image baseline. Check the
actual runtime before depending on another version or tool.

## Databases

| Database | Available in the sandbox |
|---|---|
| PostgreSQL | `psql` client. No PostgreSQL server is preinstalled or started. |
| Redis | `redis-cli` client. No Redis server is preinstalled or started. |
| SQLite | `sqlite3` command and language bindings such as Python's `sqlite3` module. |

`psql` and `redis-cli` can connect to a service that you provide, subject to the sandbox's
network access. Their presence does not create
a local database service. For the separate managed database available through the
`agent_db` tool, see [Agent Database](./data-storage.md).

## Utilities

### System and development

- `git`, `ssh`, and `scp` for source control and remote access.
- `curl` and `wget` for HTTP requests; `jq` for JSON processing.
- `tar`, `zip`, and `unzip` for archives.
- `ripgrep` (`rg`), `tree`, `htop`, `tmux`, and `screen`.
- `make`, `cmake`, `gcc`, and `g++` for builds.
- `docker` CLI. A Docker daemon inside the sandbox is not part of the default image.

### Text, documents, and media

- `sed`, `awk`, `grep`, `diff`, and `patch`; `vim` and `nano` editors.
- LibreOffice and `pandoc` for document conversion.
- Poppler tools including `pdftotext` and `pdftoppm`, plus `tesseract` for OCR.
- `ffmpeg` and `ffprobe` for media; `rsvg-convert` for SVG rendering.
- Noto Latin and CJK fonts, plus WOFF fonts for document and browser rendering.

### Browser automation

The image includes Chromium and the Node.js `playwright-core` package. Chromium is stored in
the shared Playwright browser cache, selected by `PLAYWRIGHT_BROWSERS_PATH`; it is not a
standalone browser command on `PATH`. Firefox and WebKit are not included in the default image.

## Sandbox specifications

| Property | Default managed sandbox |
|---|---|
| Operating system | Ubuntu 22.04 |
| Architecture | x86_64 (amd64) |
| Default user and working directory | Non-root `user`, with `/workspace` as the working directory. `sudo` runs without a password. |
| Compute | 4 vCPU, 4 GiB (`pro`) for Agents created with Platform API keys. |
| Network access | The default Environment uses `unrestricted` sandbox outbound access. |

The platform assigns the compute class; Platform API keys cannot change it. An Agent pins
the default Environment when it is created, so Agents created at different times can use
different base-image revisions. See [Environments](./environments.md) for the default workflow
and current customization limits.

## Workspace and session scope

An Agent's sessions share its `/workspace`, including sessions that use separate sandbox
instances. See [Files and artifacts](./files.md#file-isolation) for persistence and file
isolation, and [Sessions](./sessions.md) for the conversation lifecycle.
