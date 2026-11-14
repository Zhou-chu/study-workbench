import { trustedGit } from './coverage-trusted-git.mjs';
import { relative, resolve } from 'node:path';
import { inventory } from './coverage-inventory.mjs';
export const coveragePartitions = { contracts: 'packages/contracts', domain: 'packages/domain', 'web-transport': 'packages/web-transport', bff: 'apps/bff', web: 'apps/web', 'legacy-web': 'frontend', 'node-tools': null, 'legacy-node-tools': null, 'deployment-config': '.', 'quality-tooling': '.', 'quality-configs': null };
export function auditRepositoryScope(root) {
    const covered = new Map();
    for (const [name, directory] of Object.entries(coveragePartitions))
        for (const file of inventory(root, name, directory))
            covered.set(relative(root, file).replaceAll('\\', '/'), name);
    const configs = new Set(['apps/web/vite.config.ts', 'eslint.config.mjs', 'frontend/eslint.config.mjs', 'frontend/postcss.config.mjs', 'frontend/vitest.config.ts']);
    const paths = trustedGit(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root }).split('\0').filter(path => /\.(?:[cm]?js|jsx|tsx?)$/.test(path));
    const records = [...new Set(paths)].sort().map(path => {
        const kind = covered.has(path) ? 'measured-source' : /\.d\.ts$/.test(path) ? 'declarations' : /(?:\.test\.|\.spec\.|(?:^|\/)(?:test|tests)\/)/.test(path) ? 'test-infrastructure' : path.startsWith('apps/web/public/pdfjs/') ? 'third-party-pdfjs' : path.startsWith('scripts/coverage-') || path.endsWith('/coverage.config.ts') ? 'coverage-harness' : configs.has(path) ? 'configuration' : 'unmeasured';
        return { path, kind, ...(covered.has(path) ? { partition: covered.get(path) } : {}) };
    });
    return { records, unmeasured: records.filter(row => row.kind === 'unmeasured').map(row => row.path), configuration: records.filter(row => row.kind === 'configuration').map(row => row.path) };
}
