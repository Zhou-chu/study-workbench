# Shared header and controlled-dialog repair
Scope: specification J12, CFG05 and keyboard/200% text-size requirements. Baseline 0c0e114 (production UI inherited from 9ee810 except previously reviewed setup return).
## Observed failures
The isolated fake-API Firefox review reported negative x coordinates for theme controls at 390×844 with all descendant computed font sizes doubled, despite document scrollWidth remaining 390. Evidence is owned by model-setup visual QA (smoke03). Narrow header controls were nonshrinking in an unwrapped end-aligned row.
Controlled LibraryDialog has no Radix Trigger. Escape and Close therefore left focus on BODY rather than its opening button. Two mounted tests reproduce the failure before the implementation change.
## Change and component verification
Narrow header and theme groups now wrap without removing controls. LibraryDialog captures the active opener before automatic dialog focus and restores it on dismissal when the component remains mounted or the dialog explicitly requested a normal close. The opener must remain connected and enabled. Unrelated component unmount does not restore stale focus.
Two failing focus tests now pass; three additional tests cover removed, disabled and unmounted targets. Full root npm test passed 2656 tests, typecheck/lint passed. Logs preserve red, green and final results.
## Remaining verification
Browser viewport/bounding-box and keyboard checks must be repeated on the integrated reviewed commit. CSS source presence is not viewport proof. Build pending clean commit and coordinated resource window. No live service or user browser was accessed. No real provider operation occurred. No claim of complete J12 acceptance.

## Conditional-unmount review correction
Independent review found that ModelsPage conditionally mounts its confirmation dialog. The first implementation suppressed restoration after a normal Escape/Close because that close also unmounted LibraryDialog. Two added conditional-mount cases failed against ba956a0 while the original five passed (conditional-red.txt). The correction records an explicit dialog close before notifying its parent, distinguishing dismissal from unrelated component unmount. All seven focus regressions now pass, including both conditional close cases and the three invalid/unmounted-target cases. Web typecheck and lint also pass. Independent review and integrated browser verification remain pending. The earlier 2656-test result applies to ba956a0, not this correction.
