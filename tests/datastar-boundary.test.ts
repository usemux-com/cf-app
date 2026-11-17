/**
 * Golden tests for the Datastar policy boundary (src/utils/datastar.ts).
 *
 * The exact strings asserted here mirror the SSE parser inside the vendored
 * runtime (public/static/datastar-1.0.2.js): `event:` line, `data: <key>
 * <value>` lines split at the first space, repeated keys joined with "\n",
 * blank-line terminator. If the runtime is ever upgraded, re-verify these.
 */
import { describe, expect, it } from 'vitest';
import {
  isDatastarRequest,
  patchElementsEvent,
  patchSignalsEvent,
  removeElementEvent,
  respondDual,
  selectorForId,
  sseResponse,
  TrustedHtml,
  trustedHtmlFromRenderedResponse,
} from '../src/utils/datastar';

function requestWith(headers: Record<string, string>): Request {
  return new Request('http://localhost/todo', { method: 'POST', headers });
}

describe('isDatastarRequest', () => {
  it('accepts the exact header the runtime sends', () => {
    expect(isDatastarRequest(requestWith({ 'Datastar-Request': 'true' }))).toBe(true);
  });

  it('accepts case-insensitive header names and values', () => {
    expect(isDatastarRequest(requestWith({ 'datastar-request': 'TRUE' }))).toBe(true);
  });

  it('rejects a missing header, unrelated values, and Accept-only requests', () => {
    expect(isDatastarRequest(requestWith({}))).toBe(false);
    expect(isDatastarRequest(requestWith({ 'Datastar-Request': '1' }))).toBe(false);
    expect(isDatastarRequest(requestWith({ 'Datastar-Request': 'yes' }))).toBe(false);
    expect(isDatastarRequest(requestWith({ Accept: 'text/event-stream' }))).toBe(false);
  });
});

describe('respondDual', () => {
  const branches = {
    ordinary: () => new Response('ordinary', { status: 200 }),
    datastar: () => sseResponse(patchSignalsEvent({ ok: true })),
  };

  it('runs the datastar branch for Datastar requests and stamps Vary', async () => {
    const res = await respondDual(requestWith({ 'Datastar-Request': 'true' }), branches);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(res.headers.get('Vary')).toBe('Datastar-Request');
  });

  it('runs the ordinary branch otherwise and still stamps Vary', async () => {
    const res = await respondDual(requestWith({}), branches);
    expect(await res.text()).toBe('ordinary');
    expect(res.headers.get('Vary')).toBe('Datastar-Request');
  });

  it('merges with an existing Vary instead of clobbering it', async () => {
    const res = await respondDual(requestWith({}), {
      ...branches,
      ordinary: () => new Response('cached', { headers: { Vary: 'Accept-Encoding' } }),
    });
    expect(res.headers.get('Vary')).toBe('Accept-Encoding, Datastar-Request');
  });

  it('does not duplicate Vary when the branch already set it', async () => {
    const res = await respondDual(requestWith({ 'Datastar-Request': 'true' }), branches);
    expect(res.headers.get('Vary')).toBe('Datastar-Request');
  });
});

describe('trustedHtmlFromRenderedResponse', () => {
  it('accepts a rendered text/html response', async () => {
    const html = await trustedHtmlFromRenderedResponse(
      new Response('<p>row</p>', { headers: { 'Content-Type': 'text/html; charset=UTF-8' } }),
    );
    expect(html.markup).toBe('<p>row</p>');
  });

  it('rejects non-HTML media types and error statuses', async () => {
    await expect(
      trustedHtmlFromRenderedResponse(
        new Response('{}', { headers: { 'Content-Type': 'application/json' } }),
      ),
    ).rejects.toThrow(/text\/html/);
    await expect(
      trustedHtmlFromRenderedResponse(
        new Response('<p>no</p>', { status: 500, headers: { 'Content-Type': 'text/html' } }),
      ),
    ).rejects.toThrow(/500/);
  });

  it('cannot be forged by routes', () => {
    expect(() => new TrustedHtml(Symbol('attacker'), '<b>x</b>')).toThrow(/minted/);
    expect(() =>
      patchElementsEvent(Object.create(TrustedHtml.prototype) as TrustedHtml, {
        selector: selectorForId('todo'),
        mode: 'before',
      }),
    ).toThrow();
  });
});

describe('selectorForId', () => {
  it('builds a #id selector from a stable server-owned id', () => {
    expect(selectorForId('todo')).toBe('#todo');
    expect(selectorForId('todo-9f3c1a2b-44ff')).toBe('#todo-9f3c1a2b-44ff');
  });

  it('rejects ids that would be unsafe or invalid selectors', () => {
    for (const bad of ['', '9starts-with-digit', 'a b', 'a>b', '#escape', 'a"b', 'user:input']) {
      expect(() => selectorForId(bad)).toThrow(/selector/);
    }
  });
});

describe('SSE framing', () => {
  async function trusted(markup: string): Promise<TrustedHtml> {
    return trustedHtmlFromRenderedResponse(
      new Response(markup, { headers: { 'Content-Type': 'text/html' } }),
    );
  }

  it('frames an element patch exactly (selector, mode, elements)', async () => {
    const event = patchElementsEvent(await trusted('<p id="todo-1">Hi</p>'), {
      selector: selectorForId('todo'),
      mode: 'before',
    });
    expect(event).toBe(
      'event: datastar-patch-elements\n' +
        'data: selector #todo\n' +
        'data: mode before\n' +
        'data: elements <p id="todo-1">Hi</p>\n\n',
    );
  });

  it('frames multiline markup as repeated data: elements lines', async () => {
    const event = patchElementsEvent(await trusted('<p>one</p>\n<p>two</p>'), {
      selector: selectorForId('todo'),
      mode: 'before',
    });
    expect(event).toContain('data: elements <p>one</p>\ndata: elements <p>two</p>\n\n');
  });

  it('frames a removal without an elements payload', () => {
    expect(removeElementEvent(selectorForId('todo-abc-123'))).toBe(
      'event: datastar-patch-elements\ndata: selector #todo-abc-123\ndata: mode remove\n\n',
    );
  });

  it('frames a signals patch as single-line JSON', () => {
    expect(patchSignalsEvent({ addTodoForm: { title: '', errors: null } })).toBe(
      'event: datastar-patch-signals\n' +
        'data: signals {"addTodoForm":{"title":"","errors":null}}\n\n',
    );
  });

  it('rejects a carriage return that would smuggle extra SSE lines', async () => {
    const smuggled = await trusted('<p>row</p>\r\ndata: mode remove');
    expect(() =>
      patchElementsEvent(smuggled, { selector: selectorForId('todo'), mode: 'before' }),
    ).toThrow(/control character/);
  });

  it('rejects other C0/DEL control characters in field values', async () => {
    const nul = await trusted('<p>a\x00b</p>');
    const del = await trusted('<p>a\x7Fb</p>');
    expect(() =>
      patchElementsEvent(nul, { selector: selectorForId('todo'), mode: 'before' }),
    ).toThrow(/control character/);
    expect(() =>
      patchElementsEvent(del, { selector: selectorForId('todo'), mode: 'before' }),
    ).toThrow(/control character/);
  });

  it('allows tabs and newlines, which cannot break framing', async () => {
    const event = patchElementsEvent(await trusted('<p>a\tb</p>\n<p>c</p>'), {
      selector: selectorForId('todo'),
      mode: 'before',
    });
    expect(event).toContain('data: elements <p>a\tb</p>\ndata: elements <p>c</p>\n\n');
  });
});

describe('sseResponse', () => {
  it('has the fixed policy: 200, text/event-stream, no-cache, Vary', () => {
    const res = sseResponse(patchSignalsEvent({ a: 1 }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(res.headers.get('Vary')).toBe('Datastar-Request');
  });

  it('concatenates multiple events into one stream', async () => {
    const res = sseResponse([
      patchSignalsEvent({ addTodoForm: { errors: null } }),
      patchSignalsEvent({ addTodoForm: { errors: { title: 'Title is required' } } }),
    ]);
    const body = await res.text();
    expect(body).toBe(
      'event: datastar-patch-signals\ndata: signals {"addTodoForm":{"errors":null}}\n\n' +
        'event: datastar-patch-signals\n' +
        'data: signals {"addTodoForm":{"errors":{"title":"Title is required"}}}\n\n',
    );
  });
});
