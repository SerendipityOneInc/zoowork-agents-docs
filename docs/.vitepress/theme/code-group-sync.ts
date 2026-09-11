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
  const inputs = Array.from(group.querySelectorAll('.tabs input[type=radio]'))
  const blocks = group.querySelector('.blocks')
  const index = input ? inputs.indexOf(input) : -1
  if (!input || !blocks?.children[index]) return false

  // Restore both halves of VitePress's tab state. The radio may already be checked
  // while the first code block is still active during initial page hydration.
  // Updating the DOM directly also avoids recursively clicking other labels.
  input.checked = true
  Array.from(blocks.children).forEach((block, i) => {
    block.classList.toggle('active', i === index)
  })
  return true
}

function applyToAll(name: string): void {
  for (const group of document.querySelectorAll('.vp-code-group')) {
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
    document.addEventListener('change', (e) => {
      const input = e.target
      if (!(input instanceof HTMLInputElement) ||
          !input.matches('.vp-code-group .tabs input[type=radio]') || !input.checked) return
      const group = input.closest('.vp-code-group')
      if (!group) return
      const label = tabLabels(group).find((l) => l.htmlFor === input.id)
      const name = label?.textContent?.trim()
      if (!name) return
      localStorage.setItem(STORAGE_KEY, name)
      applyToAll(name)
    })
  }

  // The DOM for the incoming page is not mounted yet when onAfterRouteChange fires.
  requestAnimationFrame(() => requestAnimationFrame(run))
}
