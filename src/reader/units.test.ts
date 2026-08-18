/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { buildUnits, totalMinutes } from './units'

/** Build a LaTeXML-shaped document fragment. */
function parse(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
}

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ')

function section(id: string, tag: string, title: string, body: string, inner = '') {
  return `<section id="${id}" class="ltx_section">
    <h2 class="ltx_title ltx_title_section"><span class="ltx_tag ltx_tag_section">${tag}</span>${title}</h2>
    <div class="ltx_para"><p>${body}</p></div>
    ${inner}
  </section>`
}

function subsection(id: string, tag: string, title: string, body: string) {
  return `<section id="${id}" class="ltx_subsection">
    <h3 class="ltx_title ltx_title_subsection"><span class="ltx_tag ltx_tag_subsection">${tag}</span>${title}</h3>
    <div class="ltx_para"><p>${body}</p></div>
  </section>`
}

describe('splitting a paper into units', () => {
  it('makes one unit per leaf section', () => {
    const doc = parse(
      section('S1', '1', 'Introduction', words(400)) + section('S2', '2', 'Method', words(400))
    )
    const units = buildUnits(doc)

    expect(units.map((u) => u.label)).toEqual(['1 Introduction', '2 Method'])
    expect(units.map((u) => u.elementId)).toEqual(['S1', 'S2'])
    expect(units.map((u) => u.key)).toEqual(['1-introduction', '2-method'])
  })

  it('splits a container into its subsections rather than emitting the container', () => {
    // The measurement that drove this: top-level sections ran to 102 minutes,
    // leaf sections to a p90 of ~5.
    const doc = parse(
      section(
        'S3',
        '3',
        'Experiments',
        words(10),
        subsection('S3.SS1', '3.1', 'Setup', words(400)) +
          subsection('S3.SS2', '3.2', 'Results', words(500))
      )
    )
    const units = buildUnits(doc)

    expect(units.map((u) => u.label)).toEqual(['3.1 Setup', '3.2 Results'])
    expect(units.every((u) => u.level === 2)).toBe(true)
  })

  it('keeps a container intro that is substantial enough to read on its own', () => {
    const doc = parse(
      section(
        'S3',
        '3',
        'Experiments',
        words(400),
        subsection('S3.SS1', '3.1', 'Setup', words(400))
      )
    )
    const units = buildUnits(doc)

    expect(units.map((u) => u.label)).toEqual(['3 Experiments', '3.1 Setup'])
    // The intro unit counts only its own prose, not the subsection's.
    expect(units[0].words).toBeLessThan(460)
  })

  it('ends a container intro where its first subsection begins', () => {
    const doc = parse(
      section(
        'S3',
        '3',
        'Experiments',
        words(400),
        subsection('S3.SS1', '3.1', 'Setup', words(400)) +
          subsection('S3.SS2', '3.2', 'Results', words(400))
      )
    )
    // Not the section's end — the intro is finished once you reach 3.1.
    expect(buildUnits(doc)[0].endElementId).toBe('S3.SS1')
  })

  it('does not descend past subsections', () => {
    // Real papers subdivide with \paragraph down to one-minute fragments;
    // splitting there turned a 45-minute paper into 31 checkboxes.
    const doc = parse(
      section(
        'S3',
        '3',
        'Experiments',
        words(400),
        `<section id="S3.SS1" class="ltx_subsection">
           <h3 class="ltx_title ltx_title_subsection"><span class="ltx_tag">3.1</span>Setup</h3>
           <p>${words(400)}</p>
           <section id="S3.SS1.SSS1" class="ltx_subsubsection">
             <h4 class="ltx_title">Hyperparameters</h4><p>${words(400)}</p>
           </section>
         </section>`
      )
    )
    const units = buildUnits(doc)

    expect(units.map((u) => u.label)).toEqual(['3 Experiments', '3.1 Setup'])
    // The subsubsection is read as part of 3.1, so 3.1 carries its words.
    expect(units[1].words).toBeGreaterThan(700)
  })
})

describe('coalescing undersized units', () => {
  it('merges consecutive fragments into something worth finishing', () => {
    const doc = parse(
      section('S1', '1', 'Motivation', words(120)) +
        section('S2', '2', 'Our Work', words(120)) +
        section('S3', '3', 'Contributions', words(120))
    )
    const units = buildUnits(doc)

    expect(units).toHaveLength(1)
    expect(units[0].label).toBe('1 Motivation')
    expect(units[0].mergedCount).toBe(2)
    // The merged unit must run to the end of the last thing folded into it.
    expect(units[0].endElementId).toBe('S3')
    expect(units[0].words).toBeGreaterThan(340)
  })

  it('never folds a subsection into the section above it', () => {
    // That would have the path claim you read something it never showed you.
    const doc = parse(
      section(
        'S1',
        '1',
        'Experiments',
        words(120),
        subsection('S1.SS1', '1.1', 'Setup', words(120))
      )
    )
    const units = buildUnits(doc)
    expect(units.map((u) => u.level)).toEqual([1, 2])
  })

  it('leaves a unit that is already big enough alone', () => {
    const doc = parse(
      section('S1', '1', 'Introduction', words(400)) + section('S2', '2', 'Method', words(120))
    )
    expect(buildUnits(doc).map((u) => u.mergedCount)).toEqual([undefined, undefined])
  })
})

describe('appendices', () => {
  const doc = () =>
    parse(
      section('S1', '1', 'Introduction', words(300)) +
        `<section id="A1" class="ltx_appendix">
           <h2 class="ltx_title ltx_title_appendix"><span class="ltx_tag">Appendix A</span>Proofs</h2>
           <div class="ltx_para"><p>${words(4000)}</p></div>
           <section id="A1.SS1" class="ltx_subsection"><h3 class="ltx_title">Lemma 1</h3><p>${words(500)}</p></section>
         </section>
         <section id="A2" class="ltx_appendix">
           <h2 class="ltx_title ltx_title_appendix"><span class="ltx_tag">Appendix B</span>Hyperparameters</h2>
           <div class="ltx_para"><p>${words(600)}</p></div>
         </section>`
    )

  it('collapses every appendix into a single optional unit', () => {
    const units = buildUnits(doc())
    expect(units).toHaveLength(2)

    const appendix = units[1]
    expect(appendix.appendix).toBe(true)
    expect(appendix.label).toBe('Appendices')
    expect(appendix.elementId).toBe('A1')
    expect(appendix.endElementId).toBe('A2')
  })

  it('does not let appendix subsections become units of their own', () => {
    // Left in the path, these are what make a finished paper read "6 of 41".
    expect(buildUnits(doc()).some((u) => u.elementId === 'A1.SS1')).toBe(false)
  })

  it('does not also count appendices inside the section that wraps them', () => {
    // Straight from a real paper: an ordinary "Appendix" section containing
    // the ltx_appendix blocks. Counting both listed 51 minutes twice and had
    // the path claim an hour more reading than the paper contained.
    const doc = parse(
      section('S1', '1', 'Introduction', words(400)) +
        `<section id="S5" class="ltx_section">
           <h2 class="ltx_title ltx_title_section"><span class="ltx_tag">5</span>Appendix</h2>
           <section id="A1" class="ltx_appendix">
             <h3 class="ltx_title">A Proofs</h3><p>${words(4000)}</p>
           </section>
         </section>`
    )
    const units = buildUnits(doc)

    // The wrapper contributes nothing of its own, so it is not a unit.
    expect(units.map((u) => u.label)).toEqual(['1 Introduction', 'A Proofs'])
    expect(units.filter((u) => u.appendix)).toHaveLength(1)
    expect(totalMinutes(units)).toBe(units[0].minutes)
  })

  it('excludes the appendix from the headline reading time', () => {
    const units = buildUnits(doc())
    expect(totalMinutes(units)).toBeLessThan(totalMinutes(units, true))
    expect(totalMinutes(units)).toBe(units[0].minutes)
  })
})

describe('unit keys survive a re-render', () => {
  it('keys on the heading, not the element id or position', () => {
    // arXiv renumbers element ids between versions; the whole point of the key
    // is that reading state does not evaporate when it does.
    const first = buildUnits(parse(section('S1', '1', 'Method', words(200))))
    const renumbered = buildUnits(
      parse(section('S7', '1', 'Method', words(200)))
    )
    expect(first[0].key).toBe(renumbered[0].key)
    expect(first[0].elementId).not.toBe(renumbered[0].elementId)
  })

  it('disambiguates genuinely repeated headings', () => {
    const doc = parse(
      section('S1', '1', 'Results', words(400)) + section('S2', '2', 'Results', words(400))
    )
    const keys = buildUnits(doc).map((u) => u.key)
    expect(new Set(keys).size).toBe(2)
  })

  it('falls back to position when a section has no heading', () => {
    const doc = parse(`<section id="S1" class="ltx_section"><p>${words(400)}</p></section>`)
    expect(buildUnits(doc)[0].key).toBe('s1')
  })
})

describe('reading time', () => {
  it('never rounds a real unit down to zero minutes', () => {
    const doc = parse(section('S1', '1', 'Conclusion', words(5)))
    expect(buildUnits(doc)[0].minutes).toBe(1)
  })

  it('is empty for a document with no sections', () => {
    expect(buildUnits(parse('<p>loose text</p>'))).toEqual([])
  })
})
