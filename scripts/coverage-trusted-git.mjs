import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
    accessSync, closeSync, constants, fstatSync, lstatSync, openSync,
    readFileSync, readSync, realpathSync,
} from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

function platformCheck() {
    if (process.platform === 'win32') {
        throw Error('Trusted Git requires POSIX custody checks; use WSL. Native Windows ACL verification is not implemented.');
    }
}

/** OS account home, deliberately independent of HOME/XDG and runner scratch homes. */
export function gitRegistrationPath() {
    platformCheck();
    return join(userInfo().homedir, '.notebook-tools', 'trusted-git.json');
}

/** Root/current uid custody; no symlinks, group/other writable nodes or sticky exceptions. */
export function checkGitCustody(filename) {
    platformCheck();
    if (!isAbsolute(filename) || resolve(filename) !== filename) {
        throw Error('Git custody requires a canonical absolute path');
    }
    let current = filename;
    while (true) {
        const stat = lstatSync(current);
        if (stat.isSymbolicLink() || ![0, process.getuid()].includes(stat.uid) || (stat.mode & 0o022)) {
            throw Error('Untrusted Git path custody: ' + current);
        }
        if (current !== filename && !stat.isDirectory()) {
            throw Error('Git ancestor is not a directory');
        }
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
    }
}

export function verifyGitDescriptor(descriptor) {
    platformCheck();
    const fields = ['binary', 'installRoot', 'sha256', 'version'];
    if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)
        || Object.keys(descriptor).length !== fields.length
        || !fields.every(key => Object.hasOwn(descriptor, key))
        || descriptor.version !== 1
        || typeof descriptor.binary !== 'string' || typeof descriptor.installRoot !== 'string'
        || typeof descriptor.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(descriptor.sha256)) {
        throw Error('Invalid trusted Git registration');
    }
    const { binary, installRoot } = descriptor;
    checkGitCustody(installRoot);
    checkGitCustody(binary);
    const inside = relative(installRoot, binary);
    if (!inside || inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside)
        || realpathSync(binary) !== binary || realpathSync(installRoot) !== installRoot) {
        throw Error('Git executable outside registered installation');
    }
    if (!lstatSync(installRoot).isDirectory()) {
        throw Error('Git installation is not a directory');
    }
    const stat = lstatSync(binary);
    if (!stat.isFile() || !(stat.mode & 0o111)) {
        throw Error('Git executable is not an executable regular file');
    }
    accessSync(binary, constants.X_OK);
    if (createHash('sha256').update(readFileSync(binary)).digest('hex') !== descriptor.sha256) {
        throw Error('Trusted Git checksum mismatch');
    }
    return Object.freeze({ ...descriptor });
}

/** Read/validate only. Executing consumers always use loadTrustedGit's fixed account location. */
export function readGitRegistration(file) {
    checkGitCustody(file);
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077)) {
            throw Error('Git registration must be private and owned by the current account');
        }
        if (stat.size > 4096) throw Error('Git registration oversized');
        const buffer = Buffer.alloc(4097);
        let length = 0;
        while (length < buffer.length) {
            const count = readSync(fd, buffer, length, buffer.length - length, null);
            if (count === 0) break;
            length += count;
        }
        if (length > 4096) throw Error('Git registration oversized');
        return verifyGitDescriptor(JSON.parse(buffer.subarray(0, length).toString('utf8')));
    } finally {
        closeSync(fd);
    }
}

export function loadTrustedGit() {
    return readGitRegistration(gitRegistrationPath());
}

/** Read-only evidence operations only. Caller cannot supply env, executable or arbitrary Git commands. */
export function trustedGit(args, { cwd }) {
    if (!Array.isArray(args) || !['ls-files', 'rev-parse', 'status'].includes(args[0])) {
        throw Error('Unsupported trusted Git evidence command');
    }
    const tool = loadTrustedGit();
    const env = {
        PATH: dirname(tool.binary), LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
        GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1',
    };
    return execFileSync(tool.binary, ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args], {
        cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
}
