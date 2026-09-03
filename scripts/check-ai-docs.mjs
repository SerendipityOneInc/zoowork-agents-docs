import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, posix, relative, resolve } from 'node:path'

const outputRoot = resolve('dist/docs')
const docsUrl = 'https://zoowork.ai/docs/'
const failures = []

function fail(message) {
  failures.push(message)
}

function filesUnder(directory, extension) {
  const files = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) files.push(...filesUnder(path, extension))
    else if (path.endsWith(extension)) files.push(path)
  }
  return files
}

function tagAttributes(content, tagName) {
  const tags = content.match(new RegExp(`<${tagName}\\b[^>]*>`, 'g')) ?? []
  return tags.map((tag) =>
    Object.fromEntries(
      [...tag.matchAll(/([:\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]),
    ),
  )
}

function expectedAlternates(url) {
  let path
  try {
    path = new URL(url).pathname
  } catch {
    return
  }
  const match = path.match(/^\/docs\/(en|zh)(\/.*|$)/)
  if (!match) return

  const suffix = match[2]
  const english = new URL(`en${suffix}`, docsUrl).href
  const chinese = new URL(`zh${suffix}`, docsUrl).href

  return new Map([
    ['en', english],
    ['zh', chinese],
    ['x-default', english],
  ])
}

function checkAlternates(label, links, expected) {
  if (links.length !== expected.size) {
    fail(`${label} should have exactly ${expected.size} alternate links, found ${links.length}`)
  }

  const actual = new Map()
  for (const link of links) {
    const language = link.hreflang
    const href = link.href
    if (!language || !href) {
      fail(`${label} has an alternate link without hreflang or href`)
      continue
    }
    if (actual.has(language)) fail(`${label} has duplicate ${language} alternate links`)
    actual.set(language, href)
  }

  for (const [language, href] of expected) {
    if (actual.get(language) !== href) {
      fail(`${label} has an incorrect or missing ${language} alternate URL`)
    }
  }
  for (const language of actual.keys()) {
    if (!expected.has(language)) fail(`${label} has unexpected ${language} alternate URL`)
  }

  return actual
}

function sameLinks(left, right) {
  return (
    left.size === right.size &&
    [...left].every(([language, href]) => right.get(language) === href)
  )
}

if (!existsSync(outputRoot)) {
  console.error('AI docs check failed: dist/docs does not exist. Run `pnpm build` first.')
  process.exit(1)
}

const llmsPath = join(outputRoot, 'llms.txt')
const fullPath = join(outputRoot, 'llms-full.txt')
const sitemapPath = join(outputRoot, 'sitemap.xml')

for (const path of [llmsPath, fullPath, sitemapPath]) {
  if (!existsSync(path)) fail(`${relative(outputRoot, path)} was not generated`)
}

const llms = existsSync(llmsPath) ? readFileSync(llmsPath, 'utf8') : ''
const full = existsSync(fullPath) ? readFileSync(fullPath, 'utf8') : ''
const sitemap = existsSync(sitemapPath) ? readFileSync(sitemapPath, 'utf8') : ''
const tocEntries = [...llms.matchAll(/^- \[([^\]]+)]\((\/docs\/[^)]+\.md)\): (.+)$/gm)]

if (!llms.startsWith('# ZooWork Managed Agents\n')) fail('llms.txt has an unexpected title')
if (tocEntries.length !== 16) {
  fail(`llms.txt should describe 16 English pages, found ${tocEntries.length}`)
}

const tocTargets = new Set()
for (const [, title, url, description] of tocEntries) {
  if (!description.trim()) fail(`llms.txt entry "${title}" has no description`)
  if (tocTargets.has(url)) fail(`llms.txt contains duplicate target ${url}`)
  tocTargets.add(url)

  const target = join('dist', url)
  if (!existsSync(target)) fail(`llms.txt target does not exist: ${url}`)
}

const markdownFiles = filesUnder(outputRoot, '.md')
for (const file of markdownFiles) {
  const content = readFileSync(file, 'utf8')
  for (const match of content.matchAll(/\[[^\]]*]\(([^)]+)\)/g)) {
    const rawTarget = match[1].trim()
    if (
      rawTarget.startsWith('#') ||
      rawTarget.startsWith('http://') ||
      rawTarget.startsWith('https://') ||
      rawTarget.startsWith('mailto:')
    ) {
      continue
    }

    const targetWithoutFragment = rawTarget.split(/[?#]/, 1)[0]
    if (!targetWithoutFragment) continue

    const resolvedTarget = targetWithoutFragment.startsWith('/')
      ? join('dist', targetWithoutFragment)
      : resolve(dirname(file), targetWithoutFragment)

    if (!resolvedTarget.endsWith('.md')) {
      fail(`${relative(outputRoot, file)} links to non-Markdown AI target: ${rawTarget}`)
    } else if (!existsSync(resolvedTarget)) {
      fail(`${relative(outputRoot, file)} has broken AI link: ${rawTarget}`)
    }
  }
}

const expectedHtmlPages = filesUnder(resolve('docs'), '.md')
  .filter((file) => !file.includes(`${posix.sep}.vitepress${posix.sep}`))
  .map((file) => relative(resolve('docs'), file).replace(/\\/g, '/'))
  .filter((file) => file.startsWith('en/') || file.startsWith('zh/'))
  .map((file) => {
    const route = file.replace(/index\.md$/, '').replace(/\.md$/, '')
    return `https://zoowork.ai/docs/${route}`
  })

if (expectedHtmlPages.length !== 32) {
  fail(`source should contain 32 locale pages, found ${expectedHtmlPages.length}`)
}
const expectedHtmlPageSet = new Set(expectedHtmlPages)
if (expectedHtmlPageSet.size !== expectedHtmlPages.length) {
  fail('source locale pages resolve to duplicate production URLs')
}

const localeHtmlFiles = filesUnder(outputRoot, '.html').filter((file) => {
  const path = relative(outputRoot, file).replace(/\\/g, '/')
  return path.startsWith('en/') || path.startsWith('zh/')
})

if (localeHtmlFiles.length !== expectedHtmlPages.length) {
  fail(
    `build should contain ${expectedHtmlPages.length} locale HTML pages, ` +
      `found ${localeHtmlFiles.length}`,
  )
}

const htmlAlternatesByUrl = new Map()
for (const file of localeHtmlFiles) {
  const path = relative(outputRoot, file).replace(/\\/g, '/')
  const route = path.replace(/index\.html$/, '').replace(/\.html$/, '')
  const locale = route.split('/', 1)[0]
  const suffix = route.slice(locale.length)
  const english = `https://zoowork.ai/docs/en${suffix}`
  const chinese = `https://zoowork.ai/docs/zh${suffix}`
  const canonical = locale === 'en' ? english : chinese
  const content = readFileSync(file, 'utf8')

  if (!content.includes(`<meta name="description" content="`)) {
    fail(`${path} has no page description`)
  }

  const links = tagAttributes(content, 'link')
  const canonicalLinks = links.filter((link) => link.rel === 'canonical')
  if (canonicalLinks.length !== 1) {
    fail(`${path} should have exactly one canonical URL, found ${canonicalLinks.length}`)
  } else if (canonicalLinks[0].href !== canonical) {
    fail(`${path} has an incorrect or missing canonical URL`)
  }

  const expected = new Map([
    ['en', english],
    ['zh', chinese],
    ['x-default', english],
  ])
  const actual = checkAlternates(
    path,
    links.filter((link) => link.rel === 'alternate'),
    expected,
  )
  htmlAlternatesByUrl.set(canonical, actual)
}

const rootHtmlPath = join(outputRoot, 'index.html')
if (!existsSync(rootHtmlPath)) {
  fail('Docs root HTML was not generated')
} else {
  const rootLinks = tagAttributes(readFileSync(rootHtmlPath, 'utf8'), 'link')
  const canonicalLinks = rootLinks.filter((link) => link.rel === 'canonical')
  const alternateLinks = rootLinks.filter((link) => link.rel === 'alternate')
  const expectedRootCanonical = new URL('en/', docsUrl).href

  if (canonicalLinks.length !== 1) {
    fail(`Docs root should have exactly one canonical URL, found ${canonicalLinks.length}`)
  } else if (canonicalLinks[0].href !== expectedRootCanonical) {
    fail(`Docs root should canonicalize to ${expectedRootCanonical}`)
  }
  if (alternateLinks.length !== 0) {
    fail(`Docs root should not declare language alternates, found ${alternateLinks.length}`)
  }
}

for (const target of tocTargets) {
  const marker = `url: ${target}`
  if (!full.includes(marker)) fail(`llms-full.txt is missing ${target}`)
}

if (!sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) {
  fail('sitemap.xml has an unexpected or missing XML declaration')
}
if (!sitemap.includes('<urlset ') || !sitemap.trimEnd().endsWith('</urlset>')) {
  fail('sitemap.xml does not contain a complete urlset')
}
for (const forbidden of ['zooclaw.ai', 'localhost', '127.0.0.1']) {
  if (sitemap.includes(forbidden)) fail(`sitemap.xml contains forbidden host ${forbidden}`)
}

const sitemapEntries = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((match) => match[1])
if (sitemapEntries.length !== 32) {
  fail(`sitemap.xml should contain exactly 32 URL entries, found ${sitemapEntries.length}`)
}

const sitemapUrls = []
for (const [index, entry] of sitemapEntries.entries()) {
  const locs = [...entry.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])
  if (locs.length !== 1) {
    fail(`sitemap.xml entry ${index + 1} should have exactly one loc, found ${locs.length}`)
    continue
  }

  const url = locs[0]
  sitemapUrls.push(url)
  if (!expectedHtmlPageSet.has(url)) fail(`sitemap.xml contains unexpected URL ${url}`)

  const expected = expectedAlternates(url)
  if (!expected) {
    fail(`sitemap.xml contains a non-locale URL ${url}`)
    continue
  }

  const actual = checkAlternates(
    `sitemap.xml entry ${url}`,
    tagAttributes(entry, 'xhtml:link').filter((link) => link.rel === 'alternate'),
    expected,
  )
  const htmlLinks = htmlAlternatesByUrl.get(url)
  if (!htmlLinks) {
    fail(`sitemap.xml entry ${url} has no matching HTML page`)
  } else if (!sameLinks(actual, htmlLinks)) {
    fail(`sitemap.xml entry ${url} does not match its HTML alternate links`)
  }
}

const uniqueSitemapUrls = new Set(sitemapUrls)
if (uniqueSitemapUrls.size !== sitemapUrls.length) {
  fail('sitemap.xml contains duplicate loc URLs')
}
for (const url of expectedHtmlPages) {
  if (!uniqueSitemapUrls.has(url)) fail(`sitemap.xml is missing ${url}`)
}
if (uniqueSitemapUrls.has(docsUrl)) {
  fail(`sitemap.xml should not contain the Docs root alias ${docsUrl}`)
}

if (failures.length > 0) {
  console.error(`AI docs check failed with ${failures.length} problem(s):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(
  `AI docs check passed: ${tocEntries.length} llms.txt entries, ` +
    `${markdownFiles.length} Markdown pages, ${localeHtmlFiles.length} locale HTML pages, ` +
    `${expectedHtmlPages.length} sitemap pages.`,
)
