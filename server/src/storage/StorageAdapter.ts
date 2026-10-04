// UUIDv4 strict validation regex (8-4-4-4-12 hex chars)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface StorageAdapter {
  putObject(key: string, data: Buffer, contentType?: string): Promise<void>;
  getObject(key: string): Promise<Buffer>;
  deleteObject(key: string): Promise<void>;
  ensureBucket(): Promise<void>;
}

/**
 * Validates that an object storage key is strictly a valid UUID.
 * Defense against path traversal and object key injection.
 */
export function validateStorageKey(key: string): string {
  if (!key || typeof key !== 'string') {
    throw new Error('Storage key must be a non-empty string');
  }

  // Reject path separators, directory traversal sequences, and control chars
  if (key.includes('..') || key.includes('/') || key.includes('\\') || key.includes('\0')) {
    throw new Error('Storage key contains invalid characters or traversal sequences');
  }

  if (!UUID_REGEX.test(key)) {
    throw new Error(`Invalid storage key format: must be a strict UUIDv4, received "${key}"`);
  }

  return key;
}

/**
 * Formats a validated UUID into the isolated storage prefix 'files/<uuid>'
 */
export function getPrefixedStoragePath(key: string): string {
  const validKey = validateStorageKey(key);
  return `files/${validKey}`;
}
