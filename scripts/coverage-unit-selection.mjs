/**
 * First-stage unit selection/preflight only. Does not launch tests or change scope.
 * The Python bridge is pure policy, not an authentication boundary.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { trustedGit } from './coverage-trusted-git.mjs';

const policy = new URL('./quality/test_layers.py', import.meta.url);
const manifestPath = 'scripts/quality/test-layers.json';
const producerRoot = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const producerPaths = [
    'scripts/coverage-unit-selection.mjs',
    'scripts/coverage-trusted-git.mjs',
    'scripts/quality/test_layers.py',
];
// Bind the loaded implementation's own checkout, not an artifact's claims.
const producerHashes = Object.fromEntries(producerPaths.map(path => [
    path, createHash('sha256').update(containedBytes(producerRoot, path)).digest('hex'),
]));

function containedBytes(root, path) {
    if (typeof path !== 'string' || !path || path.startsWith('/')
        || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) {
        throw Error('Unsafe tracked inventory path');
    }
    const file = resolve(root, path);
    // Reject symlinked parents too; no arbitrary linked inputs enter a snapshot.
    if (realpathSync(file) !== file) throw Error('Tracked input must not be a symlink');
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        if (!fstatSync(fd).isFile()) throw Error('Tracked input must be a regular file');
        return readFileSync(fd);
    } finally {
        closeSync(fd);
    }
}

function capture(root) {
    const revision = trustedGit(['rev-parse', '--verify', 'HEAD'], { cwd: root }).trim();
    const top = trustedGit(['rev-parse', '--show-toplevel'], { cwd: root }).trim();
    if (realpathSync(top) !== root) throw Error('Selection requires repository root');
    if (trustedGit(['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root }).length) {
        throw Error('Unit selection requires a clean tracked and untracked worktree');
    }
    const raw = trustedGit(['ls-files', '--cached', '-z'], { cwd: root });
    if (!raw || !raw.endsWith('\0')) throw Error('Invalid complete Git inventory');
    const inventory = raw.slice(0, -1).split('\0').sort();
    if (new Set(inventory).size !== inventory.length) throw Error('Duplicate Git inventory');
    const hashes = Object.create(null);
    let document;
    for (const path of inventory) {
        const bytes = containedBytes(root, path);
        hashes[path] = createHash('sha256').update(bytes).digest('hex');
        if (path === manifestPath) document = JSON.parse(bytes.toString('utf8'));
    }
    if (!document) throw Error('Classification manifest must be tracked at its fixed path');
    for (const path of producerPaths) {
        if (hashes[path] !== producerHashes[path]) {
            throw Error('Tracked producer identity missing or changed: ' + path);
        }
    }
    return { revision, inventory, hashes, document };
}

function policyResult(request) {
    let stdout;
    try {
        // Fixed system interpreter, isolated stdlib-only policy; never PATH/env-selected.
        stdout = execFileSync('/usr/bin/python3', ['-I', fileURLToPath(policy), '--binding-stdin'], {
            input: JSON.stringify(request), encoding: 'utf8', timeout: 30_000,
            maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
            env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', PYTHONDONTWRITEBYTECODE: '1' },
        });
    } catch (error) {
        if (error.stdout) {
            const result = JSON.parse(error.stdout.toString());
            throw Error(result.error || 'Unit selection policy rejected inputs');
        }
        throw error;
    }
    const result = JSON.parse(stdout);
    if (result.ok !== true) throw Error('Unit selection policy failed');
    return result.value;
}

function checked(root, artifact, verify) {
    root = realpathSync(root);
    if (root !== producerRoot) throw Error('Selection root does not belong to this producer checkout');
    const before = capture(root);
    const value = policyResult(verify ? { current: before, artifact } : { current: before });
    const after = capture(root);
    if (!isDeepStrictEqual(before, after)) throw Error('Selection inputs changed during validation');
    return value;
}

export function createUnitSelection(root) {
    return checked(root, undefined, false);
}

/** Runner boundary: artifact claims alone never authorize execution. */
export function validateCurrentUnitSelection(root, artifact) {
    return checked(root, artifact, true);
}
