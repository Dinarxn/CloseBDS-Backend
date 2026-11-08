import crypto from 'node:crypto';

export interface EncryptedCredentialPayload {
  ciphertext: string;
  iv: string;
  tag: string;
  keyVersion: number;
  algorithm: 'aes-256-gcm';
}

const DEFAULT_DEV_ENCRYPTION_SECRET = 'closevds-default-development-encryption-secret-key-32b';
const CURRENT_KEY_VERSION = 1;

/**
 * Derives a 32-byte cryptographic key from the configured secret or workspace master secret.
 */
function deriveKey(secret?: string): Buffer {
  const masterSecret =
    secret ||
    process.env.CALLING_ENCRYPTION_KEY ||
    process.env.ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    DEFAULT_DEV_ENCRYPTION_SECRET;

  return crypto.scryptSync(masterSecret, 'closevds-calling-salt-v1', 32);
}

/**
 * Server-side authenticated encryption using AES-256-GCM.
 * Protects credentials at rest before persisting in the database.
 */
export function encryptCredential(
  plaintext: string,
  customSecret?: string
): EncryptedCredentialPayload {
  if (!plaintext || typeof plaintext !== 'string') {
    throw new Error('Plaintext credential string must be non-empty');
  }

  const key = deriveKey(customSecret);
  const iv = crypto.randomBytes(12); // Standard 96-bit IV for AES-GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  return {
    ciphertext,
    iv: iv.toString('hex'),
    tag,
    keyVersion: CURRENT_KEY_VERSION,
    algorithm: 'aes-256-gcm',
  };
}

/**
 * Decrypts and verifies authenticated ciphertext using AES-256-GCM.
 */
export function decryptCredential(
  payload: EncryptedCredentialPayload,
  customSecret?: string
): string {
  if (!payload || !payload.ciphertext || !payload.iv || !payload.tag) {
    throw new Error('Invalid encrypted credential payload: missing ciphertext, iv, or tag');
  }

  const key = deriveKey(customSecret);
  const iv = Buffer.from(payload.iv, 'hex');
  const tag = Buffer.from(payload.tag, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(payload.ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Masks an API key for safe client display (e.g., "key_live_...1234" or "••••••••1234").
 */
export function maskApiKey(apiKey: string): string {
  if (!apiKey || typeof apiKey !== 'string') return '';
  const trimmed = apiKey.trim();
  if (trimmed.length <= 8) {
    return '••••••••';
  }

  const prefix = trimmed.slice(0, Math.min(trimmed.indexOf('_') > 0 ? trimmed.indexOf('_') + 1 : 4, 8));
  const suffix = trimmed.slice(-4);
  return `${prefix}...${suffix}`;
}

/**
 * Masks a Twilio Account SID (e.g. "AC...9876").
 */
export function maskTwilioSid(sid: string): string {
  if (!sid || typeof sid !== 'string') return '';
  const trimmed = sid.trim();
  if (!trimmed.startsWith('AC') || trimmed.length < 8) {
    return 'AC••••••••';
  }
  return `AC...${trimmed.slice(-4)}`;
}

/**
 * Masks arbitrary secret strings (e.g. auth tokens, webhook secrets).
 */
export function maskSecret(secret: string): string {
  if (!secret || typeof secret !== 'string') return '';
  const trimmed = secret.trim();
  if (trimmed.length <= 6) return '••••••';
  return `••••••••••••${trimmed.slice(-4)}`;
}

/**
 * Masks a phone number (e.g. "+15125550199" -> "+1 (•••) •••-0199").
 */
export function maskPhoneNumber(phone: string): string {
  if (!phone || typeof phone !== 'string') return '';
  const trimmed = phone.trim();
  if (trimmed.length < 7) return '••••••••';
  const lastFour = trimmed.slice(-4);
  const countryPrefix = trimmed.startsWith('+') ? trimmed.slice(0, 2) : '';
  return countryPrefix ? `${countryPrefix}••••••${lastFour}` : `••••••${lastFour}`;
}

/**
 * Masks all credential fields for a given provider, guaranteeing no raw secret is exposed.
 */
export function maskProviderCredentials(
  provider: string,
  credentials: Record<string, unknown>
): Record<string, string> {
  const masked: Record<string, string> = {};
  const prov = provider.toLowerCase();

  for (const [key, val] of Object.entries(credentials)) {
    if (typeof val !== 'string' || !val) {
      continue;
    }

    const lowerKey = key.toLowerCase();
    if (prov === 'twilio' && lowerKey.includes('accountsid')) {
      masked[key] = maskTwilioSid(val);
    } else if (lowerKey.includes('phone')) {
      masked[key] = maskPhoneNumber(val);
    } else if (lowerKey.includes('key') || lowerKey.includes('token') || lowerKey.includes('secret')) {
      masked[key] = maskApiKey(val);
    } else {
      masked[key] = maskSecret(val);
    }
  }

  return masked;
}
