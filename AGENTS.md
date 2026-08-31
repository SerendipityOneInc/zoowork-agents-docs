# Repository instructions

This repository publishes both human-facing HTML and AI-facing Markdown. Treat them as
one product.

## Required final review for every documentation change

After changing anything under `docs/`:

1. Run `pnpm build`. The build also runs `scripts/check-ai-docs.mjs`.
2. Read `dist/docs/llms.txt` in full. Confirm its title, summary, page descriptions, page
   inventory, and ordering still describe the site accurately.
3. Review the affected sections in `dist/docs/llms-full.txt` and the affected generated
   `dist/docs/**/*.md` pages. Confirm examples, warnings, status labels, and internal links
   survived generation.
4. If the AI output is incomplete or misleading, update the source Markdown or the
   `vitepress-plugin-llms` configuration in the same change. Never patch `dist/`; it is a
   generated, gitignored directory.

Do not call a documentation task complete based only on the rendered VitePress page.
