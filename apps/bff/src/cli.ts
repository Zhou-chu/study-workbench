import { getWebSessionConfig, createBffServer } from './server.js';
// The CLI is the only listening entry point. No production service is activated by imports.
try {
    const value = process.env.PORT ?? '3000';
    if (!/^\d+$/.test(value) || Number(value) > 65535 || Number(value) < 1)
        throw new Error('INVALID_PORT');
    const server = createBffServer(getWebSessionConfig());
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
        process.once(signal, () => { server.close(() => { process.exitCode = 0; }); });
    server.on('error', () => { console.error('BFF_START_FAILED'); process.exitCode = 1; });
    server.listen(Number(value), '127.0.0.1');
}
catch {
    console.error('BFF_START_FAILED');
    process.exitCode = 1;
}
