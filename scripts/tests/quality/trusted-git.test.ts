import { test, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { loadTrustedGit, trustedGit, verifyGitDescriptor, gitRegistrationPath, readGitRegistration } from '../../coverage-trusted-git.mjs';
import { provisionGit, provisionGitMain } from '../../coverage-git-provision.mjs';
import { auditRepositoryScope } from '../../coverage-scope.mjs';
import { sourceCommit, authoredPaths, ROOT } from '../../v1/spa-artifact-common.mjs';
import { inputDigest } from '../../coverage-integrity.mjs';
test('input digest ignores an attacker Git placed first on PATH', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hostile-git-'));
    const old = process.env.PATH;
    try {
        execFileSync(loadTrustedGit().binary, ['init', '--quiet'], { cwd: dir });
        writeFileSync(join(dir, 'source.txt'), 'real source');
        const expected = inputDigest(dir);
        const marker = join(dir, 'executed');
        writeFileSync(join(dir, 'git'), `#!/bin/sh\nprintf compromised > '${marker}'\n`, { mode: 0o700 });
        // Ignore the trap files so the genuine input set stays identical.
        writeFileSync(join(dir, '.git/info/exclude'), 'git\nexecuted\n');
        process.env.PATH = dir;
        expect(inputDigest(dir)).toBe(expected);
        expect(existsSync(marker)).toBe(false);
    }
    finally {
        process.env.PATH = old;
        rmSync(dir, { recursive: true, force: true });
    }
});
test('fixed registration is independent of HOME, XDG and arbitrary executable environment paths', () => {
    const expected = loadTrustedGit();
    const old = { ...process.env };
    try {
        Object.assign(process.env, { HOME: '/nonexistent/attacker', XDG_CONFIG_HOME: '/nonexistent', NOTEBOOK_GIT_BINARY: '/fake/git', GIT_EXEC_PATH: '/fake' });
        expect(loadTrustedGit()).toEqual(expected);
        expect(gitRegistrationPath()).toBe(join(userInfo().homedir, '.notebook-tools', 'trusted-git.json'));
    }
    finally {
        process.env = old;
    }
});
test('real repository evidence survives hostile Git environment and fsmonitor configuration', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-evidence-'));
    const old = { ...process.env };
    const native = loadTrustedGit().binary;
    try {
        const run = (...args: string[]) => execFileSync(native, args, { cwd: dir });
        run('init', '--quiet');
        writeFileSync(join(dir, 'tracked.txt'), 'tracked');
        run('add', 'tracked.txt');
        run('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'fixture');
        const head = run('rev-parse', 'HEAD').toString();
        writeFileSync(join(dir, '.gitignore'), 'ignored\nmonitor\n');
        writeFileSync(join(dir, 'ignored'), 'ignore');
        writeFileSync(join(dir, 'visible'), 'include');
        const marker = join(dir, 'monitor-executed');
        writeFileSync(join(dir, 'monitor'), `#!/bin/sh\nprintf bad > '${marker}'\n`, { mode: 0o700 });
        run('config', 'core.fsmonitor', join(dir, 'monitor'));
        Object.assign(process.env, { GIT_DIR: '/absent/git', GIT_WORK_TREE: '/absent/worktree', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: join(dir, 'monitor'), GIT_CONFIG_GLOBAL: '/attacker/config', GIT_CONFIG_SYSTEM: '/attacker/system', GIT_EXEC_PATH: '/attacker', LD_PRELOAD: '/attacker/library' });
        expect(trustedGit(['rev-parse', 'HEAD'], { cwd: dir })).toBe(head);
        expect(trustedGit(['status', '--porcelain'], { cwd: dir })).toContain('visible');
        const names = trustedGit(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: dir }).split('\0');
        expect(names).toContain('tracked.txt');
        expect(names).toContain('visible');
        expect(names).not.toContain('ignored');
        expect(existsSync(marker)).toBe(false);
        expect(() => trustedGit(['rev-parse', '--verify', 'absent-ref'], { cwd: dir })).toThrow();
        expect(() => trustedGit(['config', '--global', 'x.y', 'z'], { cwd: dir })).toThrow(/Unsupported/);
    }
    finally {
        process.env = old;
        rmSync(dir, { recursive: true, force: true });
    }
});
test('descriptor verification rejects tampering and unsafe paths without executing them', () => {
    const dir = mkdtempSync(join(userInfo().homedir, '.git-custody space-'));
    const binary = join(dir, 'git');
    const bytes = '#!/bin/sh\nexit 99\n';
    writeFileSync(binary, bytes, { mode: 0o700 });
    const good = { version: 1, binary, installRoot: dir, sha256: createHash('sha256').update(bytes).digest('hex') };
    try {
        expect(verifyGitDescriptor(good)).toEqual(good);
        expect(() => verifyGitDescriptor({ ...good, sha256: '0'.repeat(64) })).toThrow(/checksum/);
        expect(() => verifyGitDescriptor({ ...good, binary: 'relative/git' })).toThrow(/absolute/);
        expect(() => verifyGitDescriptor({ ...good, binary: dir })).toThrow();
        expect(() => verifyGitDescriptor({ ...good, installRoot: join(dir, 'missing') })).toThrow();
        mkdirSync(join(dir, 'other'));
        expect(() => verifyGitDescriptor({ ...good, installRoot: join(dir, 'other') })).toThrow(/outside/);
        chmodSync(binary, 0o600);
        expect(() => verifyGitDescriptor(good)).toThrow(/executable/);
        chmodSync(binary, 0o700);
        chmodSync(dir, 0o777);
        expect(() => verifyGitDescriptor(good)).toThrow(/custody/);
        chmodSync(dir, 0o700);
        symlinkSync(binary, join(dir, 'link'));
        expect(() => verifyGitDescriptor({ ...good, binary: join(dir, 'link') })).toThrow(/custody/);
        expect(() => verifyGitDescriptor({ ...good, extra: true })).toThrow(/Invalid/);
        expect(() => verifyGitDescriptor(null)).toThrow(/Invalid/);
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
test('provisioning cannot overwrite the existing trusted registration', () => {
    const filename = gitRegistrationPath(), before = readFileSync(filename);
    expect(() => provisionGit(loadTrustedGit())).toThrow(/EEXIST/);
    expect(readFileSync(filename)).toEqual(before);
    expect(() => provisionGitMain([])).toThrow(/Usage/);
});
test('scope and artifact provenance use registered Git under hostile PATH', () => {
    const old = process.env.PATH;
    process.env.PATH = '/nonexistent';
    try {
        expect(sourceCommit()).toMatch(/^[a-f0-9]{40}$/);
        expect(authoredPaths('web')).toContain('scripts/v1/spa-artifact-common.mjs');
        const audit = auditRepositoryScope(ROOT);
        expect(audit.records.find(row => row.path === 'scripts/coverage-trusted-git.mjs')?.partition).toBe('quality-tooling');
        expect(audit.unmeasured).toEqual([]);
    }
    finally {
        process.env.PATH = old;
    }
});
test('registration reader rejects oversized data, invalid JSON, arrays and nonprivate records', () => {
    const dir = mkdtempSync(join(userInfo().homedir, '.git-registration-'));
    const file = join(dir, 'registration.json');
    try {
        writeFileSync(file, ' '.repeat(4097), { mode: 0o600 });
        expect(() => readGitRegistration(file)).toThrow(/oversized/);
        writeFileSync(file, '{');
        expect(() => readGitRegistration(file)).toThrow();
        writeFileSync(file, '[]');
        expect(() => readGitRegistration(file)).toThrow(/Invalid/);
        writeFileSync(file, JSON.stringify(loadTrustedGit()));
        expect(readGitRegistration(file)).toEqual(loadTrustedGit());
        chmodSync(file, 0o644);
        expect(() => readGitRegistration(file)).toThrow(/private/);
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
test('executable bit for others does not authorize a non-executable owner', () => {
    const dir = mkdtempSync(join(userInfo().homedir, '.git-execute-'));
    const binary = join(dir, 'git'), data = 'not executable by owner';
    try {
        writeFileSync(binary, data, { mode: 0o601 });
        const descriptor = { version: 1, binary, installRoot: dir, sha256: createHash('sha256').update(data).digest('hex') };
        expect(() => verifyGitDescriptor(descriptor)).toThrow();
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
