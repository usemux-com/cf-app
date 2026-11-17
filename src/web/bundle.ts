/// <reference lib="dom" />

/**
 * Synchronous duplicate-submit lock for Datastar-enhanced mutation forms.
 *
 * Reactive pending state (data-indicator → disabled button) updates the DOM
 * asynchronously, so a fast second click can still fire a second submit before
 * the button disables. This delegated capture-phase lock rejects any submit
 * while a fetch owns the form; it runs before the runtime's bubble-phase
 * submit handler, so the blocked submit never becomes a request.
 *
 * No initialization ordering hazards: this module only listens for user-
 * triggered events and the runtime's document-level `datastar-fetch` lifecycle
 * events, both of which happen long after module evaluation.
 */

type FetchEventDetail = { type: string; el: Element };

const inFlight = new WeakSet<HTMLFormElement>();
const fetchStarted = new WeakSet<HTMLFormElement>();

document.addEventListener(
  'submit',
  (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.hasAttribute('data-lock')) return;

    if (inFlight.has(form)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    inFlight.add(form);
    // Native constraint validation can stop the action before any fetch
    // starts (no `started` event this task); never leave the form locked then.
    setTimeout(() => {
      if (!fetchStarted.has(form)) inFlight.delete(form);
    }, 0);
  },
  true,
);

document.addEventListener('datastar-fetch', (event) => {
  const { type, el } = (event as CustomEvent<FetchEventDetail>).detail;
  const form =
    el instanceof HTMLFormElement ? el : ((el as Element | null)?.closest?.('form') ?? null);
  if (!(form instanceof HTMLFormElement)) return;

  if (type === 'started') {
    fetchStarted.add(form);
    return;
  }
  if (type === 'finished' || type === 'error' || type === 'retries-failed') {
    inFlight.delete(form);
    fetchStarted.delete(form);
  }
});
