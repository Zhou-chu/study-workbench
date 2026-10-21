# Saved audio playback — local acceptance only

Real native SurrealDB, API, durable export worker, production-built frontend and
headless Firefox. A public-domain synthetic WAV is created using Python stdlib
(440 Hz, mono PCM16, 16 kHz, 2 seconds), added to the existing public portable
fixture with valid hashes, and imported using authenticated production HTTP.
No production code or fake adapter is injected.

The actual saved asset is played twice (including after browser reload),
downloaded via API and browser, genuinely exported by the worker, and restored
into a second fresh database and filesystem. The complete playback/download
checks repeat there. Each browser playback asserts decoding, duration,
`currentTime` progression, and `ended`. Anonymous downloads return 401. Restored
historical jobs cannot replay. Both environments return identical WAV bytes and
SHA-256; the second import remaps artifact identity. See `audio-results.json`.

No Google login, Google generation, real independent-model audio, audible
speaker-output assessment, protected external deployment, or remote-service
recovery is claimed. Playback is muted in headless Firefox. The audio is a
synthetic saved-asset fixture, not an asserted remote generation result.

Reproduce after building frontend, from repository root:

```sh
PYTHON_DOTENV_DISABLED=1 \
PLAYWRIGHT_BROWSERS_PATH="$PWD/.runtime/browsers" \
python scripts/v1/audio_playback_check.py --out .runtime/audio-verification
npm --prefix frontend run test -- src/components/workbench/JobsPanel.audio.test.tsx
```

The Python interpreter needs `httpx` and Playwright, with Firefox installed as
in the runbook. Native database and project `.venv` are required. The script
launches isolated loopback services on ephemeral ports, uses only disposable
fixture credentials, disables dotenv loading and excludes inherited provider
credentials. Runtime `API_URL` explicitly points the browser to its random-port
API, with an explicit UI CORS origin; standalone Next rewrites are build-time.
All subprocesses stop on completion. Generated ZIP/WAV/PNG outputs are local,
regenerable evidence and are not included in this tracked evidence directory.
The two screenshots were inspected locally; audio controls showed 0:02 / 0:02.

Focused frontend regression: 3 passed. TypeScript, targeted Ruff and diff checks
passed. No production audio implementation change was needed.
