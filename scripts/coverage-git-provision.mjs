/** Explicit operator provisioning, never PATH discovery or trust-on-first-use in the runtime. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkGitCustody, gitRegistrationPath, verifyGitDescriptor } from './coverage-trusted-git.mjs';
export function provisionGit(descriptor) {
    const verified = verifyGitDescriptor(descriptor), file = gitRegistrationPath(), directory = dirname(file);
    checkGitCustody(dirname(directory));
    try {
        mkdirSync(directory, { mode: 0o700 });
    }
    catch (error) {
        if (error.code !== 'EEXIST')
            throw error;
    }
    checkGitCustody(directory);
    writeFileSync(file, JSON.stringify(verified, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return file;
}
export function provisionGitMain(args) {
    if (args.length !== 3)
        throw Error('Usage: coverage-git-provision.mjs ABSOLUTE_GIT ABSOLUTE_INSTALL_ROOT EXPECTED_SHA256; verify these independently before registering');
    return provisionGit({ version: 1, binary: args[0], installRoot: args[1], sha256: args[2] });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    console.log(provisionGitMain(process.argv.slice(2)));
