import crypto from 'crypto';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

export interface EncryptedFileResult {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  dekWrapped: Buffer;
  kekVersion: number;
}

export interface DecryptFileParams {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  dekWrapped: Buffer;
  kekVersion: number;
}

/**
 * Retrieves the Key-Encryption-Key (KEK) for a specific version.
 * Loaded from environment variables (e.g. FILE_KEK_V1, FILE_KEK_V2).
 */
export function getKek(version: number): Buffer {
  const envVarName = `FILE_KEK_V${version}`;
  const keyBase64 = process.env[envVarName] || (version === 1 ? env.FILE_KEK_V1 : undefined);

  if (!keyBase64) {
    throw AppError.internal(`KEK version ${version} is not configured (${envVarName} missing)`, 'KEK_NOT_FOUND');
  }

  try {
    const kek = Buffer.from(keyBase64, 'base64');
    if (kek.length !== 32) {
      throw new Error(`Invalid length: ${kek.length} bytes`);
    }
    return kek;
  } catch {
    throw AppError.internal(`KEK version ${version} is invalid: must be 32 base64 bytes`, 'INVALID_KEK');
  }
}

/**
 * Wraps a Data Encryption Key (DEK) using AES-256-GCM with the specified KEK.
 * Returns Buffer containing: [12-byte IV] + [32-byte ciphertext] + [16-byte tag] = 60 bytes.
 */
export function wrapDek(dek: Buffer, kek: Buffer): Buffer {
  const iv = crypto.randomBytes(12); // 96-bit IV
  const cipher = crypto.createCipheriv('aes-256-gcm', kek, iv);
  const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, ciphertext, tag]);
}

/**
 * Unwraps a Data Encryption Key (DEK) using AES-256-GCM with the specified KEK.
 */
export function unwrapDek(wrappedDek: Buffer, kek: Buffer): Buffer {
  if (wrappedDek.length !== 60) {
    throw AppError.internal('Invalid wrapped DEK structure', 'INVALID_DEK');
  }

  const iv = wrappedDek.subarray(0, 12);
  const ciphertext = wrappedDek.subarray(12, 44);
  const tag = wrappedDek.subarray(44, 60);

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', kek, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (err: any) {
    logger.error({ err }, '[CRYPTO] Failed to unwrap DEK (wrong KEK or tampered wrapped key)');
    throw AppError.internal('Failed to unwrap DEK: wrong KEK or corrupted key material', 'DEK_UNWRAP_FAILED');
  }
}

/**
 * ENVELOPE ENCRYPTION AT REST (Spec §7.10)
 * =======================================
 * 1. Generates a per-file 256-bit random DEK (Data Encryption Key).
 * 2. Encrypts the file payload using AES-256-GCM with a random 96-bit IV.
 * 3. Wraps the DEK using the active KEK (Key Encryption Key) configured by version.
 * 4. Verifies authentication tags before returning decrypted plaintext.
 */
export const fileCrypto = {
  /**
   * Encrypts plaintext file buffer using AES-256-GCM envelope encryption.
   */
  encrypt: async (plaintext: Buffer): Promise<EncryptedFileResult> => {
    const currentKekVersion = env.FILE_KEK_CURRENT_VERSION;
    const kek = getKek(currentKekVersion);

    // 1. Generate 256-bit CSPRNG Data Encryption Key (DEK)
    const dek = crypto.randomBytes(32);

    // 2. Generate 96-bit CSPRNG IV for file encryption
    const fileIv = crypto.randomBytes(12);

    // 3. Encrypt file with AES-256-GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', dek, fileIv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const fileTag = cipher.getAuthTag();

    // 4. Wrap the DEK with KEK
    const dekWrapped = wrapDek(dek, kek);

    // 5. Zero out plaintext DEK in memory for defense-in-depth
    dek.fill(0);

    return {
      ciphertext,
      iv: fileIv,
      tag: fileTag,
      dekWrapped,
      kekVersion: currentKekVersion,
    };
  },

  /**
   * Decrypts ciphertext and strictly verifies AES-256-GCM integrity tag.
   * Throws if ciphertext or tag was tampered with, or if wrong KEK is used.
   */
  decrypt: async (params: DecryptFileParams): Promise<Buffer> => {
    const { ciphertext, iv, tag, dekWrapped, kekVersion } = params;

    // 1. Fetch KEK for the file's recorded version
    const kek = getKek(kekVersion);

    // 2. Unwrap the per-file DEK
    const dek = unwrapDek(dekWrapped, kek);

    try {
      // 3. Decrypt file payload with DEK and verify GCM authentication tag
      const decipher = crypto.createDecipheriv('aes-256-gcm', dek, iv);
      decipher.setAuthTag(tag);

      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

      return plaintext;
    } catch (err: any) {
      logger.error({ err }, '[CRYPTO] File decryption failed: tag mismatch or tampered ciphertext');
      throw AppError.badRequest(
        'File integrity verification failed: ciphertext is corrupted or was tampered with',
        'INTEGRITY_CHECK_FAILED'
      );
    } finally {
      // Zero out unwrapped DEK
      dek.fill(0);
    }
  },
};
