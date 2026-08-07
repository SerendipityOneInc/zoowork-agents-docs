/**
 * Keep every code group on the page on the same tab.
 *
 * VitePress renders each `::: code-group` as an independent radio set, so picking
 * TypeScript in one block leaves the next block on curl. Readers following a
 * multi-step guide end up re-picking their language at every step. This syncs the
 * choice across all groups on the page and remembers it across navigations and
 * visits.
 *
 * Rendered structure we rely on:
 *   .vp-code-group > .tabs > input[type=radio] + label[for=...]
 * The label text is the tab name, so labels are matched by their text content.
 */

const STORAGE_KEY = 'zooclaw-docs:code-tab'

function tabLabels(group: Element): HTMLLabelElement[] {
  return Array.from(group.querySelectorAll<HTMLLabelElement>('.tabs label'))
}

function select(group: Element, name: string): boolean {
  const label = tabLabels(group).find((l) => l.textContent?.trim() === name)
  if (!label) return false
  const input = group.querySelector<HTMLInputElement>(`#${CSS.escape(label.htmlFor)}`)
  // Only act when it is not already the active tab: clicking a checked radio is a
  // no-op, but writing `checked` directly skips VitePress's own class bookkeeping.
  if (!input || input.checked) return false
  label.click()
  return true
}

function applyToAll(name: string, except?: Element): void {
  for (const group of document.querySelectorAll('.vp-code-group')) {
    if (group === except) continue
    select(group, name)
  }
}

let installed = false

export function syncCodeGroups(): void {
  const run = (): void => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) applyToAll(stored)

    if (installed) return
    installed = true

    // One delegated listener survives every page swap, so it is installed once.
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null
      const label = target?.closest<HTMLLabelElement>('.vp-code-group .tabs label')
      if (!label) return
      const name = label.textContent?.trim()
      if (!name) return
      localStorage.setItem(STORAGE_KEY, name)
      applyToAll(name, label.closest('.vp-code-group') ?? undefined)
    })
  }

  // The DOM for the incoming page is not mounted yet when onAfterRouteChange fires.
  requestAnimationFrame(() => requestAnimationFrame(run))
}
