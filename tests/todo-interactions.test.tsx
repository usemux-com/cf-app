/**
 * Todo interaction contracts — the behavior that must survive regardless of
 * which client runtime is wired up: native form semantics, stable IDs the
 * server patches, field names, action URLs, the dual ordinary/enhanced
 * response contract, and escaping.
 *
 * Infra-free: a fake db is injected through createApp, so no D1/Workers
 * runtime is needed. Real-browser behavior (morphs, focus, the pending lock)
 * is covered by the e2e pass, not here.
 */
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import type { HtmlEscapedString } from 'hono/utils/html';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/index';
import { schemaValidator } from '../src/utils/common';
import { AddTodo, Item } from '../src/web/components';

async function renderToHtml(node: HtmlEscapedString | Promise<HtmlEscapedString>): Promise<string> {
  const app = new Hono();
  app.get('/', (c) => c.html(node));
  const res = await app.request('/');
  return res.text();
}

function createFakeDb(rows: Array<{ id: string; title: string }> = []) {
  const calls = {
    inserted: [] as Array<{ id: string; title: string }>,
    deletes: 0,
  };
  const db = {
    select: () => ({ from: async () => rows }),
    insert: () => ({
      values: async (values: { id: string; title: string }) => {
        calls.inserted.push(values);
      },
    }),
    delete: () => ({
      where: async () => {
        calls.deletes += 1;
      },
    }),
  };
  return { db: db as unknown as DrizzleD1Database, calls };
}

function postTodo(body: string, datastar = false) {
  return new Request('http://localhost/todo', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(datastar ? { 'Datastar-Request': 'true' } : {}),
    },
    body,
  });
}

describe('AddTodo form contract', () => {
  it('is a real native form posting title to POST /todo', async () => {
    const html = await renderToHtml(<AddTodo />);
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/todo"');
    expect(html).toContain('name="title"');
  });

  it('enhances the submit with a form-encoded Datastar action and owns its pending state', async () => {
    const html = await renderToHtml(<AddTodo />);
    expect(html).toContain(
      `data-on:submit="@post(&#39;/todo&#39;, {contentType: &#39;form&#39;})"`,
    );
    expect(html).toContain('data-indicator:add-todo-pending=""');
    expect(html).toContain('data-lock=""');
    expect(html).toContain('data-bind="addTodoForm.title"');
  });

  it('initializes its nested signal group at render time', async () => {
    // Effects subscribed to auto-created placeholder signals may never fire;
    // the watched shape must exist from the start.
    const html = await renderToHtml(<AddTodo />);
    expect(html).toContain(
      'data-signals:add-todo-form="{title: &#39;&#39;, errors: {title: &#39;&#39;}}"',
    );
  });

  it('renders a hidden, reactive field-error region', async () => {
    const html = await renderToHtml(<AddTodo />);
    expect(html).toContain('data-show="$addTodoForm.errors.title"');
    expect(html).toContain('data-attr:aria-invalid="$addTodoForm.errors.title ?');
  });
});

describe('Item row contract', () => {
  it('has a stable server-owned row id and a delete action for that row', async () => {
    const html = await renderToHtml(<Item title="Buy milk" id="abc-123" />);
    expect(html).toContain('id="todo-abc-123"');
    expect(html).toContain(`data-on:click="@delete(&#39;/todo/abc-123&#39;)"`);
    expect(html).toContain('Buy milk');
  });

  it('escapes the title', async () => {
    const html = await renderToHtml(<Item title="<script>alert(1)</script>" id="abc-123" />);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});

describe('validation error channel contract', () => {
  const app = new Hono();
  app.post(
    '/todo',
    schemaValidator(
      'form',
      v.object({ title: v.pipe(v.string(), v.minLength(1, 'Title is required')) }),
      { signalsGroup: 'addTodoForm' },
    ),
    (c) => c.text('ok'),
  );

  it('ordinary requests keep the plain 400 JSON contract', async () => {
    const res = await app.request(postTodo('title='));
    expect(res.status).toBe(400);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(res.headers.get('Vary')).toBe('Datastar-Request');
    const body = (await res.json()) as Record<string, { message: string }>;
    expect(body.title.message).toBe('Title is required');
  });

  it('Datastar requests get a recoverable 200 SSE patch with the field messages', async () => {
    const res = await app.request(postTodo('title=', true));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(res.headers.get('Vary')).toBe('Datastar-Request');
    expect(await res.text()).toBe(
      'event: datastar-patch-signals\n' +
        'data: signals {"addTodoForm":{"errors":{"title":"Title is required"}}}\n\n',
    );
  });

  it('accepts a valid title (validation passes, handler runs)', async () => {
    const res = await app.request(postTodo('title=Buy%20milk'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });
});

describe('POST /todo contract', () => {
  it('ordinary requests get the bare row fragment, unchanged from the baseline', async () => {
    const { db, calls } = createFakeDb();
    const app = createApp(() => db);

    const res = await app.request(postTodo('title=Buy%20milk'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('<p id="todo-');
    expect(body).toContain('Buy milk');
    expect(calls.inserted).toHaveLength(1);
    expect(calls.inserted[0].title).toBe('Buy milk');
  });

  it('Datastar requests get the row patched before the sentinel plus a form-reset signal patch', async () => {
    const { db, calls } = createFakeDb();
    const app = createApp(() => db);

    const res = await app.request(postTodo('title=Buy%20milk', true));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(res.headers.get('Vary')).toBe('Datastar-Request');
    const body = await res.text();

    expect(body).toContain('event: datastar-patch-elements\n');
    expect(body).toContain('data: selector #todo\n');
    expect(body).toContain('data: mode before\n');
    expect(body).toContain('data: elements <p id="todo-');
    expect(body).toContain('Buy milk');
    expect(body).toContain(
      'event: datastar-patch-signals\ndata: signals {"addTodoForm":{"title":"","errors":{"title":""}}}\n\n',
    );
    expect(calls.inserted).toHaveLength(1);
  });

  it('escapes titles inside enhanced patches', async () => {
    const { db } = createFakeDb();
    const app = createApp(() => db);

    const res = await app.request(postTodo(`title=${encodeURIComponent('<b>bold</b>')}`, true));
    const body = await res.text();
    expect(body).toContain('&lt;b&gt;bold&lt;/b&gt;');
    expect(body).not.toContain('<b>bold</b>');
  });
});

describe('DELETE /todo/:id contract', () => {
  it('ordinary requests get the baseline 200 empty body', async () => {
    const { db, calls } = createFakeDb();
    const app = createApp(() => db);

    const res = await app.request('http://localhost/todo/abc-123', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
    expect(calls.deletes).toBe(1);
  });

  it('Datastar requests get a remove patch for the stable row id', async () => {
    const { db, calls } = createFakeDb();
    const app = createApp(() => db);

    const res = await app.request('http://localhost/todo/abc-123', {
      method: 'DELETE',
      headers: { 'Datastar-Request': 'true' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(await res.text()).toBe(
      'event: datastar-patch-elements\ndata: selector #todo-abc-123\ndata: mode remove\n\n',
    );
    expect(calls.deletes).toBe(1);
  });

  it('rejects malformed protocol row ids with a distinct 400', async () => {
    const { db } = createFakeDb();
    const app = createApp(() => db);

    const res = await app.request('http://localhost/todo/a%20b', {
      method: 'DELETE',
      headers: { 'Datastar-Request': 'true' },
    });
    expect(res.status).toBe(400);
  });
});

describe('GET / contract', () => {
  it('renders the form, existing rows, and the list sentinel the patches target', async () => {
    const { db } = createFakeDb([{ id: 'abc-123', title: 'Buy milk' }]);
    const app = createApp(() => db);

    const res = await app.request('http://localhost/');
    const body = await res.text();
    expect(body).toContain('id="add-todo-form"');
    expect(body).toContain('id="todo-abc-123"');
    expect(body).toContain('id="todo"');
  });
});
