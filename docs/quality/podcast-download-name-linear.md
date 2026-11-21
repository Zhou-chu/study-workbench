# Podcast download filename suffix scan

Fixed input baseline: `19203ed`. The download response filename passes through
`downloadName` without a length bound. The subsequent `/[. ]+$/g` repeatedly
reconsiders starting positions in a long dot/space run followed by a nonmember.
The later 180-code-unit slice does not bound this earlier work.

## Observed RED

The actual expression was extracted from PodcastAudio.tsx and evaluated in a
Node 24.19.0 VM with a 1700ms timeout, synthetic downloadName output of 40,000
dots plus `x`, and no browser, network or data access. The 200ms CPU assertion
failed: 1602.51ms CPU, no VM timeout. Evidence:
`C:\Users\USER\podcast-filename-red.log`.
A resource-window message crossed Xiumi's packaging notification; this sample
was NOT confirmed exclusive. It demonstrates expensive work on bounded input,
not a stable runtime ratio or an uncontended benchmark. No repeated attack or
large/full-suite timing run was performed.

## Change and exact policy

`podcastDownloadName` is pure string logic. It first replaces the same Windows
illegal characters, then scans backward once for exactly U+0020 or U+002E,
then strips that suffix, slices the first 180 UTF-16 code units, falls back to
`podcast.mp3`, and finally prefixes reserved DOS names with `_`. This intentionally
preserves historical edge cases: the slice may split a surrogate pair or expose
a trailing dot, and a reserved-name prefix can yield 181 code units. This patch
does not silently redesign that policy. SourceAsset disposition parsing is unchanged.
The replacement pass and backward scan are linear; there is no unanchored
variable-length suffix regex or input truncation used to hide the risk.

## Verification and classification

Two-file ordinary Vitest run: **47 passed**, 21.22s; evidence
`/home/USER/notebook-quality-20261113/podcast-name-green.log`.
- 15 new pure-unit cases: concrete Windows/fallback/Unicode rules, all 9,331
  strings of lengths 0–5 over six characters against the bounded historical
  oracle, truncation-order edge cases, and long failing/fully stripped suffixes.
  These execute the real pure helper, no I/O or helper mocks.
- 32 existing/extended lifecycle component cases: two additional download
  filename cases preserve real component invocation, temporary URL cleanup and
  no HEAD request. These use React and simulated HTTP and are NOT strict unit.

No performance improvement ratio is inferred from the ordinary green suite.
No whole-project coverage, final Sonar state, browser download, deployment or
runtime data migration is claimed. Test-layer manifest remains for coordinator review.
