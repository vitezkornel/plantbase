import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Real npm deps of core that must stay plain Node `require`s on the
  // server instead of being bundled.
  serverExternalPackages: ['pg', 'cohere-ai', '@anthropic-ai/sdk'],

  // core/rag are TS-source workspace packages written for
  // `moduleResolution: nodenext`, so they import siblings as './x.js' while
  // the file on disk is './x.ts'. Turbopack has no equivalent of webpack's
  // `extensionAlias` (confirmed by a failed `next build`), which is why the
  // dev/build targets run Next with `--webpack` (see package.json).
  webpack: (config: {
    resolve: { extensionAlias?: Record<string, string[]> };
  }) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
