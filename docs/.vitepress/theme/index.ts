import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import { syncCodeGroups } from './code-group-sync'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ router }) {
    if (typeof window === 'undefined') return
    syncCodeGroups()
    // VitePress swaps page content without a full reload, so re-apply the stored
    // choice after every navigation.
    router.onAfterRouteChange = () => syncCodeGroups()
  },
} satisfies Theme
