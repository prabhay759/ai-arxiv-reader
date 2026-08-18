/**
 * Split a paper into finishable reading units.
 *
 * A paper is one 40-page scroll; nothing in it is ever *finished*. This turns
 * the document's own structure into a path of units small enough to complete
 * in a sitting, which is the whole premise of the guided read.
 *
 * Two decisions here came out of measuring real papers rather than guessing,
 * and both matter (see docs/guided-reading.md):
 *
 *  - **Split at leaf level, not at top-level sections.** Top-level sections
 *    ran to a 102-minute maximum. Leaf sections and subsections come in at a
 *    median under a minute and a p90 of ~5.
 *  - **Collapse appendices into one optional unit.** They held the worst
 *    outlier at 34 minutes and are rarely read start-to-finish, but they are
 *    also a third of the sections in a modern ML paper — left in the path they
 *    make a finished paper read "6 of 41".
 */

/** Technical prose, read carefully. Deliberately slower than the 200 wpm used when measuring. */
const WORDS_PER_MINUTE = 180

/**
 * A container section whose own prose is at least this long earns its own unit
 * for that intro; below it, the section is a pure wrapper and only its
 * subsections become units.
 */
const MIN_INTRO_WORDS = 80

/**
 * Descend no deeper than subsections.
 *
 * Going all the way to leaves looked right until it met real papers: it turned
 * a 45-minute paper into 31 units with a one-minute median, because modern ML
 * papers subdivide down to `\paragraph`. A one-minute unit is a paragraph, not
 * something you finish — the path became a wall of checkboxes. Cutting at
 * depth 2 puts the median back in the range that made units worth having.
 */
const MAX_UNIT_DEPTH = 2

/**
 * Below this, a unit is merged into the one before it.
 *
 * Depth-capping alone did not fix fragmentation: papers that subdivide with
 * `\paragraph` emit those at top level, so they survive any depth rule. Size
 * is the criterion that actually matters — a one-minute unit is a paragraph,
 * not something you finish — so consecutive undersized units at the same level
 * are coalesced until they add up to something worth ticking off.
 */
const MIN_UNIT_WORDS = 350

export interface ReadingUnit {
  /**
   * Stable identity, used as the storage key.
   *
   * Derived from the heading rather than the element id or the ordinal,
   * because both of those shift when arXiv re-renders a paper or an author
   * adds a section in a new version — and this codebase already learned that
   * lesson once, which is why highlights anchor on quoted text.
   */
  key: string
  /** Element to scroll to. Unstable across re-renders; `key` is not. */
  elementId: string
  /** Element whose bottom edge marks this unit finished. */
  endElementId: string
  label: string
  level: number
  words: number
  minutes: number
  appendix: boolean
  ordinal: number
  /** How many further headings were folded into this unit, for the path label. */
  mergedCount?: number
}

export function buildUnits(root: ParentNode): ReadingUnit[] {
  const sections = [...root.querySelectorAll<HTMLElement>('section[id]')]
  const body = sections.filter((section) => !isAppendix(section))

  const units: Array<Omit<ReadingUnit, 'key' | 'ordinal'>> = []
  const depths = new Map(sections.map((section) => [section, depthOf(section)]))

  for (const section of body) {
    const depth = depths.get(section) ?? 1
    if (depth > MAX_UNIT_DEPTH) continue

    // Sections one level down that are themselves units. Anything deeper is
    // read as part of this unit rather than split out of it.
    //
    // Nested appendices count here too. Papers that wrap their appendices in
    // an ordinary "Appendix" section would otherwise make that wrapper look
    // like a leaf, and it would swallow every appendix — listing them once as
    // a 51-minute body unit and again as the collapsed appendix block, with
    // the path claiming an hour more reading than the paper contains.
    const hasSubUnits =
      depth < MAX_UNIT_DEPTH &&
      (body.some(
        (other) => other !== section && section.contains(other) && depths.get(other) === depth + 1
      ) ||
        sections.some((other) => isAppendix(other) && section.contains(other)))

    if (!hasSubUnits) {
      const words = wordsIn(section, false)
      units.push({
        elementId: section.id,
        endElementId: lastChildSectionId(section),
        label: labelOf(section) || section.id,
        level: depth,
        words,
        minutes: minutesFor(words),
        appendix: false,
      })
      continue
    }

    // A wrapper with nothing of its own contributes no unit — its subsections
    // are the units. Emitting one anyway is how a path ends up with entries
    // you cannot read.
    const intro = wordsIn(section, true)
    if (intro < MIN_INTRO_WORDS) continue

    units.push({
      elementId: section.id,
      endElementId: firstChildSectionId(section) ?? section.id,
      label: labelOf(section) || section.id,
      level: depth,
      words: intro,
      minutes: minutesFor(intro),
      appendix: false,
    })
  }

  const appendices = sections.filter(
    (section) => isAppendix(section) && !isAppendix(section.parentElement)
  )
  if (appendices.length > 0) {
    const words = appendices.reduce((sum, node) => sum + countWords(node.textContent), 0)

    units.push({
      elementId: appendices[0].id,
      endElementId: appendices[appendices.length - 1].id,
      label: appendices.length === 1 ? labelOf(appendices[0]) || 'Appendix' : 'Appendices',
      level: 1,
      words,
      minutes: minutesFor(words),
      appendix: true,
    })
  }

  return assignKeys(coalesce(units))
}

/** Total estimated minutes, optionally excluding the appendix unit. */
export function totalMinutes(units: ReadingUnit[], includeAppendix = false): number {
  return units
    .filter((unit) => includeAppendix || !unit.appendix)
    .reduce((sum, unit) => sum + unit.minutes, 0)
}

/**
 * Merge consecutive undersized units into the one before them.
 *
 * Merging stops at a level change, so a subsection is never folded into the
 * section above it — the path would then claim you had read something it never
 * showed you.
 */
function coalesce(
  units: Array<Omit<ReadingUnit, 'key' | 'ordinal'>>
): Array<Omit<ReadingUnit, 'key' | 'ordinal'>> {
  const merged: Array<Omit<ReadingUnit, 'key' | 'ordinal'>> = []

  for (const unit of units) {
    const previous = merged[merged.length - 1]
    const mergeable =
      previous &&
      !previous.appendix &&
      !unit.appendix &&
      previous.level === unit.level &&
      previous.words < MIN_UNIT_WORDS

    if (!mergeable) {
      merged.push({ ...unit })
      continue
    }

    previous.endElementId = unit.endElementId
    previous.words += unit.words
    previous.minutes = minutesFor(previous.words)
    previous.mergedCount = (previous.mergedCount ?? 0) + 1
  }

  return merged
}

/**
 * Keys must be unique within a paper, and stable across re-renders.
 *
 * The heading alone is the best identity available — but two sections can
 * legitimately share a title ("Results" in two different appendices), so a
 * repeat falls back to disambiguating with its position. Sections with no
 * heading at all get a positional key, which is the unavoidable case.
 */
function assignKeys(units: Array<Omit<ReadingUnit, 'key' | 'ordinal'>>): ReadingUnit[] {
  const seen = new Map<string, number>()

  return units.map((unit, ordinal) => {
    const base = slug(unit.label) || `unit-${ordinal + 1}`
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return { ...unit, ordinal, key: count === 0 ? base : `${base}-${ordinal + 1}` }
  })
}

function isAppendix(node: Element | null | undefined): boolean {
  return !!node?.closest('.ltx_appendix')
}

/**
 * Count words in a section.
 *
 * Appendix subtrees are always skipped: they are counted once, by the
 * collapsed appendix unit, and any body unit that also counted them would
 * inflate the paper's estimate by the length of its own appendices.
 * `skipNestedSections` additionally excludes subsections, which is how a
 * container's own intro is measured.
 *
 * Walks the tree rather than cloning it. The clone-and-strip version was much
 * shorter, but it deep-copied every container section of a live paper — on a
 * long one that is megabytes of DOM, and it ran on the same tick as the
 * reader's scroll-position restore.
 */
function wordsIn(section: Element, skipNestedSections: boolean): number {
  const parts: string[] = []

  const walk = (node: Node): void => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        parts.push(child.nodeValue ?? '')
        continue
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue

      const element = child as Element
      // A space where the skipped subtree was, so the words either side of the
      // hole are not glued into one.
      if (element.matches('.ltx_appendix')) parts.push(' ')
      else if (skipNestedSections && element.matches('section[id]')) parts.push(' ')
      else walk(element)
    }
  }

  walk(section)
  return countWords(parts.join(''))
}

function countWords(text: string | null | undefined): number {
  const normalized = (text ?? '').replace(/\s+/g, ' ').trim()
  return normalized ? normalized.split(' ').length : 0
}

function minutesFor(words: number): number {
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE))
}

/** The last section inside this one — where its content actually ends. */
function lastChildSectionId(section: Element): string {
  const nested = section.querySelectorAll<HTMLElement>('section[id]')
  return nested.length > 0 ? nested[nested.length - 1].id : section.id
}

/**
 * A container's intro ends where its first subsection begins, so completion
 * fires when the reader reaches the subsection rather than the section's end.
 */
function firstChildSectionId(section: Element): string | undefined {
  return section.querySelector<HTMLElement>('section[id]')?.id
}

/**
 * LaTeXML puts the section number in its own `.ltx_tag` span, so the heading's
 * raw textContent runs them together ("1Introduction"). Read the two parts and
 * rejoin them with the space the markup implies.
 */
function labelOf(section: Element): string {
  const heading = section.querySelector<HTMLElement>(
    ':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6'
  )
  if (!heading) return ''

  const tag = heading.querySelector('.ltx_tag')?.textContent?.trim() ?? ''
  const rest = heading.cloneNode(true) as Element
  rest.querySelector('.ltx_tag')?.remove()

  return [tag, (rest.textContent ?? '').replace(/\s+/g, ' ').trim()].filter(Boolean).join(' ')
}

/** Nesting depth, so the path can indent subsections under their parent. */
function depthOf(section: Element): number {
  let level = 1
  let parent = section.parentElement?.closest('section[id]')
  while (parent) {
    level += 1
    parent = parent.parentElement?.closest('section[id]')
  }
  return Math.min(level, 3)
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}
