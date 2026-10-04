import { describe, it, expect } from 'vitest';
import { validateStorageKey, getPrefixedStoragePath } from '../src/storage/StorageAdapter';
import { storage } from '../src/storage/S3Adapter';

describe('Storage Key Validation & Path Traversal Prevention (Spec §7.8)', () => {
  const validUuid = '123e4567-e89b-42d3-a456-426614174000';

  it('Accepts strictly formatted UUIDv4 storage keys', () => {
    expect(validateStorageKey(validUuid)).toBe(validUuid);
    expect(getPrefixedStoragePath(validUuid)).toBe(`files/${validUuid}`);
  });

  it('Rejects directory traversal sequences (../, ../../etc/passwd)', () => {
    expect(() => validateStorageKey('../../etc/passwd')).toThrow(/invalid characters or traversal sequences/i);
    expect(() => validateStorageKey('../files/secret.txt')).toThrow(/invalid characters or traversal sequences/i);
    expect(() => validateStorageKey('..\\windows\\system32')).toThrow(/invalid characters or traversal sequences/i);
  });

  it('Rejects keys containing path separators or null bytes', () => {
    expect(() => validateStorageKey('/absolute/path')).toThrow(/invalid characters or traversal sequences/i);
    expect(() => validateStorageKey(`valid-${validUuid}\0`)).toThrow(/invalid characters or traversal sequences/i);
  });

  it('Rejects arbitrary non-UUID strings', () => {
    expect(() => validateStorageKey('my-custom-file-key')).toThrow(/strict UUIDv4/i);
    expect(() => validateStorageKey('12345')).toThrow(/strict UUIDv4/i);
    expect(() => validateStorageKey('')).toThrow(/non-empty string/i);
  });

  it('StorageAdapter refuses to call S3 with an invalid key', async () => {
    await expect(storage.getObject('../../etc/passwd')).rejects.toThrow(/invalid characters or traversal sequences/i);
    await expect(storage.putObject('invalid-key', Buffer.from('data'))).rejects.toThrow(/strict UUIDv4/i);
    await expect(storage.deleteObject('invalid-key')).rejects.toThrow(/strict UUIDv4/i);
  });

  it('StorageAdapter can put, get, and delete using a valid UUID key', async () => {
    const testData = Buffer.from('Privora secure storage integrity check');
    await storage.putObject(validUuid, testData);

    const retrieved = await storage.getObject(validUuid);
    expect(retrieved).toEqual(testData);

    await storage.deleteObject(validUuid);
  });
});
