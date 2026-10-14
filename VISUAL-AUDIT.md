# ZooWork website alignment — 2026-10-09

Reference: https://zoowork.ai/ . Values sampled from rendered page computed styles at desktop and narrow widths, rather than inferred from screenshots.

| Token | Live website | Documentation adaptation |
| --- | --- | --- |
| Main content font | Inter, system sans-serif | Bundled Inter variable Latin font; Noto Sans SC / PingFang SC / Microsoft YaHei fallback for Chinese |
| Display font | GFS Didot, 400 | Bundled GFS Didot for homepage hero; Songti SC fallback |
| Website navigation | Roboto / Noto Sans SC, 14px | Inter / Chinese system fallback, existing VitePress navigation sizes |
| Main ink | #0e0522 | Shared ink and action token |
| Emphasized text / links | Documentation brand accent | Original purple #5755c6 retained at user request |
| Body ink | #3b3846 | Secondary text token |
| Website muted ink | #7d7895 | #706a86 for small documentation labels and focus visibility |
| Surfaces | #ffffff / #f7f7f7 | White reading surface, light gray sidebar and callouts |
| Website h1 | 72px / 1.08, 400, -0.025em; narrow 48px | Homepage 48–64px desktop, 36–44px phone; same weight, line height and tracking |
| Website section titles | 48–52px, 500, -0.025em | Homepage 34px; article h1 40px, h2 30px, h3 24px; phone 32/24/20px |
| Website prose | 16px / 1.8; hero 18px / 1.625 | Article 16px / 1.8; homepage hero and section subtitles 17px / 1.6 in #7d7895 |
| Website container | max-width 1240px, desktop gutters 32px | Homepage max-width 1240px, existing 24/20px gutters; article reading column retained |
| Section rhythm | 64–84px block padding | Homepage 64px sections, 72px hero |
| Primary action | #0e0522, white text, radius 6px | Same colors and radius, 48px homepage button height |

The reference body has DM Sans defaults, but the visible marketing sections explicitly use Inter; documentation follows those sections. The reference has no sampled dark theme; documentation retains its existing dark surfaces with adapted light ink and link colors. Chinese uses local fallbacks when Noto Sans SC is unavailable. JetBrains Mono remains for code.

Main homepage section dividers remain; decorative rules on concept cards, workflow rows and article headings are removed. Selected homepage code tabs use neutral gray.

## Validation

- Initial checkout: main, no tracked or untracked modifications.
- pnpm build passed, including AI docs check: 32 index entries, 32 Markdown pages, 64 locale HTML pages and 64 sitemap pages.
- Read llms.txt in full and reviewed generated homepage Markdown and its llms-full.txt section: examples and internal links remain intact.
- Bundled font files emitted into the production assets successfully.
- Browser checks: English homepage and Quickstart desktop; 390px article navigation to Overview; 390px Chinese homepage; 768px English Quickstart. No document horizontal overflow at tested widths.
- Dark mode switch changes to dark surfaces and readable light ink.
- git diff --check passed.
- Local preview: http://localhost:5175/docs/ .
