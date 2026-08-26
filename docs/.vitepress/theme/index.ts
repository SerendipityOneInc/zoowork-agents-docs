import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import { syncCodeGroups } from './code-group-sync'
import ZcHome from './components/ZcHome.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app, router }) {
    // The home page is a component rather than the stock hero-and-features layout; both
    // locales' `index.md` carry its content as frontmatter and mount it from their body.
    app.component('ZcHome', ZcHome)

    if (typeof window === 'undefined') return
    syncCodeGroups()
    // VitePress swaps page content without a full reload, so re-apply the stored
    // choice after every navigation.
    router.onAfterRouteChange = () => syncCodeGroups()
  },
} satisfies Theme
