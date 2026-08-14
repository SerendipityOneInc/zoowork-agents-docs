import { defineConfig, type DefaultTheme } from 'vitepress'
import llmstxt from 'vitepress-plugin-llms'

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
  tools: string
  skills: string
  environments: string
  reference: string
  sdk: string
  errors: string
  capabilities: string
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
  tools: 'Tools',
  skills: 'Skills',
  environments: 'Environments',
  reference: 'Reference',
  sdk: 'TypeScript SDK',
  errors: 'Errors',
  capabilities: 'Capability matrix',
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
  tools: '工具',
  skills: 'Skills',
  environments: 'Environments',
  reference: '参考',
  sdk: 'TypeScript SDK',
  errors: '错误处理',
  capabilities: '能力矩阵',
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
        { text: t.tools, link: `${base}/build/tools` },
        { text: t.skills, link: `${base}/build/skills` },
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
    { text: t.capabilities, link: `${base}/reference/capabilities` },
  ]
}

export default defineConfig({
  title: 'ZooClaw Managed Agents',
  description: 'Build agent products on ZooClaw. TypeScript SDK, sessions, and streaming events.',
  // The site does not own a host of its own: it is served from a path on the main
  // domain, at zooclaw.ai/docs, next to /blog and /industry. `base` puts that prefix
  // on every generated URL; `outDir` mirrors the prefix in the build output so the
  // deployed asset tree is laid out exactly like the public URL space. Cloudflare
  // serves `dist/` at the zone root, so `dist/docs/en/…` answers `/docs/en/…` with no
  // path rewriting and therefore no Worker code in front of the assets.
  base: '/docs/',
  outDir: '../dist/docs',
  cleanUrls: true,
  lastUpdated: true,
  head: [['meta', { name: 'theme-color', content: '#2f6f4f' }]],
  // Exactly two locales, both under a prefix. Do NOT add a `root` entry: VitePress puts
  // every key in this object into the language menu, so a root locale labelled 'English'
  // would show up alongside `en` as a second, identical "English" choice. `docs/index.md`
  // lives outside both prefixes and just redirects / → /en/; it needs no locale of its own.
  locales: {
    zh: {
      label: '简体中文',
      lang: 'zh-CN',
      link: '/zh/',
      description: '在 ZooClaw 上构建你自己的 agent 产品。TypeScript SDK、会话与流式事件。',
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
  // The English index page is kept (the plugin drops index pages by default): it carries
  // the orientation an assistant most needs up front, namely what this API is and what
  // it is not. The root docs/index.md stays out — it is only a redirect stub.
  vite: {
    plugins: [
      llmstxt({
        workDir: 'en',
        excludeIndexPage: false,
      }),
    ],
  },
})
