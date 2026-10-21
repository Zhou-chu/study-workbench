# Same-place project export delivery — native Firefox verification

Run 2026-10-21 against the production Next build on an isolated native SurrealDB/API/worker stack:

```sh
PLAYWRIGHT_BROWSERS_PATH=$PWD/.runtime/browsers \
python scripts/v1/export_delivery_check.py \
  --out docs/v1/evidence/continuation-2026-10-21f/browser
```

**Passed, Chinese Firefox at 390×844.** The authored public Markdown original and saved note were seeded through native APIs. Starting with the worker stopped made the real queued state observable; the worker was then started to complete extraction/export. No Google, model, paid service, private configuration, or personal data was used.

- Keyboard-opened 项目备份 and submitted exactly once. Native backend contained one queued export; duplicate export control was disabled.
- Controlled browser interception returned 503 for status reads. The same disclosure explained uncertainty and offered manual refresh, which recovered without another export POST. Task-history polling is independently mounted: total job GETs are **not** evidence that the backup query retried automatically.
- Actual worker completion exposed 下载项目包 in the original disclosure, while 阅读与提问 remained selected throughout. No navigation to Notes was necessary.
- Controlled first-download 503 showed a retry instruction. Keyboard retry fetched the same artifact: two download requests, one export POST, one backend export job.
- Firefox delivered the ZIP to Playwright, which saved it in the disposable runtime directory and verified format v1, exact saved note, original file bytes, and every manifest file size/SHA-256. Archive hash and size are in `results.json`; the archive itself is not published with the evidence.
- UI distinguishes “package generated” from browser download handoff and asks the user to confirm persistence in browser downloads. The test's saved ZIP is not proof of persistence on a real user's device.
- All five screenshot states passed document width ≤391 and height ≤845 checks. Ready and download-started screenshots were visually inspected: readable Chinese text, visible download action, no horizontal overflow. Zero browser page errors and zero blocked out-of-scope requests.

Screenshots: queued, status error, generated/ready, download error, browser handoff. These are expert/automated regression observations, not user research, accessibility certification, or real-world network-outage testing. Processes were stopped and API port 5055 released after the run.
