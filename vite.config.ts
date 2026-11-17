import path from 'path';
import { cloudflare } from '@cloudflare/vite-plugin';
import build, { defaultOptions as buildDefaultOptions } from '@hono/vite-build/cloudflare-workers';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import { wranglerConfig } from './tools/wrangler-config/src/index.ts';

const root = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(root, './src'),
    },
  },
  test: {
    // Playwright e2e specs live in e2e/ and run via `pnpm test:e2e`, not vitest.
    exclude: [...configDefaults.exclude, 'e2e/**'],
    // Emit an isolated test-mode wrangler.json under .wrangler/test/ so the
    // suite never inherits whichever mode last wrote the root config.
    globalSetup: ['./tools/wrangler-config/src/test-setup.ts'],
  },
  plugins: [
    // Generate wrangler.json before @cloudflare/vite-plugin reads it.
    // Unconditional (including build) so standalone wrangler CLI scripts find
    // a fresh config. Skips writing the root file when mode === 'test' — that
    // path is handled by test.globalSetup above.
    wranglerConfig(),
    // Cloudflare plugin — dev server only, not during tests
    ...[cloudflare()].flat().map((p) => ({
      ...p,
      apply: (_: unknown, env: { command: string; mode: string }) =>
        env.command === 'serve' && env.mode !== 'test',
    })),
    tailwindcss(),
    // Client build config — non-SSR builds only
    {
      name: 'cf-app:build-config',
      config(_, { command, isSsrBuild }) {
        if (command !== 'build') return;
        if (!isSsrBuild) {
          return {
            build: {
              rolldownOptions: {
                input: ['./src/web/bundle.ts', './src/web/style.css'],
                output: {
                  // Serve built client assets from /static/ to match the
                  // <link>/<script> refs in components.tsx and co-locate with the
                  // vendored Datastar runtime in public/static/.
                  entryFileNames: 'static/bundle.js',
                  assetFileNames: 'static/[name].[ext]',
                },
              },
            },
          };
        }
        return {
          build: {
            rolldownOptions: {
              external: ['cloudflare:workers'],
            },
          },
        };
      },
    },
    // Hono build — SSR build only
    ...[
      build({
        outputDir: 'dist-server',
        entryContentAfterHooks: [...(buildDefaultOptions.entryContentAfterHooks || [])],
        entryContentDefaultExportHook: buildDefaultOptions.entryContentDefaultExportHook,
      }),
    ]
      .flat()
      .map((p) => ({
        ...p,
        apply: (_: unknown, env: { command: string; isSsrBuild?: boolean }) =>
          env.command === 'build' && !!env.isSsrBuild,
      })),
  ],
});
