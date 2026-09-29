---
description: Check the languages, database clients, utilities, and resource sizes in the default ZooWork cloud sandbox.
---

# Cloud sandbox reference

The default ZooWork cloud sandbox is an isolated Linux environment for an agent's commands,
files, and browser-based work. It runs on the managed E2B backend. The software below is
available without creating a custom [Environment](./environments.md).

This page describes the default sandbox image. A custom Environment starts from the managed
base image and can add apt, npm, and pip packages, files, and build steps. Exact patch versions
can change when the base image is rebuilt. If your application requires an exact version, check
it in the sandbox or pin the needed dependency in a custom Environment.

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

Only the versions and tools listed here are part of the default image baseline. Check the
actual runtime before depending on another version or tool.

## Databases

| Database | Available in the sandbox |
|---|---|
| PostgreSQL | `psql` client. No PostgreSQL server is preinstalled or started. |
| Redis | `redis-cli` client. No Redis server is preinstalled or started. |
| SQLite | `sqlite3` command and language bindings such as Python's `sqlite3` module. |

`psql` and `redis-cli` can connect to a service that you provide, subject to the Environment's
[network policy](./environments.md#what-an-environment-holds). Their presence does not create
a local database service.

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
standalone browser command promised on `PATH`. The base image does not include Firefox or
WebKit as part of its verified browser baseline.

## Sandbox specifications

| Property | Default managed sandbox |
|---|---|
| Operating system | Ubuntu 22.04 |
| Architecture | x86_64 (amd64) |
| Default user and working directory | Non-root `user`, with `/workspace` as the working directory. `sudo` runs without a password. |
| Compute classes | `starter`: 2 vCPU, 2 GiB; `pro`: 4 vCPU, 4 GiB; `ultra`: 8 vCPU, 8 GiB |
| Network access | Set by the Environment's `networking` policy; omitting it defaults to `unrestricted`. |

The platform selects the resource class for an agent. The sandbox's software comes from its
resolved Environment version, so inspect that version when comparing agents built at different
times. See [Environments](./environments.md) to add dependencies and pin an Environment to an
agent.
