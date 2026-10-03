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

## Writing standard

These pages are read by developers and by their coding agents. Both need the same thing:
what a feature does and the shortest correct way to use it. The
[Claude Managed Agents docs](https://platform.claude.com/docs/en/managed-agents/overview)
are the reference for page shape and voice. Open the matching Claude page before writing
or restructuring one of ours.

### Pages state what is true now

A guide describes current production behavior and nothing else. When a statement on a page
does not match what the service does, there are two valid outcomes:

- the service is fixed so that the statement holds, or
- the statement is narrowed until it is true. For example, "an `allow` list restricts the
  Agent's tools" becomes a sentence that names the tools the list applies to.

Do not keep the statement and add a warning, a workaround, or a known-issue note beside it.
Defects are tracked as issues in the repository that owns the behavior, not on this site.

### Page shape for guides under `build/`

1. Opening. One or two paragraphs: what the feature is, and the one idea the reader must
   hold before the first example. No prerequisites list.
2. Task sections. Each `##` is something the reader does, titled as an imperative
   ("Attach a Skill to an Agent"). Inside, in this order: one to three sentences, the code
   group, a field table if there are fields, then limits as plain sentences.
3. A failure section, if the feature has its own failure modes: what happens, the error
   codes in a table, and what the application can do.
4. Next steps.

Every example runs as written after Quickstart and uses the names Quickstart declares.
Code groups show the same operation in TypeScript, Python, and curl.

### Where each kind of information goes

| What you have | Where it goes |
|---|---|
| A sentence on the page is false | Rewrite that sentence. Do not append a correction after it. |
| How the product behaves by design, including limits | The section it applies to, as a plain statement. |
| A capability that does not exist, or is not live in production | `reference/not-supported.md` only. |
| An error the reader can receive | `reference/errors.md`: code, cause, action. |
| A behavior change, a new capability, a new SDK version requirement | The changelog. The page body describes only the current state. |
| Whether a feature is beta or generally available | The page's `status` frontmatter. Not prose in the body. |
| How a problem was found, debugging steps, defensive habits | Not on this site. Guidance for coding agents belongs in `zoowork-sdk-skills`. |
| Verification status, evidence, test coverage | The internal audit record. Never on a page. |

Test for any sentence in a guide: would it still be here if the service had no defects and
the reader had the current SDK? If not, it belongs in another row or nowhere.

### Voice

- State behavior in the present tense, as fact: "An upload does not preserve file modes;
  call scripts with `bash scripts/run.sh`."
- Say what to do. Use "do not" only for a mistake a reasonable reader would make, and give
  the correct action in the same sentence.
- No hedges about deployment, such as "on supporting deployments", "source-reviewed", or
  "confirm support first".
- No sentences about how to interpret types, probes, or evidence.

### Callouts

At most two per page. A callout is for a security boundary, a cost, or an irreversible
action. A workaround is never a callout. If a page seems to need a third, restructure the
section.

### Editing

The unit of change is the section, not the sentence. After any change, reread the whole
section and confirm it still reads as "how to use this feature". A change that only adds a
sentence to the end of a paragraph is usually in the wrong place.

### Alignment with Claude

`notes/claude-alignment.md` maps each page to its Claude counterpart, lists the concept
names on both sides, and records each intentional difference with its reason. Follow the
Claude page's section order. Use ZooWork's real API names and behavior. Never describe a
Claude capability that ZooWork lacks.
