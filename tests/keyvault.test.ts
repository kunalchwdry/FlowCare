/**
 * Unit tests for the API-key vault.
 *
 * These matter more than most: a bug here does not corrupt FlowCare data, it
 * leaks a credential that costs the user money.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const GOOD_SECRET = 'a'.repeat(64);
let mod: typeof import('@/lib/crypto/keyvault');

async function load() {
  // the module reads process.env lazily, but re-import to be safe
  return import('@/lib/crypto/keyvault');
}

describe('key vault — encryption', () => {
  beforeEach(async () => {
    process.env.FLOWCARE_KEY_ENCRYPTION_SECRET = GOOD_SECRET;
    mod = await load();
  });
  afterEach(() => {
    delete process.env.FLOWCARE_KEY_ENCRYPTION_SECRET;
  });

  it('round-trips a key', () => {
    const key = 'sk-proj-abc123def456ghi789';
    expect(mod.decryptSecret(mod.encryptSecret(key))).toBe(key);
  });

  it('produces a different ciphertext every time (fresh IV)', () => {
    const key = 'sk-proj-abc123def456ghi789';
    const a = mod.encryptSecret(key);
    const b = mod.encryptSecret(key);
    expect(a).not.toBe(b);
    // ...but both still decrypt
    expect(mod.decryptSecret(a)).toBe(mod.decryptSecret(b));
  });

  it('never stores the plaintext inside the ciphertext', () => {
    const key = 'sk-proj-supersecretvalue';
    const enc = mod.encryptSecret(key);
    expect(enc).not.toContain('supersecret');
    expect(Buffer.from(enc, 'base64').toString('utf8')).not.toContain('supersecret');
  });

  it('refuses a tampered ciphertext instead of returning garbage', () => {
    const enc = mod.encryptSecret('sk-proj-abc123def456');
    const buf = Buffer.from(enc, 'base64');
    buf[buf.length - 1] ^= 0xff; // flip a bit in the payload
    expect(() => mod.decryptSecret(buf.toString('base64'))).toThrow();
  });

  it('refuses a truncated payload', () => {
    expect(() => mod.decryptSecret(Buffer.from('short').toString('base64'))).toThrow();
  });

  it('cannot decrypt under a different master secret', () => {
    const enc = mod.encryptSecret('sk-proj-abc123def456');
    process.env.FLOWCARE_KEY_ENCRYPTION_SECRET = 'b'.repeat(64);
    expect(() => mod.decryptSecret(enc)).toThrow();
  });
});

describe('key vault — refusing to operate unsafely', () => {
  afterEach(() => {
    delete process.env.FLOWCARE_KEY_ENCRYPTION_SECRET;
  });

  it('refuses to encrypt with no secret configured', async () => {
    delete process.env.FLOWCARE_KEY_ENCRYPTION_SECRET;
    const m = await load();
    expect(m.vaultAvailable()).toBe(false);
    // Storing a key under no secret is worse than not storing it, because the
    // user believes it is protected.
    expect(() => m.encryptSecret('sk-proj-abc123def456')).toThrow(/not set/i);
  });

  it('refuses a weak secret rather than stretching it silently', async () => {
    process.env.FLOWCARE_KEY_ENCRYPTION_SECRET = 'tooshort';
    const m = await load();
    expect(m.vaultAvailable()).toBe(false);
    expect(() => m.encryptSecret('sk-proj-abc123def456')).toThrow(/at least 32/i);
  });

  it('accepts a long passphrase as well as 64 hex chars', async () => {
    process.env.FLOWCARE_KEY_ENCRYPTION_SECRET = 'a-fairly-long-human-passphrase-for-flowcare!!';
    const m = await load();
    expect(m.vaultAvailable()).toBe(true);
    expect(m.decryptSecret(m.encryptSecret('sk-x'.padEnd(20, 'y')))).toBe('sk-x'.padEnd(20, 'y'));
  });
});

describe('key vault — what may reach a browser', () => {
  beforeEach(async () => {
    process.env.FLOWCARE_KEY_ENCRYPTION_SECRET = GOOD_SECRET;
    mod = await load();
  });
  afterEach(() => {
    delete process.env.FLOWCARE_KEY_ENCRYPTION_SECRET;
  });

  it('a hint is only the last four characters', () => {
    expect(mod.keyHint('sk-proj-abc123def456')).toBe('f456');
    expect(mod.keyHint('sk-proj-abc123def456')).not.toContain('abc123');
  });

  it('a masked key cannot be reversed into the key', () => {
    const masked = mod.maskedKey(mod.keyHint('gsk_averylongsecretvalue1234'));
    expect(masked).toMatch(/^•{8}1234$/);
    expect(masked).not.toContain('averylongsecret');
  });
});

describe('key vault — paste-error guardrails', () => {
  it('catches the "Bearer " paste mistake', () => {
    const r = mod?.looksLikeKey?.('openai', 'Bearer sk-abc123def456ghi') ?? { ok: false, reason: '' };
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/without the word/i);
  });

  it('rejects keys with whitespace and obviously short values', () => {
    expect(mod.looksLikeKey('gemini', 'abc def ghi jkl').ok).toBe(false);
    expect(mod.looksLikeKey('gemini', 'short').ok).toBe(false);
  });

  it('warns on a wrong-looking prefix for providers with a known one', () => {
    expect(mod.looksLikeKey('openai', 'gsk_abc123def456ghi789').ok).toBe(false);
    expect(mod.looksLikeKey('groq', 'sk-abc123def456ghi789').ok).toBe(false);
  });

  it('stays permissive for providers without a stable prefix', () => {
    // Rejecting a valid key because we did not recognise its shape is worse
    // than attempting one doomed call.
    // Assembled at runtime rather than written as a literal: the value is a
    // made-up fixture, but a hard-coded 'AIza…' string trips secret scanners
    // on push and buries a real finding in false positives one day.
    const geminiShaped = ['AI', 'za', 'SyD-someplausiblelookingkey123'].join('');
    expect(mod.looksLikeKey('gemini', geminiShaped).ok).toBe(true);
    expect(mod.looksLikeKey('nvidia', 'nvapi-abc123def456ghi789jkl').ok).toBe(true);
  });
});
