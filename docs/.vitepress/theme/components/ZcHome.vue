<script setup lang="ts">
import { computed, type Component } from 'vue'
import { useData, withBase } from 'vitepress'
import {
  ChatBubbleLeftRightIcon,
  ChatBubbleOvalLeftEllipsisIcon,
  CodeBracketIcon,
  CpuChipIcon,
  CubeIcon,
  ExclamationCircleIcon,
  KeyIcon,
  MapIcon,
  NoSymbolIcon,
  PlayIcon,
  SignalIcon,
  Square3Stack3DIcon,
  TableCellsIcon,
  UsersIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/vue/24/outline'

/* The home page's structure comes from the page's own frontmatter, not from this file, so the
   English and Chinese versions stay ordinary translated markdown with the `source_hash`
   convention intact. This component only decides how that data is drawn.

   The one exception is the code sample: it is the page's markdown body, passed through the
   default slot, so it gets the same shiki highlighting as every other block on the site
   instead of hand-written spans that would drift from the SDK. */

interface Action {
  text: string
  link: string
  /* Primary describes action hierarchy. Brand colour is deliberately not a button variant. */
  theme?: 'primary'
}

interface Noun {
  name: string
  id: string
  body: string
  linkText: string
  link: string
}

interface Chip {
  text: string
  link: string
  icon?: string
  badge?: string
}

interface Stage {
  name: string
  hint: string
  chips: Chip[]
}

interface BandColumn {
  title: string
  body: string
  linkText: string
  link: string
}

interface HomeData {
  hero: {
    accent: string
    actions: Action[]
    note: string
    noteLink?: string
    sampleMeta: string
    sampleLinkText: string
    sampleLink: string
    streamLabel: string
  }
  nouns: { title: string; intro: string; items: Noun[] }
  journey: { title: string; intro: string; stages: Stage[] }
  band: { title: string; body: string; columns: BandColumn[] }
}

const { frontmatter } = useData()
const home = computed(() => frontmatter.value.home as HomeData)

/* The headline and tagline stay under the standard top-level `hero` key because
   vitepress-plugin-llms reads exactly `hero.text` and `hero.tagline` to title and describe
   llms.txt. Renaming them moves the page's own words out of the file an assistant reads
   first, and nothing warns you. `home.hero.accent` names the tail of `hero.text` that takes
   the accent colour, so the headline itself is written once. */
const heroTagline = computed(() => (frontmatter.value.hero?.tagline as string) ?? '')
const heroAccent = computed(() => home.value?.hero?.accent ?? '')
const heroLead = computed(() => {
  const text = (frontmatter.value.hero?.text as string) ?? ''
  /* `slice(0, length - accent.length)`, not `slice(0, -accent.length)`: an empty accent
     would make the negative form return an empty string. */
  return text.slice(0, text.length - heroAccent.value.length)
})

/* The event rows are deliberately abbreviated and are labelled as an example in frontmatter.
   Gaps in the sequence numbers make that omission visible instead of pretending this is a
   byte-for-byte transcript. The user prompt in the sample does not promise a tool call, so the
   panel does not invent one. */
const STREAM_ROWS: { seq: string; type: string; detail?: string }[] = [
  { seq: 'seq 2', type: 'run.started' },
  { seq: 'seq 5', type: 'agent.assistant', detail: '"I can research topics, run code…"' },
  { seq: 'seq 7', type: 'run.finished', detail: 'succeeded' },
]

/* Frontmatter keeps stable semantic names; this map owns their Heroicons representation. */
const ICONS: Record<string, Component> = {
  play: PlayIcon,
  key: KeyIcon,
  compass: MapIcon,
  agent: CpuChipIcon,
  thread: ChatBubbleLeftRightIcon,
  pulse: SignalIcon,
  skill: CubeIcon,
  wrench: WrenchScrewdriverIcon,
  layers: Square3Stack3DIcon,
  users: UsersIcon,
  chat: ChatBubbleOvalLeftEllipsisIcon,
  table: TableCellsIcon,
  blocked: NoSymbolIcon,
  brackets: CodeBracketIcon,
  alert: ExclamationCircleIcon,
}
</script>

<template>
  <!-- The page's own landmark: `layout: page` renders no <main>, so without this the h1 sits
       outside any main region and the hero's <header> registers as a second banner. -->
  <main class="zc-home" v-if="home">
    <!-- Hero: the claim on the left, the loop it names running on the right. -->
    <header class="hero">
      <div class="inner hero-grid">
      <div>
        <span class="dot" aria-hidden="true" />
        <h1>{{ heroLead }}<span class="accent">{{ heroAccent }}</span></h1>
        <p class="tagline">{{ heroTagline }}</p>
        <div class="actions">
          <a
            v-for="action in home.hero.actions"
            :key="action.link"
            class="btn"
            :class="action.theme === 'primary' ? 'btn-primary' : 'btn-alt'"
            :href="withBase(action.link)"
          >{{ action.text }}</a>
        </div>
        <p class="note">
          <a v-if="home.hero.noteLink" :href="withBase(home.hero.noteLink)">{{ home.hero.note }}</a>
          <template v-else>{{ home.hero.note }}</template>
        </p>
      </div>

      <div class="panel">
        <div class="panel-bar">
          <span class="panel-file">quickstart.ts</span>
          <code class="install-command"><span aria-hidden="true">$</span> npm i @zoowork-ai/sdk</code>
        </div>
        <div class="panel-code"><slot /></div>
        <div class="panel-meta">
          <span>{{ home.hero.sampleMeta }}</span>
          <a :href="withBase(home.hero.sampleLink)">{{ home.hero.sampleLinkText }} <span aria-hidden="true">→</span></a>
        </div>
        <div class="stream">
          <p class="stream-label"><span class="pip" aria-hidden="true" />{{ home.hero.streamLabel }}</p>
          <p v-for="(row, i) in STREAM_ROWS" :key="row.seq" class="row" :style="{ '--i': i }">
            <span class="seq">{{ row.seq }}</span>
            <span class="type">{{ row.type }}</span>
            <!-- Always rendered, even when empty: the rows share one grid, so a row that
                 contributed two cells instead of three would shift every row after it. -->
            <span class="detail">{{ row.detail }}</span>
          </p>
        </div>
      </div>
      </div>
    </header>

    <!-- The four objects every reference page is written against. -->
    <section class="nouns-section">
      <div class="inner">
      <div class="sec-head">
        <h2>{{ home.nouns.title }}</h2>
        <p>{{ home.nouns.intro }}</p>
      </div>
      <div class="nouns">
        <div v-for="noun in home.nouns.items" :key="noun.name" class="noun">
          <h3>{{ noun.name }} <span class="noun-id">{{ noun.id }}</span></h3>
          <p>{{ noun.body }}</p>
          <a :href="withBase(noun.link)">{{ noun.linkText }} <span aria-hidden="true">→</span></a>
        </div>
      </div>
      </div>
    </section>

    <!-- Numbered because the order is the lifecycle, not decoration. -->
    <section class="journey-section">
      <div class="inner">
      <div class="sec-head">
        <h2>{{ home.journey.title }}</h2>
        <p>{{ home.journey.intro }}</p>
      </div>
      <ol class="stages">
        <li v-for="(stage, i) in home.journey.stages" :key="stage.name" class="stage">
          <div class="stage-name">
            <span class="stage-num" aria-hidden="true">{{ i + 1 }}</span>
            <span>
              <span class="stage-title">{{ stage.name }}</span>
              <small>{{ stage.hint }}</small>
            </span>
          </div>
          <div class="chips">
            <a v-for="chip in stage.chips" :key="chip.link" class="chip" :href="withBase(chip.link)">
              <component
                v-if="chip.icon && ICONS[chip.icon]"
                :is="ICONS[chip.icon]"
                class="chip-icon"
                aria-hidden="true"
              />
              {{ chip.text }}
              <span v-if="chip.badge" class="badge">{{ chip.badge }}</span>
            </a>
          </div>
        </li>
      </ol>
      </div>
    </section>

    <!-- The site's actual promise, given the weight it earns. -->
    <section class="band">
      <div class="inner band-grid">
        <div class="band-lead">
          <h2>{{ home.band.title }}</h2>
          <p>{{ home.band.body }}</p>
          <!-- Markdown from the page body: the policy above, made concrete. It lives in the
               body rather than in frontmatter so it also reaches llms-full.txt, which is the
               one place an assistant reads this site's limits before designing against it. -->
          <div class="band-prose"><slot name="edges" /></div>
        </div>
        <div v-for="col in home.band.columns" :key="col.link" class="band-col">
          <h3>{{ col.title }}</h3>
          <p>{{ col.body }}</p>
          <a :href="withBase(col.link)">{{ col.linkText }} <span aria-hidden="true">→</span></a>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
/* Brand purple is reserved for the ZooWork identity in the hero. Controls, links, selection,
   borders and focus all use the neutral interaction tokens defined in custom.css. */

/* One measure, shared by every block. The band gets a full-width ground simply by not having
   one — no `50vw` arithmetic, which is off by half a scrollbar wherever scrollbars take space. */
.inner {
  max-width: 1152px;
  margin-inline: auto;
  padding-inline: 24px;
}

h1,
h2,
h3 {
  margin: 0;
  font-weight: 600;
  letter-spacing: -0.02em;
  /* The site-level `:lang(zh)` rule in custom.css turns this off for Chinese, where a line
     can break between any two characters and balancing splits words down the middle. */
  text-wrap: balance;
}

/* --- Hero ------------------------------------------------------------------ */

.hero {
  padding: 40px 0;
}

.hero-grid {
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
  gap: 40px;
  /* Start, not centre: the code panel is much taller than the copy, and centring split the
     difference into a hole above the headline. */
  align-items: start;
}

.dot {
  display: block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--zc-brand);
  margin-bottom: 20px;
}

.hero h1 {
  font-size: clamp(32px, 3.4vw, 36px);
  line-height: 1.15;
  letter-spacing: -0.03em;
}

/* Chinese wraps between any two Han characters, so balancing splits words down the middle. */
.accent {
  color: var(--zc-brand);
}

.tagline {
  margin: 20px 0 0;
  max-width: 46ch;
  color: var(--vp-c-text-2);
  font-size: 16px;
  line-height: 1.6;
  text-wrap: pretty;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 28px;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  height: 40px;
  border-radius: var(--zc-radius-md);
  padding: 0 16px;
  font-size: 14px;
  font-weight: 600;
  border: 1px solid transparent;
  transition: background-color var(--zc-motion-fast) ease, border-color var(--zc-motion-fast) ease,
    color var(--zc-motion-fast) ease, transform var(--zc-motion-fast) ease;
}

.btn:active {
  transform: scale(0.98);
}

.btn-primary {
  background: var(--zc-action);
  color: var(--zc-action-foreground);
}

.btn-primary:hover {
  background: var(--vp-button-brand-hover-bg);
}

.btn-alt {
  border-color: var(--zc-line);
  background: var(--zc-paper);
  color: var(--vp-c-text-1);
}

.btn-alt:hover {
  background: var(--zc-hover);
  border-color: var(--zc-line);
  color: var(--vp-c-text-1);
}

.note a {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: var(--vp-c-divider);
  text-underline-offset: 3px;
  transition: color var(--zc-motion-fast) ease, text-decoration-color var(--zc-motion-fast) ease;
}

.note a:hover {
  color: var(--vp-c-text-1);
  text-decoration-color: currentColor;
}

.note {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 24px 0 0;
  font-size: 13px;
  color: var(--vp-c-text-2);
  text-wrap: pretty;
}

.pip {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--zc-line-strong);
  transform: translateY(-1px);
}

.hero .pip {
  background: var(--zc-brand);
}

/* --- Code panel ------------------------------------------------------------
   The block inside is VitePress's own shiki output, so it carries the site's syntax
   theme and switches with it. The frame strips the block's default chrome and supplies
   its own, which is what makes it read as one object rather than a code block with
   things stacked around it. */

.panel {
  border: 1px solid var(--zc-line);
  border-radius: var(--zc-radius-xl);
  background: var(--zc-paper);
  overflow: hidden;
}

.panel-bar {
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  min-height: 40px;
  border-bottom: 1px solid var(--vp-c-divider);
}

.panel-file,
.install-command {
  display: flex;
  align-items: center;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
}

.panel-file {
  padding: 8px 16px;
  background: var(--zc-selected);
  color: var(--vp-c-text-1);
  box-shadow: inset 0 -2px 0 var(--zc-action);
}

.install-command {
  padding: 8px 16px;
  color: var(--vp-c-text-2);
  border-left: 1px solid var(--vp-c-divider);
  white-space: nowrap;
}

.install-command span {
  margin-right: 6px;
  color: var(--zc-brand);
}

/* This block arrives with no theme chrome at all: `layout: page` renders <Content> outside
   `.vp-doc`, and every code-block rule the default theme ships is scoped under it — including
   `overflow-x: auto`. Unscrolled, `.panel`'s clip removes the tail of every long line. */
.panel-code :deep(div[class*='language-'] pre) {
  overflow-x: auto;
  /* Padding on the code, not the pre, so it survives a horizontal scroll at both ends. */
  padding: 16px 0;
  margin: 0;
}

.panel-code :deep(code) {
  display: block;
  padding: 0 20px;
  font-size: 12.5px;
  line-height: 1.75;
}

/* The file label already names the language, so the block's own label is noise — but the copy
   button stays: this is the sample a reader most wants to run. */
.panel-code :deep(span.lang) {
  display: none;
}

.panel-meta {
  min-height: 38px;
  padding: 8px 20px;
  border-top: 1px solid var(--vp-c-divider);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  color: var(--vp-c-text-2);
  font-size: 11px;
}

.panel-meta > span {
  font-family: var(--vp-font-family-mono);
}

.panel-meta a {
  flex: none;
  color: var(--vp-c-text-1);
  font-weight: 600;
  text-decoration: underline;
  text-decoration-color: var(--zc-line-strong);
  text-underline-offset: 3px;
}

.panel-meta a:hover {
  text-decoration-color: currentColor;
}

.stream {
  border-top: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  padding: 12px 20px 16px;
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  column-gap: 12px;
}

/* `display: contents` puts each row's three spans into the shared grid, so seq, type and
   detail line up down the panel instead of per row. */
.row {
  display: contents;
}

.stream-label {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 8px;
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--vp-c-text-2);
}

.row > span {
  font-family: var(--vp-font-family-mono);
  font-size: 11.5px;
  line-height: 1.95;
  white-space: nowrap;
  /* Plays once on load, then stays. A docs page should settle, not loop. */
  animation: row-in var(--zc-motion-emphasis) var(--zc-ease-out) backwards;
  animation-delay: calc(0.16s + var(--i) * 0.06s);
}

/* The detail column is the sample's colour, not its point; drop it before it wraps. */
@media (max-width: 640px) {
  .stream {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .detail {
    display: none;
  }
}

.seq {
  color: var(--vp-c-text-2);
  font-variant-numeric: tabular-nums;
}

.type {
  color: var(--vp-c-text-1);
}

.detail {
  color: var(--vp-c-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
}

@keyframes row-in {
  from {
    opacity: 0;
    transform: translateY(3px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .row > span {
    animation: none;
  }
}

/* --- Sections -------------------------------------------------------------- */

/* Named, rather than `section > .inner` with the band cancelling itself back out: the band
   supplies its own ground and its own padding, so it was never one of these.
   `padding-block`, never the shorthand — `.inner` owns the horizontal measure, and
   `padding: 56px 0` would out-specify it and zero the gutter. */
.nouns-section > .inner,
.journey-section > .inner {
  padding-block: 40px;
  border-top: 1px solid var(--vp-c-divider);
}

.sec-head {
  max-width: 62ch;
  margin-bottom: 32px;
}

.sec-head h2 {
  font-size: 24px;
}

.sec-head p {
  margin: 10px 0 0;
  color: var(--vp-c-text-2);
}

/* --- Nouns ----------------------------------------------------------------- */

.nouns {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 24px;
}

/* The four nouns and the band's two columns are one card: a quiet rule, a title, a
   paragraph, a link. Only the heading size and the nouns' bottom-alignment differ. */
.noun,
.band-col {
  border-top: 1px solid var(--zc-line-strong);
  padding-top: 16px;
}

.noun p,
.band-col p {
  margin: 8px 0 12px;
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
}

.noun a,
.band-col a {
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.noun {
  /* The bodies are different lengths — markedly so once translated — so let the column
     stretch and push the link to the bottom, keeping the link row flat. */
  display: flex;
  flex-direction: column;
}

.noun a:hover,
.band-col a:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.noun a {
  margin-top: auto;
}

.noun h3 {
  font-size: 16px;
}

.noun-id {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 400;
  color: var(--vp-c-text-3);
  margin-left: 5px;
}

/* --- Journey --------------------------------------------------------------- */

.stages {
  list-style: none;
  padding: 0;
  margin: 0;
}

.stage {
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr);
  gap: 24px;
  padding: 20px 0;
  border-top: 1px solid var(--vp-c-divider);
}

.stage:first-child {
  border-top: none;
  padding-top: 0;
}

.stage-name {
  display: flex;
  gap: 12px;
}

.stage-num {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--vp-c-text-3);
  line-height: 1.6;
}

.stage-title {
  font-weight: 600;
  font-size: 16px;
  color: var(--vp-c-text-1);
}

.stage-name small {
  display: block;
  margin-top: 2px;
  font-size: 12.5px;
  color: var(--vp-c-text-2);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-content: flex-start;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--zc-line);
  border-radius: var(--zc-radius-md);
  background: var(--zc-paper);
  padding: 8px 12px;
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-text-1);
  transition: background-color var(--zc-motion-fast) ease, border-color var(--zc-motion-fast) ease,
    color var(--zc-motion-fast) ease, transform var(--zc-motion-fast) ease;
}

.chip-icon {
  width: 16px;
  height: 16px;
  color: var(--vp-c-text-3);
  transition: color var(--zc-motion-fast) ease;
  flex: none;
}

.chip:hover {
  background: var(--zc-hover);
  border-color: var(--zc-line);
  color: var(--vp-c-text-1);
}

.chip:hover .chip-icon {
  color: var(--vp-c-text-1);
}

.chip:active {
  transform: scale(0.98);
}

.badge {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--zc-action-foreground);
  background: var(--zc-action);
  border-radius: var(--zc-radius-sm);
  padding: 2px 6px;
}

/* --- Band ------------------------------------------------------------------
   Full-bleed, so the site's one promise gets a ground of its own. */

.band {
  background: var(--zc-surface-subtle);
  padding: 40px 0;
}

.band-grid {
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 3fr) minmax(0, 3fr);
  gap: 40px;
}

.band-lead h2 {
  font-size: 20px;
}

.band-lead p {
  margin: 10px 0 0;
  font-size: 14px;
  color: var(--vp-c-text-2);
}

.band-prose :deep(p) {
  margin: 14px 0 0;
  font-size: 14px;
  line-height: 1.65;
  color: var(--vp-c-text-2);
}

.band-prose :deep(strong) {
  color: var(--vp-c-text-1);
  font-weight: 600;
}

.band-prose :deep(a) {
  color: var(--vp-c-text-1);
  font-weight: 500;
}

.band-prose :deep(a:hover) {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.band-prose :deep(code) {
  font-family: var(--vp-font-family-mono);
  font-size: 0.9em;
  background: var(--zc-paper);
  border-radius: var(--zc-radius-sm);
  padding: 2px 5px;
}

.band-col h3 {
  font-size: 14.5px;
}

/* --- Narrow ---------------------------------------------------------------- */

@media (max-width: 1000px) {
  .hero {
    padding: 40px 0;
  }

  .hero-grid {
    grid-template-columns: 1fr;
    gap: 32px;
  }

  .nouns {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 24px;
  }

  .band-grid {
    grid-template-columns: 1fr;
    gap: 24px;
  }

  .stage {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .nouns-section > .inner,
  .journey-section > .inner {
    padding-block: 40px;
  }
}

@media (max-width: 600px) {
  .inner {
    padding-inline: 20px;
  }

  .panel-bar {
    flex-direction: column;
  }

  .panel-file {
    min-height: 38px;
  }

  .install-command {
    min-height: 38px;
    border-top: 1px solid var(--vp-c-divider);
    border-left: 0;
  }

  .panel-meta {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }

  .nouns {
    grid-template-columns: 1fr;
  }
}
</style>
