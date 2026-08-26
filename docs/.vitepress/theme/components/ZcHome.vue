<script setup lang="ts">
import { computed, ref } from 'vue'
import { useData, withBase } from 'vitepress'

/* The home page's structure comes from the page's own frontmatter, not from this file, so the
   English and Chinese versions stay ordinary translated markdown with the `source_hash`
   convention intact. This component only decides how that data is drawn.

   The one exception is the code sample: it is the page's markdown body, passed through the
   default slot, so it gets the same shiki highlighting as every other block on the site
   instead of hand-written spans that would drift from the SDK. */

interface Action {
  text: string
  link: string
  theme?: 'brand' | 'alt'
}

interface StreamRow {
  seq: string
  type: string
  detail?: string
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
  }
  panel: { tabs: string[]; streamLabel: string; rows: StreamRow[] }
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
const heroText = computed(() => (frontmatter.value.hero?.text as string) ?? '')
const heroTagline = computed(() => (frontmatter.value.hero?.tagline as string) ?? '')
const heroAccent = computed(() => home.value?.hero?.accent ?? '')
const heroLead = computed(() =>
  heroAccent.value && heroText.value.endsWith(heroAccent.value)
    ? heroText.value.slice(0, -heroAccent.value.length)
    : heroText.value,
)

/* Drawn icons rather than emoji or unicode glyphs, one stroke weight throughout. Keyed by
   name so the frontmatter carries a word and never raw markup. */
/* The panel's tabs were drawn as a control and wired to nothing. They switch now, because
   the second one carries the install line — without it the page imports a package it never
   tells you how to add. */
const activeTab = ref(0)

const ICONS: Record<string, string> = {
  play: 'M7 4.5 18 12 7 19.5v-15Z',
  key: 'M15 7a4 4 0 1 0-3.9 4.9L7 16v3h3v-2h2v-2h1.1A4 4 0 0 0 15 7Z',
  compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm3.5-12.5-2 5-5 2 2-5 5-2Z',
  agent: 'M5 4h14v16H5V4Zm3 5h8M8 13h5',
  thread: 'M4 6h16M4 12h16M4 18h9',
  pulse: 'M3 12h4l3-8 4 16 3-8h4',
  skill: 'M12 3.5 20 8v8l-8 4.5L4 16V8l8-4.5Zm0 0v17',
  wrench: 'm14.5 6.5 3 3-8 8H6.5v-3l8-8Zm2-2 3 3',
  layers: 'M12 3 3 8l9 5 9-5-9-5Zm-9 9.5L12 17l9-4.5',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9c0-3.3 2.7-6 6-6s6 2.7 6 6M17 8.5a2.5 2.5 0 1 1 0 5m-.5 2.5c2.5 0 4.5 2 4.5 4.5',
  chat: 'M8 9h8m-8 4h5m-9 8V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-4 4Z',
  table: 'M4 5h16M4 10h16M4 15h16M4 20h11',
  blocked: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8.5 8.5l7 7m0-7-7 7',
  brackets: 'm8.5 5-5 7 5 7m7-14 5 7-5 7',
  alert: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5m0 3.2v.3',
}
</script>

<template>
  <!-- The page's own landmark: `layout: page` renders no <main>, so without this the h1 sits
       outside any main region and the hero's <header> registers as a second banner. -->
  <main class="zc-home" v-if="home">
    <!-- Hero: the claim on the left, the loop it names running on the right. -->
    <header class="hero">
      <div class="inner hero-grid">
      <div class="hero-copy">
        <span class="dot" aria-hidden="true" />
        <h1>{{ heroLead }}<span class="accent">{{ heroAccent }}</span></h1>
        <p class="tagline">{{ heroTagline }}</p>
        <div class="actions">
          <a
            v-for="action in home.hero.actions"
            :key="action.link"
            class="btn"
            :class="action.theme === 'brand' ? 'btn-brand' : 'btn-alt'"
            :href="withBase(action.link)"
          >{{ action.text }}</a>
        </div>
        <p class="note">
          <span class="pip" aria-hidden="true" />
          <a v-if="home.hero.noteLink" :href="withBase(home.hero.noteLink)">{{ home.hero.note }}</a>
          <template v-else>{{ home.hero.note }}</template>
        </p>
      </div>

      <div class="panel">
        <div class="panel-tabs" role="tablist">
          <button
            v-for="(tab, i) in home.panel.tabs"
            :key="tab"
            type="button"
            role="tab"
            class="panel-tab"
            :class="{ on: activeTab === i }"
            :aria-selected="activeTab === i"
            @click="activeTab = i"
          >{{ tab }}</button>
        </div>
        <!-- Both samples are fenced blocks in the page body, so both carry the site's own
             shiki highlighting and both reach llms-full.txt. -->
        <div class="panel-code" v-show="activeTab === 0"><slot /></div>
        <div class="panel-code" v-show="activeTab === 1"><slot name="install" /></div>
        <div class="stream">
          <p class="stream-label"><span class="pip" aria-hidden="true" />{{ home.panel.streamLabel }}</p>
          <p v-for="(row, i) in home.panel.rows" :key="row.seq" class="row" :style="{ '--i': i }">
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
              <svg
                v-if="chip.icon && ICONS[chip.icon]"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              ><path :d="ICONS[chip.icon]" /></svg>
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
/* Every colour here resolves through the site's tokens, so the home page and the reference
   pages stay one design. `--vp-c-brand-1` is already the theme-aware accent *text* step
   (#b8410f on white, #ff8a5c on the dark ground); `--zc-accent` is the full-strength fill,
   which is legible as a field but never as text. */

.zc-home {
  display: block;
}

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
  letter-spacing: -0.02em;
  text-wrap: balance;
  margin: 0;
}

/* --- Hero ------------------------------------------------------------------ */

.hero {
  padding: 56px 0;
}

.hero-grid {
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
  gap: 56px;
  /* Start, not centre: the code panel is much taller than the copy, and centring split the
     difference into a hole above the headline. */
  align-items: start;
}

.dot {
  display: block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--zc-accent);
  margin-bottom: 22px;
}

.hero h1 {
  font-size: clamp(32px, 4.2vw, 46px);
  line-height: 1.08;
  letter-spacing: -0.03em;
  font-weight: 700;
}

/* Chinese wraps between any two Han characters, so balancing splits words down the middle. */
:lang(zh) .hero h1 {
  text-wrap: initial;
}

.accent {
  color: var(--vp-c-brand-1);
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
  gap: 10px;
  margin-top: 28px;
}

.btn {
  display: inline-flex;
  align-items: center;
  border-radius: var(--zc-radius);
  padding: 9px 18px;
  font-size: 14px;
  font-weight: 600;
  border: 1px solid transparent;
  transition: background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease;
}

.btn-brand {
  background: var(--zc-accent);
  color: var(--zc-ink);
}

.btn-brand:hover {
  background: var(--vp-button-brand-hover-bg);
}

.btn-alt {
  border-color: var(--vp-c-border);
  color: var(--vp-c-text-1);
}

.btn-alt:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.note a {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: var(--vp-c-divider);
  text-underline-offset: 3px;
  transition: color 0.2s ease, text-decoration-color 0.2s ease;
}

.note a:hover {
  color: var(--vp-c-brand-1);
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
  background: var(--zc-accent);
  transform: translateY(-1px);
}

/* --- Code panel ------------------------------------------------------------
   The block inside is VitePress's own shiki output, so it carries the site's syntax
   theme and switches with it. The frame strips the block's default chrome and supplies
   its own, which is what makes it read as one object rather than a code block with
   things stacked around it. */

.panel {
  border: 1px solid var(--vp-c-divider);
  border-radius: var(--zc-radius-lg);
  background: var(--vp-c-bg-alt);
  box-shadow: var(--zc-shadow);
  overflow: hidden;
}

.panel-tabs {
  display: flex;
  border-bottom: 1px solid var(--vp-c-divider);
}

.panel-tab {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--vp-c-text-2);
  padding: 10px 20px 9px;
  background: none;
  border: 0;
  cursor: pointer;
  transition: color 0.2s ease;
}

.panel-tab:hover {
  color: var(--vp-c-text-1);
}

.panel-tab.on {
  color: var(--vp-c-text-1);
  box-shadow: inset 0 -2px 0 var(--zc-accent);
}

/* This block arrives with no theme chrome at all: `layout: page` renders <Content> outside
   `.vp-doc`, and every code-block rule the default theme ships is scoped under it — including
   `overflow-x: auto`. Unscrolled, `.panel`'s clip removes the tail of every long line. */
.panel-code :deep(div[class*='language-'] pre) {
  overflow-x: auto;
  /* Padding on the code, not the pre, so it survives a horizontal scroll at both ends. */
  padding: 18px 0;
  margin: 0;
}

.panel-code :deep(code) {
  display: block;
  padding: 0 20px;
  font-size: 12.5px;
  line-height: 1.75;
}

/* The tab already names the language, so the block's own label is noise — but the copy
   button stays: this is the sample a reader most wants to run. */
.panel-code :deep(span.lang) {
  display: none;
}

.stream {
  border-top: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  padding: 14px 20px 16px;
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  column-gap: 14px;
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
  margin: 0;
  font-family: var(--vp-font-family-mono);
  font-size: 11.5px;
  line-height: 1.95;
  white-space: nowrap;
  /* Plays once on load, then stays. A docs page should settle, not loop. */
  animation: row-in 0.45s cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: calc(0.42s + var(--i) * 0.34s);
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

/* `padding-block`, never the shorthand: `.inner` owns the horizontal measure, and
   `padding: 56px 0` here out-specifies it and zeroes the gutter — which put the section
   text hard against the screen edge below 1000px. */
section > .inner {
  padding-block: 56px;
  border-top: 1px solid var(--vp-c-divider);
}

/* The band's ground already marks the boundary; it must not also draw the section rule,
   and it must not add the section's block padding on top of its own. */
.band > .inner {
  border-top: none;
  padding-block: 0;
}

.sec-head {
  max-width: 62ch;
  margin-bottom: 36px;
}

.sec-head h2 {
  font-size: 23px;
  font-weight: 700;
}

.sec-head p {
  margin: 10px 0 0;
  color: var(--vp-c-text-2);
}

/* --- Nouns ----------------------------------------------------------------- */

.nouns {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 32px;
}

/* The 2px rule is the one place the full-strength accent appears as a field. */
.noun {
  border-top: 2px solid var(--zc-accent);
  padding-top: 16px;
  /* The bodies are different lengths — markedly so once translated — so let the column
     stretch and push the link to the bottom, keeping the link row flat. */
  display: flex;
  flex-direction: column;
}

.noun a {
  margin-top: auto;
}

.noun h3 {
  font-size: 16px;
  font-weight: 700;
}

.noun-id {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 400;
  color: var(--vp-c-brand-1);
  margin-left: 5px;
}

.noun p {
  margin: 8px 0 12px;
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
}

.noun a {
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
}

.noun a:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
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
  gap: 28px;
  padding: 22px 0;
  border-top: 1px solid var(--vp-c-divider);
}

.stage:first-child {
  border-top: none;
  padding-top: 0;
}

.stage-name {
  display: flex;
  gap: 14px;
}

.stage-num {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--vp-c-brand-1);
  line-height: 1.6;
}

.stage-title {
  font-weight: 700;
  font-size: 15.5px;
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
  border: 1px solid var(--vp-c-divider);
  border-radius: var(--zc-radius);
  background: var(--vp-c-bg);
  padding: 7px 14px;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--vp-c-text-1);
  transition: border-color 0.2s ease, color 0.2s ease;
}

.chip svg {
  color: var(--vp-c-text-3);
  transition: color 0.2s ease;
  flex: none;
}

.chip:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.chip:hover svg {
  color: var(--vp-c-brand-1);
}

.badge {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  border-radius: var(--zc-radius-sm);
  padding: 1px 6px;
}

/* --- Band ------------------------------------------------------------------
   Full-bleed, so the site's one promise gets a ground of its own. */

.band {
  background: var(--vp-c-bg-alt);
  padding: 52px 0;
}

.band-grid {
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 3fr) minmax(0, 3fr);
  gap: 40px;
}

.band-lead h2 {
  font-size: 21px;
  font-weight: 700;
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
  color: var(--vp-c-brand-1);
  font-weight: 500;
}

.band-prose :deep(a:hover) {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.band-prose :deep(code) {
  font-family: var(--vp-font-family-mono);
  font-size: 0.9em;
  background: var(--vp-c-bg);
  border-radius: var(--zc-radius-sm);
  padding: 2px 5px;
}

.band-col {
  border-top: 2px solid var(--zc-accent);
  padding-top: 14px;
}

.band-col h3 {
  font-size: 14.5px;
  font-weight: 700;
}

.band-col p {
  margin: 6px 0 10px;
  font-size: 13.5px;
  color: var(--vp-c-text-2);
}

.band-col a {
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
}

.band-col a:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

/* --- Narrow ---------------------------------------------------------------- */

@media (max-width: 1000px) {
  .hero {
    padding: 44px 0 40px;
  }

  .hero-grid {
    grid-template-columns: 1fr;
    gap: 36px;
  }

  .nouns {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 26px;
  }

  .band-grid {
    grid-template-columns: 1fr;
    gap: 26px;
  }

  .stage {
    grid-template-columns: 1fr;
    gap: 14px;
  }

  section > .inner {
    padding-block: 44px;
  }
}

@media (max-width: 600px) {
  .inner {
    padding-inline: 20px;
  }

  .nouns {
    grid-template-columns: 1fr;
  }
}
</style>
