# Brainstorm Model
Updated: 2026-08-18 · Sessions: 2

## Idea register
| Idea | Type | Status | Last touched | Artifact |
| --- | --- | --- | --- | --- |
| Guided section read (Duolingo-style reading for arXiv papers) | System design | Exploring — recommended, gated on a 1-week use test | 2026-08-16 | `docs/guided-reading.md` in prabhay759/ai-arxiv-reader |
| Index-generated terminology drills | System design | Parked — strongest complement to the above; quality unproven | 2026-08-16 | same doc, "Options considered" |
| Highlights → FSRS flashcards | System design | Parked — rebuilds Readwise Daily Review | 2026-08-16 | same doc |
| Social / leaderboards | — | **Killed** — requires a backend, ruled out by architecture | 2026-08-16 | same doc |
| Guided section read | System design | **Built and shipped** (rating layer included; the 1-week gate was skipped) | 2026-08-18 | `docs/guided-reading.md` |
| Widen corpus to 2017 | System design | **Chosen** — 7/10 landmark papers missing today | 2026-08-18 | `docs/next-corpus-and-related.md` |
| Related papers from the local index | System design | **Chosen** — prototype verified against live data | 2026-08-18 | same doc |
| Citation graph via OpenAlex | System design | Parked — CORS confirmed, coverage unmeasured (429 from this IP) | 2026-08-18 | same doc |
| Personal feed from saved searches | System design | Parked — cheap, non-gamified reason to return | 2026-08-18 | same doc |

## Decisions log
- 2026-08-16 — Duolingo mechanics: adopt the *learning* machinery (bite-sized units,
  active recall, spaced revisiting), reject the *engagement* machinery (streaks, XP,
  leagues). Because published research shows streaks displace the underlying activity and
  gamification-motivated learners abandon more, and this user is the intrinsically
  motivated case. Reversible cheaply — nothing built depends on it.
- 2026-08-16 — Chose "guided section read" over drills and flashcards as the first build,
  because it improves reading itself rather than adding a side activity, and it supplies
  the signal the other two consume. Reversible.
- 2026-08-16 — Gate the rating layer behind one week of using path + passive progress
  only. Because the premortem's strongest failure story is prompt fatigue, and a week of
  no code falsifies it.

- 2026-08-18 — Build corpus widening before related papers, because a search engine that
  cannot find ResNet is broken in a way no feature compensates for, and it is one line of
  config. Reversible.
- 2026-08-18 — Do not build on OpenAlex yet. Its CORS header is confirmed but its coverage
  of recent arXiv preprints could not be measured from a rate-limited shared IP, and it is
  the only candidate that breaks the offline property. Revisit with a real measurement.

## Parking lot
- Index-generated drills (option B) — the only thing that supplies real *testing*; option
  A is Duolingo's skeleton without its nervous system. Cheapest test: generate 50
  questions from the live index and eyeball them.
- Widening `historyStart` so BERT/GPT-3/ResNet/GANs become searchable — carried over from
  earlier work, unrelated to this session. Config change + one ~90-min rebuild.

## Open experiments
- OpenAlex coverage of week-old arXiv preprints, from an un-throttled address. Blocks the
  citation-graph direction entirely. **Not yet run.**
- Human-judged relevance for related papers over ~30 seeds; only an 82% category-overlap
  proxy exists. **Not yet run.**
- Guided reading: ship path + passive completion only, use on 5 papers for a week. If
  flagging a section is never wanted, drop the rating layer. **Not yet run.**
- Unit-size measurement was n=8 papers. Re-run at n≥100 before building the splitter.
- Option B question quality: generate 50, inspect. **Not yet run.**

## Retrospective
- 2026-08-16: Measuring beat assuming, twice. I predicted pre-2024 papers would lack
  LaTeXML HTML (wrong — 40/40 had it) and my first two section-size measurements were
  both wrong in opposite directions before the third was right. On this project, check
  structural claims against the live corpus before they reach a recommendation.
- 2026-08-16: This user moves fast and builds immediately. Divergence compressed to one
  round with a recommendation attached worked well; a multi-round Socratic exploration
  would have been the wrong shape.

## Open threads
- Google OAuth client secret from a screenshot still needs deleting/rotating (unrelated
  to this session, still open across the project).
- Whether to publish design docs as shareable artifacts or keep them in-repo — kept
  in-repo this time.

- 2026-08-18: Three measurements this session each corrected a number I would otherwise
  have asserted. Size per paper was 614 B, not the ~977 B in the earlier doc. Index shards
  average 71 KB overall but 544 KB among those real queries actually hit. And my first
  related-papers prototype returned matches on `fre`/`ncy`/`usion` because ranking by
  rarest-term-first reliably selects typos — the output looked like an index bug and was a
  heuristic bug. Prototype before recommending, on this project especially.
