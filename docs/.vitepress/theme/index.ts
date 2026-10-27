import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import '@fontsource-variable/jetbrains-mono'
import { syncCodeGroups } from './code-group-sync'
import ZcHome from './components/ZcHome.vue'
import AgentPrompt from './components/AgentPrompt.vue'
import LinkCards from './components/LinkCards.vue'
import DocsLayout from './components/DocsLayout.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout: DocsLayout,
  enhanceApp({ app, router }) {
    // The home page is a component rather than the stock hero-and-features layout; both
    // locales' `index.md` carry its content as frontmatter and mount it from their body.
    app.component('ZcHome', ZcHome)
    // Wraps the coding-assistant prompt block in the Quickstart; see AgentPrompt.vue.
    app.component('AgentPrompt', AgentPrompt)
    // Lays out a Markdown list of links as cards; see LinkCards.vue.
    app.component('LinkCards', LinkCards)

    if (typeof window === 'undefined') return
    syncCodeGroups()
    // VitePress swaps page content without a full reload, so re-apply the stored
    // choice after every navigation.
    router.onAfterRouteChange = () => syncCodeGroups()
  },
} satisfies Theme
