/** Child of run-owned.py; only fixed stage names and non-sensitive evidence leave it. */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { runModelSetup } from './browser-setup.mjs';
const [tooling, proofFile, fixtures, evidence] = process.argv.slice(2);
if (!tooling || !proofFile || !fixtures || !evidence || process.env.GITHUB_ACTIONS !== 'true')
  throw Error('Owned hosted browser fixture is required');
const { chromium } = await import(pathToFileURL(path.join(tooling, 'node_modules/playwright-core/index.mjs')));
const target = JSON.parse(readFileSync(proofFile, 'utf8'));
let stage = 'wire-preflight';
try {
  const result = await runModelSetup({
    chromium, origin: process.env.U003_GATEWAY_ORIGIN, modelOrigin: process.env.U003_MODEL_ORIGIN,
    password: process.env.U003_FIXTURE_PASSWORD, target, fixtures,
    checkOwned: () => {}, // Parent verifies retained process/PID/listener identity throughout.
    onStage: value => { stage = value; },
  });
  writeFileSync(evidence, JSON.stringify(result), { flag: 'wx', mode: 0o600 });
} catch {
  writeFileSync(evidence, JSON.stringify({ status: 'fail', stage, sourceCommit: target.sourceCommit }), { flag: 'wx', mode: 0o600 });
  process.exitCode = 1;
}
