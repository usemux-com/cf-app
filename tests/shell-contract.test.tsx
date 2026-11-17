/**
 * Document shell contract: exactly one client runtime, vendored and pinned.
 *
 * Asserting the exact <script> set (instead of "does not contain X") keeps this
 * test free of references to any specific runtime while still proving that no
 * extra runtime ever sneaks back into the shell.
 */
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { renderer } from '../src/web/components';

async function renderShell(): Promise<string> {
  const app = new Hono();
  app.get('*', renderer);
  app.get('/', (c) => c.render(<main>todos</main>));

  const res = await app.request('/');
  return res.text();
}

describe('shell contract', () => {
  it('loads exactly the app bundle, the vite client, and the pinned Datastar runtime', async () => {
    const html = await renderShell();
    const scripts = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);

    // Dev-mode shell (import.meta.env.PROD is false under vitest).
    expect(scripts).toEqual(['/src/web/bundle.ts', '/@vite/client', '/static/datastar-1.0.2.js']);
  });

  it('loads the Datastar runtime as a module so it evaluates before user interaction', async () => {
    const html = await renderShell();
    expect(html).toContain('<script type="module" src="/static/datastar-1.0.2.js"></script>');
  });
});
