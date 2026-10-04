import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { fileCrypto, getKek, wrapDek, unwrapDek } from '../src/crypto/fileCrypto';

describe('Envelope Encryption at Rest Tests (Spec §7.10)', () => {
  const samplePlaintext = Buffer.from('Privora Top-Secret Encrypted Data Payload 2026!');

  it('successfully encrypts and decrypts (round trip integrity)', async () => {
    const encrypted = await fileCrypto.encrypt(samplePlaintext);

    expect(encrypted.ciphertext).not.toEqual(samplePlaintext);
    expect(encrypted.iv.length).toBe(12);
    expect(encrypted.tag.length).toBe(16);
    expect(encrypted.dekWrapped.length).toBe(60);
    expect(encrypted.kekVersion).toBeGreaterThanOrEqual(1);

    const decrypted = await fileCrypto.decrypt({
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      tag: encrypted.tag,
      dekWrapped: encrypted.dekWrapped,
      kekVersion: encrypted.kekVersion,
    });

    expect(decrypted).toEqual(samplePlaintext);
  });

  it('rejects tampered ciphertext (bit-flip in encrypted payload)', async () => {
    const encrypted = await fileCrypto.encrypt(samplePlaintext);

    // Tamper with the ciphertext: flip the first byte
    const tamperedCiphertext = Buffer.from(encrypted.ciphertext);
    tamperedCiphertext[0] ^= 0xff;

    await expect(
      fileCrypto.decrypt({
        ciphertext: tamperedCiphertext,
        iv: encrypted.iv,
        tag: encrypted.tag,
        dekWrapped: encrypted.dekWrapped,
        kekVersion: encrypted.kekVersion,
      })
    ).rejects.toThrow(/integrity|corrupted|tampered/i);
  });

  it('rejects tampered authentication tag', async () => {
    const encrypted = await fileCrypto.encrypt(samplePlaintext);

    // Tamper with the authentication tag
    const tamperedTag = Buffer.from(encrypted.tag);
    tamperedTag[0] ^= 0x01;

    await expect(
      fileCrypto.decrypt({
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        tag: tamperedTag,
        dekWrapped: encrypted.dekWrapped,
        kekVersion: encrypted.kekVersion,
      })
    ).rejects.toThrow(/integrity|corrupted|tampered/i);
  });

  it('rejects decryption when wrong KEK is used to unwrap DEK', async () => {
    const encrypted = await fileCrypto.encrypt(samplePlaintext);

    // Fake a KEK version 2 with a different key
    const differentKek = crypto.randomBytes(32).toString('base64');
    process.env.FILE_KEK_V2 = differentKek;

    await expect(
      fileCrypto.decrypt({
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        tag: encrypted.tag,
        dekWrapped: encrypted.dekWrapped,
        kekVersion: 2, // Points to different KEK
      })
    ).rejects.toThrow(/unwrap|corrupted|failed/i);

    delete process.env.FILE_KEK_V2;
  });

  it('generates unique IVs and DEKs on every encryption call', async () => {
    const enc1 = await fileCrypto.encrypt(samplePlaintext);
    const enc2 = await fileCrypto.encrypt(samplePlaintext);

    // Even with identical plaintext, IV and ciphertext must be distinct
    expect(enc1.iv).not.toEqual(enc2.iv);
    expect(enc1.ciphertext).not.toEqual(enc2.ciphertext);
    expect(enc1.dekWrapped).not.toEqual(enc2.dekWrapped);
  });

  it('DEK wrap and unwrap unit tests work directly with custom KEK', () => {
    const testKek = crypto.randomBytes(32);
    const testDek = crypto.randomBytes(32);

    const wrapped = wrapDek(testDek, testKek);
    expect(wrapped.length).toBe(60);

    const unwrapped = unwrapDek(wrapped, testKek);
    expect(unwrapped).toEqual(testDek);

    // Tampered wrapped DEK fails
    const tamperedWrapped = Buffer.from(wrapped);
    tamperedWrapped[15] ^= 0xaa;
    expect(() => unwrapDek(tamperedWrapped, testKek)).toThrow();
  });
});
