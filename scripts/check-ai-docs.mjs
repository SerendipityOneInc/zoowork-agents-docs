import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, posix, relative, resolve } from 'node:path'

const outputRoot = resolve('dist/docs')
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

const localeHtmlFiles = filesUnder(outputRoot, '.html').filter((file) => {
  const path = relative(outputRoot, file).replace(/\\/g, '/')
  return path.startsWith('en/') || path.startsWith('zh/')
})

for (const file of localeHtmlFiles) {
  const path = relative(outputRoot, file).replace(/\\/g, '/')
  const route = path.replace(/index\.html$/, '').replace(/\.html$/, '')
  const locale = route.split('/', 1)[0]
  const suffix = route.slice(locale.length)
  const english = `https://zooclaw.ai/docs/en${suffix}`
  const chinese = `https://zooclaw.ai/docs/zh${suffix}`
  const canonical = locale === 'en' ? english : chinese
  const content = readFileSync(file, 'utf8')

  if (!content.includes(`<meta name="description" content="`)) {
    fail(`${path} has no page description`)
  }
  if (!content.includes(`<link rel="canonical" href="${canonical}">`)) {
    fail(`${path} has an incorrect or missing canonical URL`)
  }
  for (const [language, href] of [
    ['en-US', english],
    ['zh-CN', chinese],
    ['x-default', english],
  ]) {
    if (!content.includes(`<link rel="alternate" hreflang="${language}" href="${href}">`)) {
      fail(`${path} has an incorrect or missing ${language} alternate URL`)
    }
  }
}

for (const target of tocTargets) {
  const marker = `url: ${target}`
  if (!full.includes(marker)) fail(`llms-full.txt is missing ${target}`)
}

const expectedHtmlPages = filesUnder(resolve('docs'), '.md')
  .filter((file) => !file.includes(`${posix.sep}.vitepress${posix.sep}`))
  .map((file) => relative(resolve('docs'), file).replace(/\\/g, '/'))
  .filter((file) => file.startsWith('en/') || file.startsWith('zh/'))
  .map((file) => {
    const route = file.replace(/index\.md$/, '').replace(/\.md$/, '')
    return `https://zooclaw.ai/docs/${route}`
  })

for (const url of expectedHtmlPages) {
  if (!sitemap.includes(`<loc>${url}</loc>`)) fail(`sitemap.xml is missing ${url}`)
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
