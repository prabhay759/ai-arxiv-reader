# Brainstorm Model
Updated: 2026-08-16 · Sessions: 1

## Idea register
| Idea | Type | Status | Last touched | Artifact |
| --- | --- | --- | --- | --- |
| Guided section read (Duolingo-style reading for arXiv papers) | System design | Exploring — recommended, gated on a 1-week use test | 2026-08-16 | `docs/guided-reading.md` in prabhay759/ai-arxiv-reader |
| Index-generated terminology drills | System design | Parked — strongest complement to the above; quality unproven | 2026-08-16 | same doc, "Options considered" |
| Highlights → FSRS flashcards | System design | Parked — rebuilds Readwise Daily Review | 2026-08-16 | same doc |
| Social / leaderboards | — | **Killed** — requires a backend, ruled out by architecture | 2026-08-16 | same doc |

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

## Parking lot
- Index-generated drills (option B) — the only thing that supplies real *testing*; option
  A is Duolingo's skeleton without its nervous system. Cheapest test: generate 50
  questions from the live index and eyeball them.
- Widening `historyStart` so BERT/GPT-3/ResNet/GANs become searchable — carried over from
  earlier work, unrelated to this session. Config change + one ~90-min rebuild.

## Open experiments
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
