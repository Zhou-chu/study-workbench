import { describe, expect, it } from 'vitest'

describe('transport and native separation', () => {
  it('does not retain the external API rewrite in either runtime mode', async () => {
    const { default: nextConfig } = await import('../../../next.config')
    expect(nextConfig.rewrites).toBeUndefined()
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBeUndefined()
  })
})
