# zooclaw-docs

Public developer documentation for ZooClaw Managed Agents.

```bash
pnpm install
pnpm dev        # http://localhost:5175/docs/
pnpm build
```

## Deployment

The site is served from **https://zooclaw.ai/docs** by an assets-only Cloudflare
Worker named `zooclaw-docs` — no Worker code runs, every request is answered from
the static build.

Because it lives on a path rather than its own host, two settings in
`docs/.vitepress/config.mts` have to agree with `wrangler.jsonc`:

- `base: '/docs/'` puts the prefix on every generated URL.
- `outDir: '../dist/docs'` mirrors that prefix in the build output, so the asset
  tree matches the public URL space and Cloudflare needs no path rewriting.

Change one and you must change the other, or the site will 404 on its own assets.

`main` deploys automatically via Workers Builds (Cloudflare's Git integration).
To deploy by hand:

```bash
pnpm run deploy   # NOT `pnpm deploy` — that is a built-in pnpm command
```

Local preview against the real runtime, including path routing and 404 handling:

```bash
pnpm build && pnpm preview:worker   # http://localhost:8787/docs/
```

## What belongs here

This site is written for **external developers** building products on ZooClaw:
the TypeScript SDK, the `/service/v1` gateway, and an API key. It is not the
internal operations manual.

Its information architecture deliberately mirrors Claude Managed Agents, so a
developer who already knows those docs can find the equivalent page. Where a
capability does not exist here, the page still exists and says so — see
`docs/en/reference/capabilities.md` and `docs/en/reference/not-supported.md`.

## Rules

- **Every claim is verified or labelled.** A capability is documented as working
  only if it has been exercised against a live deployment. Anything else carries
  an explicit status note. See the capability matrix for the levels.
- **Bilingual.** English under `docs/en/` is the authored source; `docs/zh/` carries
  `source` + `source_hash` frontmatter pointing at the English revision it tracks.
- **No unlabelled roadmap.** If something is planned but absent, it goes under
  "Not supported" with what to do instead, not into a future-tense sentence in a
  guide.
