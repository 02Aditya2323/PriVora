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
 * DEV-ONLY ENCRYPTION PASSTHROUGH STUB
 * ====================================
 * WARNING: This is a placeholder created by Part 1 for development and integration.
 * Part 3 will replace this with full AES-256-GCM envelope encryption (per-file DEK wrapped by KEK).
 */
export const fileCrypto = {
  encrypt: async (buf: Buffer): Promise<EncryptedFileResult> => {
    logger.warn('[DEV CRYPTO STUB] fileCrypto.encrypt called - passthrough active (Part 3 will replace with AES-256-GCM envelope)');
    return {
      ciphertext: buf,
      iv: Buffer.alloc(12, 0), // 96-bit zero IV for stub
      tag: Buffer.alloc(16, 0), // 128-bit zero tag for stub
      dekWrapped: Buffer.alloc(32, 0), // 256-bit zero wrapped DEK for stub
      kekVersion: 1,
    };
  },

  decrypt: async (params: DecryptFileParams): Promise<Buffer> => {
    logger.warn('[DEV CRYPTO STUB] fileCrypto.decrypt called - passthrough active (Part 3 will replace with AES-256-GCM tag verification)');
    return params.ciphertext;
  },
};
