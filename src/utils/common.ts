import { sValidator } from '@hono/standard-validator';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import * as v from 'valibot';
import { patchSignalsEvent, respondDual, sseResponse } from './datastar';

type Errors = Record<string, { message: string }>;

function getIssueField(issue: StandardSchemaV1.Issue): string | undefined {
  const dotPath = v.getDotPath(issue as Parameters<typeof v.getDotPath>[0]);
  return dotPath?.split('.')[0];
}

/**
 * Validator with a dual error contract:
 *
 * - ordinary requests keep the plain `400` JSON error body;
 * - Datastar requests get a recoverable `200` SSE signal patch (the runtime
 *   treats any 4xx as a fetch error, so user-fixable feedback must be a 200
 *   patch) setting `<group>.errors.<field>` message strings. Fields not in
 *   the current error set are written as `''` — clearing via null would
 *   delete the signal cell and orphan the effects watching it.
 */
export function schemaValidator<
  Target extends 'form' | 'json' | 'query' | 'param',
  T extends StandardSchemaV1,
>(target: Target, schema: T, options?: { signalsGroup?: string; fields?: readonly string[] }) {
  return sValidator(target, schema, (result, c) => {
    if (result.success) return;

    const errors: Errors = {};
    for (const issue of result.error) {
      const field = getIssueField(issue) ?? '_root';
      errors[field] = { message: issue.message };
    }

    const signalsGroup = options?.signalsGroup;
    return respondDual(c.req.raw, {
      ordinary: () => c.json(errors, 400),
      datastar: () => {
        if (!signalsGroup) return c.json(errors, 400);
        const fieldMessages: Record<string, string> = {};
        for (const field of options?.fields ?? []) fieldMessages[field] = '';
        for (const [field, { message }] of Object.entries(errors)) fieldMessages[field] = message;
        return sseResponse(patchSignalsEvent({ [signalsGroup]: { errors: fieldMessages } }));
      },
    });
  });
}
