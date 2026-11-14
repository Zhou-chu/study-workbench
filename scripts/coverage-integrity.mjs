import { createHash } from 'node:crypto';
import { trustedGit, loadTrustedGit } from './coverage-trusted-git.mjs';
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
export function fileDigest(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
export function inputDigest(root) {
    const files = trustedGit(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root }).split('\0').filter(Boolean);
    // Includes all tracked/nonignored first-party inputs, including Python helpers, fixtures, docs,
    // lockfiles and installed-package receipts. Reports stay outside the ignored input set.
    for (const file of ['node_modules/.package-lock.json', 'frontend/node_modules/.package-lock.json'])
        if (existsSync(resolve(root, file)))
            files.push(file);
    const hash = createHash('sha256');
    // Bind the independently registered tool identity as well as repository inputs.
    hash.update(JSON.stringify(loadTrustedGit()));
    for (const file of [...new Set(files)].sort()) {
        hash.update(file);
        hash.update(readFileSync(resolve(root, file)));
    }
    return hash.digest('hex');
}
export function saveManifest(root, name, row, outputBase = 'coverage') {
    const path = resolve(root, outputBase, 'run-' + name + '.json');
    mkdirSync(dirname(path), { recursive: true });
    const temporary = path + '.' + process.pid + '.tmp';
    writeFileSync(temporary, JSON.stringify({ generatedAt: new Date().toISOString(), partitions: [row] }, null, 2) + '\n');
    renameSync(temporary, path);
}
export function beginRun(root, names, digest, outputBase = 'coverage') {
    for (const name of names)
        saveManifest(root, name, { partition: name, phase: 'pending', testExitCode: null, inputDigest: digest }, outputBase);
}
