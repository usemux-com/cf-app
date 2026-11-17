/**
 * Datastar policy boundary — the only application module that owns the Datastar
 * wire protocol: request classification, SSE framing, patch selectors/modes,
 * signal patches, and trusted server-rendered HTML.
 *
 * Wire format verified against the vendored browser runtime
 * public/static/datastar-1.0.2.js (see MIGRATION.md for version/hash):
 *
 *   - client sends `Datastar-Request: true` and
 *     `Accept: text/event-stream, text/html, application/json`;
 *   - SSE block: `event: <name>` then `data: <key> <value>` lines, key/value
 *     split at the first space, repeated keys joined with "\n" (multiline HTML
 *     = repeated `data: elements` lines), block terminated by a blank line;
 *   - `datastar-patch-elements` keys: selector, mode (default outer; selector
 *     required for every mode except outer/replace), namespace, elements;
 *   - `datastar-patch-signals` keys: signals (JSON; nested merge — absent
 *     siblings are untouched, but see the null-deletion warning on
 *     patchSignalsEvent), onlyIfMissing;
 *   - HTTP status >= 400 is a client fetch error, so recoverable validation
 *     feedback must be a 200 patch, never a 4xx body;
 *   - attribute names are lowercased by HTML, so keyed attributes
 *     (data-indicator:…, data-class:…) must be written kebab-case — the
 *     runtime camelizes keys back into signal paths.
 *
 * Routes import the app-shaped helpers below; nothing else in the app may
 * construct SSE frames, classify Datastar requests, or trust raw markup.
 */

const DATASTAR_REQUEST_HEADER = 'Datastar-Request';
const SSE_CONTENT_TYPE = 'text/event-stream';

/** Exact case-sensitive header value the pinned runtime sends (`!0` → "true"). */
export function isDatastarRequest(request: Request): boolean {
  return request.headers.get(DATASTAR_REQUEST_HEADER)?.trim().toLowerCase() === 'true';
}

/**
 * Branch a route between its ordinary HTML/JSON contract and its enhanced
 * Datastar contract, and stamp `Vary: Datastar-Request` on whichever response
 * wins so caches never cross the two representations.
 */
export async function respondDual(
  request: Request,
  branches: {
    ordinary: () => Response | Promise<Response>;
    datastar: () => Response | Promise<Response>;
  },
): Promise<Response> {
  const response = await (isDatastarRequest(request) ? branches.datastar : branches.ordinary)();
  return withDatastarVary(response);
}

function withDatastarVary(response: Response): Response {
  const headers = new Headers(response.headers);
  const existing = headers.get('Vary');
  if (
    !existing
      ?.toLowerCase()
      .split(',')
      .map((v) => v.trim())
      .includes('datastar-request')
  ) {
    headers.set(
      'Vary',
      existing ? `${existing}, ${DATASTAR_REQUEST_HEADER}` : DATASTAR_REQUEST_HEADER,
    );
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/* ── Trusted server-rendered HTML ─────────────────────────────────────────── */

/**
 * Opaque wrapper for markup that may legally travel inside an SSE patch. The
 * only constructor path is {@link trustedHtmlFromRenderedResponse}; the private
 * field makes forged instances throw the moment their markup is read.
 */
const TRUST_TOKEN = Symbol('datastar.trusted-html');

export class TrustedHtml {
  readonly #markup: string;

  /** The token is module-private, so routes cannot mint their own instances. */
  constructor(token: symbol, markup: string) {
    if (token !== TRUST_TOKEN) {
      throw new DatastarProtocolError('TrustedHtml can only be minted by the Datastar boundary');
    }
    this.#markup = markup;
  }

  get markup(): string {
    return this.#markup;
  }
}

/**
 * Convert a freshly rendered `text/html` success Response into trusted markup.
 * The renderer (hono/jsx) has already escaped user values at this point; this
 * boundary — never a route — performs the trust conversion.
 */
export async function trustedHtmlFromRenderedResponse(response: Response): Promise<TrustedHtml> {
  const contentType = response.headers.get('Content-Type') ?? '';
  if (!contentType.includes('text/html')) {
    throw new DatastarProtocolError(
      `TrustedHtml requires a text/html response, got "${contentType || 'none'}"`,
    );
  }
  if (response.status >= 400) {
    throw new DatastarProtocolError(
      `TrustedHtml requires a success response, got status ${response.status}`,
    );
  }
  return new TrustedHtml(TRUST_TOKEN, await response.text());
}

/* ── Stable patch selectors ───────────────────────────────────────────────── */

declare const stableIdSelectorBrand: unique symbol;
export type StableIdSelector = string & { readonly [stableIdSelectorBrand]: 'StableIdSelector' };

/**
 * Build a `#id` patch selector from a server-owned stable ID. IDs must be safe
 * bare CSS identifiers (a UUID can start with a digit, which is why rows carry
 * a `todo-` prefix and why routes never interpolate raw values into selectors).
 */
export function selectorForId(id: string): StableIdSelector {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) {
    throw new DatastarProtocolError(`Refusing to build a patch selector from id "${id}"`);
  }
  return `#${id}` as StableIdSelector;
}

/* ── SSE event encoders ───────────────────────────────────────────────────── */

declare const sseEventBrand: unique symbol;
/** A complete, correctly framed SSE block. Only boundary encoders produce these. */
export type SseEvent = string & { readonly [sseEventBrand]: 'SseEvent' };

const PATCH_MODES = [
  'outer',
  'inner',
  'replace',
  'prepend',
  'append',
  'before',
  'after',
  'remove',
] as const;
export type PatchMode = (typeof PATCH_MODES)[number];

/**
 * C0/DEL control characters would let a crafted payload smuggle extra SSE
 * lines or fields into the framed response (`\r` terminates an SSE line just
 * like `\n`). Two exemptions: `\n` is the sanctioned multiline mechanism
 * (split into repeated data lines below), and `\t` is legal in SSE data and
 * meaningful inside rendered HTML — it cannot break framing.
 */
function hasFramingControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if ((code < 0x20 && code !== 0x0a && code !== 0x09) || code === 0x7f) return true;
  }
  return false;
}

function encodeEvent(name: string, data: ReadonlyArray<readonly [string, string]>): SseEvent {
  if (hasFramingControlChar(name)) {
    throw new DatastarProtocolError(`Refusing to frame an SSE event named "${name}"`);
  }
  const lines = [`event: ${name}`];
  for (const [key, value] of data) {
    if (hasFramingControlChar(key)) {
      throw new DatastarProtocolError(`Refusing to frame an SSE field named "${key}"`);
    }
    // Repeated keys are joined with "\n" by the runtime, so multiline values
    // travel as repeated `data: <key>` lines — never as raw embedded newlines.
    for (const line of value.split('\n')) {
      if (hasFramingControlChar(line)) {
        throw new DatastarProtocolError(
          `Refusing to frame an SSE field "${key}" containing a control character`,
        );
      }
      lines.push(`data: ${key} ${line}`);
    }
  }
  return `${lines.join('\n')}\n\n` as SseEvent;
}

/** Patch trusted markup relative to a stable server-owned target. */
export function patchElementsEvent(
  html: TrustedHtml,
  options: { selector: StableIdSelector; mode: PatchMode },
): SseEvent {
  if (!PATCH_MODES.includes(options.mode)) {
    throw new DatastarProtocolError(`Unknown patch mode "${options.mode}"`);
  }
  return encodeEvent('datastar-patch-elements', [
    ['selector', options.selector],
    ['mode', options.mode],
    ['elements', html.markup],
  ]);
}

/** Remove the element owning a stable ID (no markup payload). */
export function removeElementEvent(selector: StableIdSelector): SseEvent {
  return encodeEvent('datastar-patch-elements', [
    ['selector', selector],
    ['mode', 'remove'],
  ]);
}

/**
 * Merge a signals patch. Nested objects merge key-by-key and absent siblings
 * are untouched.
 *
 * Runtime-verified constraint (v1.0.2): a null value DELETES the key, and
 * deleting a signal cell orphans the effects subscribed to it — a later
 * re-create does not revive them. Never clear displayable values with null;
 * write an empty value (`''`) instead.
 */
export function patchSignalsEvent(patch: Record<string, unknown>): SseEvent {
  return encodeEvent('datastar-patch-signals', [['signals', JSON.stringify(patch)]]);
}

/** Wrap one or more encoded events in the fixed-policy SSE response. */
export function sseResponse(events: SseEvent | readonly SseEvent[]): Response {
  const body = typeof events === 'string' ? events : events.join('');
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': SSE_CONTENT_TYPE,
      'Cache-Control': 'no-cache',
      Vary: DATASTAR_REQUEST_HEADER,
    },
  });
}

export class DatastarProtocolError extends Error {
  override readonly name = 'DatastarProtocolError';
}
