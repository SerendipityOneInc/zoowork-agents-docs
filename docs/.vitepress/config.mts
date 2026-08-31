import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type DefaultTheme, type MarkdownRenderer } from 'vitepress'
import llmstxt from 'vitepress-plugin-llms'

// The home page draws its own layout from `home:` frontmatter, which buys the design its
// structure and costs it two guarantees the markdown body used to give it for free.
//
// The first is the dead-link check: VitePress only validates links written as markdown, so a
// page renamed out from under the home page's chips would ship a 404 on a green build.
// `checkHomePage` walks the parsed frontmatter — the same object the component reads, not a
// regex over the raw text, so quoting, folding and flow style cannot fool it — and resolves
// every link against the source tree.
//
// The second is shape: with the content in frontmatter, a mistyped key renders an empty
// section rather than failing anywhere. So the required blocks are asserted too, along with
// `home.hero.accent` still being the tail of `hero.text` (the component colours the headline
// by splitting on it, and silently drops the accent when they drift apart).

/* Any key whose name ends in `link` holds one — `link` itself, and `noteLink`, which the
   page renders and the first version of this walk quietly skipped. */
function collectLinks(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectLinks(item, out)
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string') {
        if (/link$/i.test(key)) out.add(value)
      } else {
        collectLinks(value, out)
      }
    }
  }
}

function checkSourceHash(
  relativePath: string,
  frontmatter: Record<string, any>,
  srcDir: string,
): string[] {
  if (typeof frontmatter.source !== 'string') return []

  const sourceFile = `${frontmatter.source.replace(/\/$/, '/index')}.md`.replace(/^\//, '')
  const expected = createHash('sha256').update(readFileSync(join(srcDir, sourceFile))).digest('hex')
  if (frontmatter.source_hash === expected) return []

  return [
    `${relativePath}: source_hash is ${frontmatter.source_hash ?? 'missing'}, but ${sourceFile} ` +
      `now hashes to ${expected}. Re-translate any changed copy, then record the new hash.`,
  ]
}

function checkHomePage(relativePath: string, frontmatter: Record<string, any>, srcDir: string): string[] {
  const problems: string[] = []
  const fail = (message: string) => problems.push(`${relativePath}: ${message}`)

  const home = frontmatter.home
  if (!home || typeof home !== 'object') {
    fail('no `home:` block — the page would render blank')
    return problems
  }

  // Each of these drives a section of the page; an empty one is a section that vanishes.
  // Written as paths so the name appears once rather than as a string and an expression
  // that have to be kept pointing at the same thing.
  for (const path of ['hero.actions', 'nouns.items', 'journey.stages', 'band.columns']) {
    const value = path.split('.').reduce<any>((node, key) => node?.[key], home)
    if (!Array.isArray(value) || value.length === 0) fail(`\`home.${path}\` is missing or empty`)
  }

  const links = new Set<string>()
  collectLinks(home, links)
  for (const link of links) {
    if (!link.startsWith('/')) continue // external or relative; VitePress does not resolve these
    // Match VitePress's own normalisation before resolving: drop the anchor or query, and read
    // a trailing slash as that directory's index.
    const path = link.replace(/[?#].*$/, '').replace(/\/$/, '/index')
    if (!existsSync(join(srcDir, `${path}.md`))) fail(`link "${link}" has no page behind it`)
  }

  const text = frontmatter.hero?.text
  const accent = home.hero?.accent
  if (typeof text !== 'string' || !text.trim()) {
    fail('`hero.text` is missing — llms.txt takes the site description from it')
  } else if (typeof accent !== 'string' || !accent.trim()) {
    fail('`home.hero.accent` is missing, so the headline renders in one colour')
  } else if (!text.endsWith(accent)) {
    fail(`\`home.hero.accent\` ("${accent}") is no longer the tail of \`hero.text\` ("${text}")`)
  }

  return problems
}

// Reference tables here are three and four columns of prose - the capability matrix, the
// method lists, the event vocabulary - and on a phone they can only scroll sideways, which
// is how the page a reader is told to consult before choosing an architecture becomes the
// least readable page on the site. The stylesheet turns those rows into stacked records
// under 768px; a stacked cell loses its column unless it carries the header with it, so
// this stamps each `td` with its column name and marks the table as stackable.
//
// Build time, not client side: the attributes ship in the HTML and cost nothing at runtime.
// Two-column tables are left alone - they already fit.
function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
    .replace(/\\\|/g, '|')
    .trim()
}

function stackableTables(md: MarkdownRenderer): void {
  // VitePress replaces the `table_open` renderer outright to add `tabindex="0"`, which
  // discards token attributes, so the flag has to be re-emitted here rather than set with
  // `attrSet` alone. Keep the tabindex: it is what makes a wide table scrollable by keyboard.
  md.renderer.rules.table_open = (tokens, idx) =>
    tokens[idx]!.attrGet('data-stackable') === null
      ? '<table tabindex="0">\n'
      : '<table tabindex="0" data-stackable>\n'

  md.core.ruler.push('zc_stackable_tables', (state) => {
    let tableOpen: (typeof state.tokens)[number] | null = null
    let headers: string[] = []
    let inHead = false
    let inBody = false
    let column = 0

    for (const token of state.tokens) {
      switch (token.type) {
        case 'table_open':
          tableOpen = token
          headers = []
          break
        case 'thead_open':
          inHead = true
          break
        case 'thead_close':
          inHead = false
          if (tableOpen && headers.length >= 3) tableOpen.attrSet('data-stackable', '')
          break
        case 'tbody_open':
          inBody = true
          break
        case 'tbody_close':
          inBody = false
          break
        case 'tr_open':
          column = 0
          break
        case 'inline':
          if (inHead) headers.push(plainText(token.content))
          break
        case 'td_open': {
          if (!inBody) break
          const header = headers[column]
          if (header) token.attrSet('data-th', header)
          column += 1
          break
        }
        case 'table_close':
          tableOpen = null
          headers = []
          break
      }
    }
  })
}

// Navigation runs Get started / Build / Reference. Where a capability does not
// exist, the page still exists under Reference and says so — silence reads as
// "not documented yet", which is the one thing we cannot afford.
//
// The site is bilingual. English is the authored source: the SDK, its errors, and
// every identifier in this documentation are English, so that is where a claim is
// written first. Chinese pages are translations of a specific English revision and
// carry `source` + `source_hash` frontmatter so drift is detectable rather than
// silent. Readers land on English; Chinese is one click away in the language menu.

interface PageSet {
  getStarted: string
  quickstart: string
  authentication: string
  concepts: string
  build: string
  agents: string
  sessions: string
  events: string
  channels: string
  tools: string
  skills: string
  perUserAgents: string
  environments: string
  reference: string
  sdk: string
  errors: string
  capabilities: string
  // The nav bar says this instead of `capabilities` — see the EN entry for why.
  capabilitiesNav: string
  notSupported: string
}

const EN: PageSet = {
  getStarted: 'Get started',
  quickstart: 'Quickstart',
  authentication: 'Authentication',
  concepts: 'Core concepts',
  build: 'Build',
  agents: 'Agents',
  sessions: 'Sessions',
  events: 'Events and streaming',
  channels: 'Channels',
  tools: 'Tools',
  skills: 'Skills',
  perUserAgents: 'An agent per user',
  environments: 'Environments',
  reference: 'Reference',
  sdk: 'TypeScript SDK',
  errors: 'Errors',
  capabilities: 'Capability matrix',
  // The nav bar is a single row that has to hold the site title, the search box, every
  // top-level label and the language menu inside the viewport, and from 768px up VitePress
  // shows all of it at once. "Capability matrix" is the longest label here and it was what
  // pushed that row past the edge; the sidebar has a column to itself and keeps the full
  // wording. See the 768–959px block in theme/custom.css for the rest of that fix.
  capabilitiesNav: 'Capabilities',
  notSupported: 'Not supported',
}

const ZH: PageSet = {
  getStarted: '开始使用',
  quickstart: '快速开始',
  authentication: '鉴权',
  concepts: '核心概念',
  build: '构建',
  agents: 'Agents',
  sessions: 'Sessions',
  events: '事件与流式',
  channels: '渠道',
  tools: '工具',
  skills: 'Skills',
  perUserAgents: '每用户一个 agent',
  environments: 'Environments',
  reference: '参考',
  sdk: 'TypeScript SDK',
  errors: '错误处理',
  capabilities: '能力矩阵',
  // Four Chinese characters already fit; nothing to shorten.
  capabilitiesNav: '能力矩阵',
  notSupported: '不支持的能力',
}

function sidebar(t: PageSet, base: string): DefaultTheme.SidebarItem[] {
  return [
    {
      text: t.getStarted,
      items: [
        { text: t === EN ? 'Overview' : '概览', link: `${base}/` },
        { text: t.quickstart, link: `${base}/get-started/quickstart` },
        { text: t.authentication, link: `${base}/get-started/authentication` },
        { text: t.concepts, link: `${base}/get-started/concepts` },
      ],
    },
    {
      text: t.build,
      items: [
        { text: t.agents, link: `${base}/build/agents` },
        { text: t.sessions, link: `${base}/build/sessions` },
        { text: t.events, link: `${base}/build/events` },
        { text: t.channels, link: `${base}/build/channels` },
        { text: t.tools, link: `${base}/build/tools` },
        { text: t.skills, link: `${base}/build/skills` },
        { text: t.perUserAgents, link: `${base}/build/per-user-agents` },
        { text: t.environments, link: `${base}/build/environments` },
      ],
    },
    {
      text: t.reference,
      items: [
        { text: t.sdk, link: `${base}/reference/typescript-sdk` },
        { text: t.errors, link: `${base}/reference/errors` },
        { text: t.capabilities, link: `${base}/reference/capabilities` },
        { text: t.notSupported, link: `${base}/reference/not-supported` },
      ],
    },
  ]
}

function nav(t: PageSet, base: string): DefaultTheme.NavItem[] {
  return [
    { text: t.getStarted, link: `${base}/get-started/quickstart` },
    { text: t.build, link: `${base}/build/agents` },
    { text: t.reference, link: `${base}/reference/typescript-sdk` },
    { text: t.capabilitiesNav, link: `${base}/reference/capabilities` },
  ]
}

export default defineConfig({
  title: 'ZooWork Managed Agents',
  description: 'Build agent products on ZooWork. TypeScript SDK, sessions, and streaming events.',
  // The site does not own a host of its own: it is served from a path on the main
  // domain, at zoowork.ai/docs, next to /blog and /industry. `base` puts that prefix
  // on every generated URL; `outDir` mirrors the prefix in the build output so the
  // deployed asset tree is laid out exactly like the public URL space. Cloudflare
  // serves `dist/` at the zone root, so `dist/docs/en/…` answers `/docs/en/…` with no
  // path rewriting and therefore no Worker code in front of the assets.
  base: '/docs/',
  outDir: '../dist/docs',
  cleanUrls: true,
  lastUpdated: true,
  sitemap: {
    // VitePress requires the deployment base in the hostname when the site is served
    // from a sub-path. This emits /docs/sitemap.xml with canonical /docs/... URLs.
    hostname: 'https://zoowork.ai/docs/',
  },
  // Matches the page surface in each scheme, so the mobile browser chrome does not sit on
  // the page as a separate colour. The palette itself is in theme/custom.css.
  head: [
    ['meta', { name: 'theme-color', media: '(prefers-color-scheme: light)', content: '#ffffff' }],
    ['meta', { name: 'theme-color', media: '(prefers-color-scheme: dark)', content: '#0d1117' }],
  ],
  markdown: { config: stackableTables },
  transformPageData(pageData, { siteConfig }) {
    // Every rendered page gets a canonical URL. Locale pages also point crawlers at their
    // translated counterpart, while x-default stays on the authored English source.
    const route = pageData.relativePath.replace(/index\.md$/, '').replace(/\.md$/, '')
    const locale = route.match(/^(en|zh)\//)?.[1]
    const canonicalRoute = locale ? route : 'en/'
    const canonical = new URL(canonicalRoute, 'https://zoowork.ai/docs/').href
    const head = (pageData.frontmatter.head ??= [])
    head.push(['link', { rel: 'canonical', href: canonical }])

    if (locale) {
      const suffix = route.slice(locale.length)
      const english = new URL(`en${suffix}`, 'https://zoowork.ai/docs/').href
      const chinese = new URL(`zh${suffix}`, 'https://zoowork.ai/docs/').href
      head.push(
        ['link', { rel: 'alternate', hreflang: 'en-US', href: english }],
        ['link', { rel: 'alternate', hreflang: 'zh-CN', href: chinese }],
        ['link', { rel: 'alternate', hreflang: 'x-default', href: english }],
      )
    }

    const sourceProblems = checkSourceHash(
      pageData.relativePath,
      pageData.frontmatter,
      siteConfig.srcDir,
    )
    if (sourceProblems.length > 0) {
      throw new Error(`Translation drift check failed:\n  ${sourceProblems.join('\n  ')}`)
    }

    // Keyed off the frontmatter rather than a list of locale paths: a page that declares
    // `home:` is a page that renders ZcHome, and every locale's index is expected to declare
    // one — so a third language is covered without editing anything here.
    const isLocaleIndex = /^[^/]+\/index\.md$/.test(pageData.relativePath)
    if (!pageData.frontmatter.home && !isLocaleIndex) return
    const problems = checkHomePage(pageData.relativePath, pageData.frontmatter, siteConfig.srcDir)
    if (problems.length > 0) throw new Error(`Home page check failed:\n  ${problems.join('\n  ')}`)
  },
  // Exactly two locales, both under a prefix. Do NOT add a `root` entry: VitePress puts
  // every key in this object into the language menu, so a root locale labelled 'English'
  // would show up alongside `en` as a second, identical "English" choice. `docs/index.md`
  // lives outside both prefixes and just redirects / → /en/; it needs no locale of its own.
  locales: {
    zh: {
      label: '简体中文',
      lang: 'zh-CN',
      link: '/zh/',
      description: '在 ZooWork 上构建你自己的 agent 产品。TypeScript SDK、会话与流式事件。',
      themeConfig: {
        nav: nav(ZH, '/zh'),
        sidebar: sidebar(ZH, '/zh'),
        outlineTitle: '本页目录',
        docFooter: { prev: '上一页', next: '下一页' },
        darkModeSwitchLabel: '主题',
        returnToTopLabel: '回到顶部',
        langMenuLabel: '切换语言',
      },
    },
    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      themeConfig: { nav: nav(EN, '/en'), sidebar: sidebar(EN, '/en') },
    },
  },
  themeConfig: {
    search: { provider: 'local' },
    outline: [2, 3],
    footer: {
      message: 'Developer Preview — the API may change before general availability.',
    },
  },
  // Emit /llms.txt and /llms-full.txt so an AI coding assistant can read this site
  // without scraping rendered HTML.
  //
  // English only, deliberately. The two trees say the same things, so including both
  // would roughly double the token cost of llms-full.txt while adding no information —
  // and the identifiers an assistant needs are English on both sides anyway.
  //
  // The English index page is kept (the plugin drops index pages by default), but what it
  // contributes changed when the home page moved its layout into frontmatter: the plugin
  // emits the markdown BODY only, so llms.txt now takes its title and description from
  // `hero.text` / `hero.tagline`, and the index's own entry carries the canonical
  // create-start-session-stream snippet plus the paragraph naming what the API does not do.
  // The longer orientation lives in get-started/concepts and reference/not-supported, both
  // of which are in the same bundle. Keep `hero.text` and `hero.tagline` where they are —
  // renaming them silently falls back to the site description and drops the tagline line.
  // The root docs/index.md stays out — it is only a redirect stub.
  vite: {
    plugins: [
      llmstxt({
        workDir: 'en',
        excludeIndexPage: false,
      }),
    ],
  },
})
