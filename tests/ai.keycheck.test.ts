import { describe, expect, it } from 'vitest';
import { classifyProviderError, type KeyCheckStatus } from '@/lib/ai/userKeys';

/**
 * Key-check error classification.
 *
 * The bug these exist to prevent: a working key reported as broken. The
 * validator used to require the model's reply to parse as JSON, so a chatty
 * model returning `Sure! {"ok":true}` threw a SyntaxError, fell through the
 * provider matcher, and surfaced as "Could not reach the provider" — on a
 * request that had reached the provider and been answered.
 *
 * Two rules come out of that, and both are asserted here:
 *
 *   1. authentication is proven by the provider ANSWERING, not by the model
 *      obeying a formatting instruction;
 *   2. only a genuine rejection may be called invalid_key. Everything else
 *      is a different problem with a different fix.
 */
const cases: [string, KeyCheckStatus][] = [
  ['provider_http_401', 'invalid_key'],
  ['provider_http_403', 'invalid_key'],
  ['provider_http_429', 'rate_limited'],
  ['provider_http_404', 'model_unavailable'],
  ['provider_http_500', 'provider_unavailable'],
  ['provider_http_503', 'provider_unavailable'],
  ['provider_not_configured', 'configuration_error'],
  ['provider_bad_shape', 'configuration_error'],
];

describe('provider error classification', () => {
  it.each(cases)('maps %s to %s', (thrown, expected) => {
    expect(classifyProviderError(new Error(thrown)).status).toBe(expected);
  });

  it('treats a timeout as the provider being unavailable, not a bad key', () => {
    for (const m of ['The operation was aborted', 'ETIMEDOUT', 'request timeout']) {
      expect(classifyProviderError(new Error(m)).status).toBe('provider_unavailable');
    }
  });

  it('never blames the key for a JSON parse failure', () => {
    // The exact regression. A SyntaxError means the model was chatty; it
    // says nothing whatsoever about whether the key authenticated.
    const e = new SyntaxError('Unexpected token S in JSON at position 0');
    const { status } = classifyProviderError(e);
    expect(status).not.toBe('invalid_key');
    expect(status).toBe('provider_unavailable');
  });

  it('never blames the key for an unrecognised failure', () => {
    expect(classifyProviderError(new Error('ECONNRESET')).status).not.toBe('invalid_key');
    expect(classifyProviderError('something odd').status).not.toBe('invalid_key');
  });

  it('distinguishes rate limiting from rejection', () => {
    // Being out of quota is the clearest case of a VALID key that cannot
    // be used right now. Reporting it as invalid would send someone off to
    // regenerate a key that was never the problem.
    const limited = classifyProviderError(new Error('provider_http_429'));
    expect(limited.status).toBe('rate_limited');
    expect(limited.message).toMatch(/key itself looks fine/i);
  });

  it('distinguishes a bad model name from a bad key', () => {
    const m = classifyProviderError(new Error('provider_http_404'));
    expect(m.status).toBe('model_unavailable');
    expect(m.message).toMatch(/model/i);
  });

  it('leaks nothing from the provider error into the message', () => {
    // Provider error bodies can echo request headers, and the key travels
    // in those. Only our own wording may reach the client.
    const leaky = new Error(
      'provider_http_401 {"error":{"message":"Incorrect API key provided: sk-live-abcd1234secret"}}',
    );
    const { message } = classifyProviderError(leaky);
    expect(message).not.toMatch(/sk-live|abcd1234|secret/);
    expect(message).toMatch(/rejected this key/i);
  });

  it('covers every status it can return', () => {
    const produced = new Set<KeyCheckStatus>(
      cases.map(([thrown]) => classifyProviderError(new Error(thrown)).status),
    );
    // 'working' is not reachable from an error path, by definition.
    expect(produced).toEqual(
      new Set<KeyCheckStatus>([
        'invalid_key', 'rate_limited', 'model_unavailable',
        'provider_unavailable', 'configuration_error',
      ]),
    );
  });
});
