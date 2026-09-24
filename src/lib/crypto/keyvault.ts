import 'server-only';
import crypto from 'node:crypto';

/**
 * AES-256-GCM vault for user-supplied provider API keys.
 *
 * Design notes, because getting this wrong is expensive for the user:
 *
 *  - The master key lives ONLY in the server environment
 *    (FLOWCARE_KEY_ENCRYPTION_SECRET). It is never written to the database,
 *    so a database dump on its own yields nothing usable.
 *  - GCM gives authenticated encryption: a tampered ciphertext fails to
 *    decrypt rather than silently producing garbage that we then send to a
 *    provider.
 *  - A fresh 12-byte IV per encryption. Never reused, never derived from the
 *    plaintext.
 *  - If the secret is absent or too weak we REFUSE to encrypt. Storing a key
 *    under a predictable secret is worse than not storing it, because the user
 *    believes it is protected.
 */

const MIN_SECRET_CHARS = 32;

export class VaultUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultUnavailableError';
  }
}

function masterKey(): Buffer {
  const raw = process.env.FLOWCARE_KEY_ENCRYPTION_SECRET?.trim();
  if (!raw) {
    throw new VaultUnavailableError(
      'Saving keys is turned off because FLOWCARE_KEY_ENCRYPTION_SECRET is not set on the server.',
    );
  }
  if (raw.length < MIN_SECRET_CHARS) {
    throw new VaultUnavailableError(
      `FLOWCARE_KEY_ENCRYPTION_SECRET must be at least ${MIN_SECRET_CHARS} characters.`,
    );
  }
  // Accept either 64 hex chars (exactly 32 bytes) or any sufficiently long
  // passphrase, which we stretch to 32 bytes.
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

/** True when the server is configured to store keys at all. */
export function vaultAvailable(): boolean {
  try {
    masterKey();
    return true;
  } catch {
    return false;
  }
}

/** base64( iv(12) || authTag(16) || ciphertext ) */
export function encryptSecret(plaintext: string): string {
  if (!plaintext || plaintext.trim().length === 0) {
    throw new Error('Nothing to encrypt.');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext.trim(), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

export function decryptSecret(payload: string): string {
  const buf = Buffer.from(payload, 'base64');
  if (buf.length < 12 + 16 + 1) throw new Error('Stored key is malformed.');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/**
 * The only representation of a key that may ever reach a browser.
 * "sk-proj-abc123def456" -> "f456"
 */
export function keyHint(plaintext: string): string {
  const cleaned = plaintext.trim().replace(/[^A-Za-z0-9_-]/g, '');
  return cleaned.slice(-4) || 'key';
}

/** Display form, e.g. "••••••••f456". Never reconstructs the key. */
export function maskedKey(hint: string): string {
  return `${'•'.repeat(8)}${hint}`;
}

/**
 * Cheap shape check before we spend a network round trip. Deliberately
 * permissive: providers change prefixes, and rejecting a valid key because we
 * did not recognise its shape is worse than attempting one doomed call.
 */
export function looksLikeKey(provider: string, value: string): { ok: true } | { ok: false; reason: string } {
  const v = value.trim();
  // Check the SPECIFIC paste error before the generic whitespace rule, or the
  // user gets "no spaces allowed" when the actionable message is "drop the
  // word Bearer". Order matters for diagnosability.
  if (/^bearer\s/i.test(value.trim())) {
    return { ok: false, reason: 'Paste only the key itself, without the word "Bearer".' };
  }
  if (v.length < 12) return { ok: false, reason: 'That key looks too short.' };
  if (v.length > 400) return { ok: false, reason: 'That key looks too long.' };
  if (/\s/.test(v)) return { ok: false, reason: 'A key should not contain spaces.' };
  if (provider === 'openai' && !/^sk-/.test(v)) {
    return { ok: false, reason: 'OpenAI keys normally begin with "sk-".' };
  }
  if (provider === 'groq' && !/^gsk_/.test(v)) {
    return { ok: false, reason: 'Groq keys normally begin with "gsk_".' };
  }
  return { ok: true };
}
