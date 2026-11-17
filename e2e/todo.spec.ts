/**
 * Real-browser proof for the Datastar migration, against the dev server
 * (workerd via @cloudflare/vite-plugin) and the exact vendored runtime shipped
 * to users (public/static/datastar-1.0.2.js). No test adapter.
 *
 * Serial on purpose: every scenario shares the local D1 database and rows are
 * addressed by unique titles.
 */
import { expect, test, type Page } from '@playwright/test';

const TITLE_INPUT = 'Add a task…';

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const url = message.location()?.url ?? '';
    if (url.includes('favicon')) return; // no favicon is shipped; unrelated 404 noise
    errors.push(`console: ${message.text()}`);
  });
  return errors;
}

/** Abort (and record) any request leaving the dev origin: the runtime must be fully local. */
async function enforceOffline(page: Page): Promise<string[]> {
  const violations: string[] = [];
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.protocol === 'data:' || url.protocol === 'blob:') {
      return route.continue();
    }
    violations.push(route.request().url());
    return route.abort();
  });
  return violations;
}

async function addTodo(page: Page, title: string) {
  const input = page.getByPlaceholder(TITLE_INPUT);
  await input.fill(title);
  await page.getByRole('button', { name: 'Add' }).click();
  return page.locator('p.row', { hasText: title });
}

test('add todo: enhanced patch lands without reload, input clears, SSE response, zero external requests', async ({
  page,
}) => {
  const consoleErrors = collectConsoleErrors(page);
  const violations = await enforceOffline(page);

  await page.goto('/');
  const title = `e2e add ${crypto.randomUUID()}`;

  const sseResponse = page.waitForResponse(
    (res) => res.request().method() === 'POST' && res.url().endsWith('/todo'),
  );
  const row = await addTodo(page, title);
  const response = await sseResponse;

  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('text/event-stream');
  expect(response.headers()['vary']).toContain('Datastar-Request');

  await expect(row).toHaveCount(1);
  await expect(page.getByPlaceholder(TITLE_INPUT)).toHaveValue('');
  expect(page.url()).toMatch(/\/$/); // no navigation occurred

  // cleanup
  await row.getByRole('button', { name: 'Delete' }).click();
  await expect(row).toHaveCount(0);

  expect(violations).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('validation: empty submit shows a recoverable inline error; correcting clears it', async ({
  page,
}) => {
  const consoleErrors = collectConsoleErrors(page);
  await page.goto('/');

  const invalid = page.waitForResponse(
    (res) => res.request().method() === 'POST' && res.url().endsWith('/todo'),
  );
  await page.getByRole('button', { name: 'Add' }).click();
  const invalidResponse = await invalid;

  // Recoverable feedback must be a 200 SSE patch, never a 4xx body.
  expect(invalidResponse.status()).toBe(200);
  expect(invalidResponse.headers()['content-type']).toBe('text/event-stream');

  const alert = page.getByRole('alert');
  await expect(alert).toHaveText('Title is required');
  const input = page.getByPlaceholder(TITLE_INPUT);
  await expect(input).toHaveAttribute('aria-invalid', 'true');

  const title = `e2e fix ${crypto.randomUUID()}`;
  const row = await addTodo(page, title);
  await expect(row).toHaveCount(1);
  await expect(alert).toBeHidden();
  await expect(input).toHaveAttribute('aria-invalid', 'false');

  await row.getByRole('button', { name: 'Delete' }).click();
  await expect(row).toHaveCount(0);

  expect(consoleErrors).toEqual([]);
});

test('duplicate submit: a fast double click sends exactly one request and adds one row', async ({
  page,
}) => {
  const consoleErrors = collectConsoleErrors(page);
  await page.goto('/');

  let posts = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/todo')) posts += 1;
  });

  const title = `e2e dbl ${crypto.randomUUID()}`;
  await page.getByPlaceholder(TITLE_INPUT).fill(title);
  await page.getByRole('button', { name: 'Add' }).dblclick();

  const row = page.locator('p.row', { hasText: title });
  await expect(row).toHaveCount(1);
  // Let any erroneously-started second request surface before counting.
  await page.waitForTimeout(500);
  expect(posts).toBe(1);

  await row.getByRole('button', { name: 'Delete' }).click();
  await expect(row).toHaveCount(0);

  expect(consoleErrors).toEqual([]);
});

test('delete todo: row is removed without reload', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  await page.goto('/');

  const title = `e2e del ${crypto.randomUUID()}`;
  const row = await addTodo(page, title);
  await expect(row).toHaveCount(1);

  const removeResponse = page.waitForResponse(
    (res) => res.request().method() === 'DELETE' && res.url().includes('/todo/'),
  );
  await row.getByRole('button', { name: 'Delete' }).click();
  const response = await removeResponse;

  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('text/event-stream');
  await expect(row).toHaveCount(0);
  expect(page.url()).toMatch(/\/$/);

  expect(consoleErrors).toEqual([]);
});

test('native fallback: with JavaScript disabled the form still posts to /todo', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL: undefined });
  const page = await context.newPage();

  await page.goto('http://127.0.0.1:5199/');
  const title = `e2e native ${crypto.randomUUID()}`;
  await page.getByPlaceholder(TITLE_INPUT).fill(title);

  const [response] = await Promise.all([
    page.waitForNavigation(),
    page.getByRole('button', { name: 'Add' }).click(),
  ]);

  // Ordinary contract: 200 bare row fragment (same as the pre-migration baseline).
  expect(response?.status()).toBe(200);
  expect(page.url()).toContain('/todo');
  expect(await page.content()).toContain(title);

  await context.close();
});
