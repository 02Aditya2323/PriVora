import crypto from 'crypto';
import { db } from '../../db/pool';
import { env } from '../../config/env';
import { AppError } from '../../middleware/errorHandler';
import { RoomRole } from '../../middleware/rbac';
import { storage } from '../../storage/S3Adapter';
import { fileCrypto } from '../../crypto/fileCrypto';
import { sanitizeFilename } from '../../utils/filename';
import { validateFileContent } from '../../utils/fileType';
import { audit } from '../audit/audit';
import { emit } from '../../realtime/emit';
import { logger } from '../../utils/logger';

export class FilesService {
  async uploadFile(roomId: string, uploaderId: string, file: Express.Multer.File) {
    if (!file || !file.buffer) {
      throw AppError.badRequest('No file uploaded', 'EMPTY_UPLOAD');
    }

    if (file.size > env.MAX_UPLOAD_BYTES) {
      throw AppError.payloadTooLarge('File exceeds maximum allowed size of 25 MB', 'FILE_TOO_LARGE');
    }

    // 1. Check user quota (default 500 MB)
    const quotaRes = await db.query<{ total_bytes: string }>(
      'SELECT COALESCE(SUM(size_bytes), 0) AS total_bytes FROM files WHERE uploader_id = $1 AND deleted_at IS NULL',
      [uploaderId]
    );

    const currentUsage = BigInt(quotaRes.rows[0].total_bytes);
    if (currentUsage + BigInt(file.size) > BigInt(env.USER_QUOTA_BYTES)) {
      throw AppError.payloadTooLarge('User storage quota exceeded (500 MB limit)', 'QUOTA_EXCEEDED');
    }

    // 2. Filename sanitization & extension validation
    let sanitizedName: string;
    let extension: string;
    try {
      const sanitized = sanitizeFilename(file.originalname);
      sanitizedName = sanitized.sanitizedName;
      extension = sanitized.extension;
    } catch (err: any) {
      throw AppError.badRequest(err.message, 'INVALID_FILENAME');
    }

    // 3. Magic-byte inspection & content validation
    let detectedMime: string;
    try {
      const validation = await validateFileContent(file.buffer, extension);
      detectedMime = validation.detectedMime;
    } catch (err: any) {
      throw AppError.badRequest(err.message, 'INVALID_FILE_CONTENT');
    }

    // 4. Compute SHA-256 of plaintext
    const sha256Plain = crypto.createHash('sha256').update(file.buffer).digest('hex');

    // 5. Encrypt file with envelope crypto (dev stub calls passthrough in Phase 0; Part 3 replaces with AES-256-GCM)
    const encrypted = await fileCrypto.encrypt(file.buffer);

    // 6. Generate server-side random UUID storage key (users never supply keys or paths)
    const storageKey = crypto.randomUUID();

    // 7. Store ciphertext in MinIO
    await storage.putObject(storageKey, encrypted.ciphertext, 'application/octet-stream');

    // 8. Insert DB record with orphan cleanup rollback
    try {
      const insertRes = await db.query(
        `INSERT INTO files (
           room_id, uploader_id, original_name, storage_key, detected_type,
           size_bytes, sha256_plain, enc_iv, enc_tag, dek_wrapped, kek_version
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, original_name AS name, size_bytes AS size, detected_type AS "detectedType",
                   sha256_plain AS sha256, uploader_id AS "uploaderId", created_at AS "createdAt"`,
        [
          roomId,
          uploaderId,
          sanitizedName,
          storageKey,
          detectedMime,
          file.size,
          sha256Plain,
          encrypted.iv,
          encrypted.tag,
          encrypted.dekWrapped,
          encrypted.kekVersion,
        ]
      );

      const savedFile = insertRes.rows[0];

      // Broadcast file upload event (metadata only; never file bytes)
      emit.fileUploaded(roomId, {
        id: savedFile.id,
        name: savedFile.name,
        size: Number(savedFile.size),
        uploaderId,
        createdAt: savedFile.createdAt,
      });

      await audit.log({
        actorId: uploaderId,
        action: 'file.upload',
        targetType: 'file',
        targetId: savedFile.id,
        roomId,
        outcome: 'success',
        metadata: {
          originalName: sanitizedName,
          sizeBytes: file.size,
          detectedType: detectedMime,
        },
      });

      return savedFile;
    } catch (dbError) {
      // Defense against orphan accumulation: delete S3 object if database insertion fails
      logger.error({ dbError, storageKey }, 'Database insertion failed after S3 PutObject. Rolling back S3 object...');
      try {
        await storage.deleteObject(storageKey);
      } catch (cleanupError) {
        logger.error({ cleanupError, storageKey }, 'Critical: Failed to clean up orphaned S3 object');
      }
      throw dbError;
    }
  }

  async listFiles(roomId: string) {
    const result = await db.query(
      `SELECT f.id, f.original_name AS name, f.size_bytes AS size, f.detected_type AS "detectedType",
              f.sha256_plain AS sha256, f.uploader_id AS "uploaderId", u.username AS "uploaderUsername",
              f.created_at AS "createdAt"
       FROM files f
       JOIN users u ON f.uploader_id = u.id
       WHERE f.room_id = $1 AND f.deleted_at IS NULL
       ORDER BY f.created_at DESC`,
      [roomId]
    );

    return result.rows.map((row) => ({
      ...row,
      size: Number(row.size),
    }));
  }

  async getFileForDownload(roomId: string, fileId: string, callerId: string) {
    // Both fileId AND roomId checked in database to prevent IDOR
    const result = await db.query(
      `SELECT id, room_id, original_name, storage_key, detected_type, size_bytes,
              enc_iv, enc_tag, dek_wrapped, kek_version
       FROM files
       WHERE id = $1 AND room_id = $2 AND deleted_at IS NULL`,
      [fileId, roomId]
    );

    if (result.rows.length === 0) {
      throw AppError.notFound('File not found in room', 'FILE_NOT_FOUND');
    }

    const file = result.rows[0];

    // Fetch ciphertext from MinIO
    const ciphertext = await storage.getObject(file.storage_key);

    // Decrypt and verify tag
    const plaintext = await fileCrypto.decrypt({
      ciphertext,
      iv: file.enc_iv,
      tag: file.enc_tag,
      dekWrapped: file.dek_wrapped,
      kekVersion: file.kek_version,
    });

    await audit.log({
      actorId: callerId,
      action: 'file.download',
      targetType: 'file',
      targetId: file.id,
      roomId,
      outcome: 'success',
      metadata: { originalName: file.original_name },
    });

    return {
      name: file.original_name,
      size: plaintext.length,
      buffer: plaintext,
    };
  }

  async deleteFile(roomId: string, fileId: string, callerId: string, callerRole: RoomRole) {
    const fileRes = await db.query(
      'SELECT id, storage_key, uploader_id, original_name FROM files WHERE id = $1 AND room_id = $2 AND deleted_at IS NULL',
      [fileId, roomId]
    );

    if (fileRes.rows.length === 0) {
      throw AppError.notFound('File not found in room', 'FILE_NOT_FOUND');
    }

    const file = fileRes.rows[0];

    // RBAC: Editors can only delete their own files; Owners can delete any file in room
    if (callerRole !== 'owner' && file.uploader_id !== callerId) {
      throw AppError.forbidden('Editors are only permitted to delete their own uploads', 'INSUFFICIENT_PERMISSIONS');
    }

    // Soft delete in database
    await db.query('UPDATE files SET deleted_at = now() WHERE id = $1', [fileId]);

    // Delete object from MinIO
    try {
      await storage.deleteObject(file.storage_key);
    } catch (err) {
      logger.warn({ err, storageKey: file.storage_key }, 'Failed to remove object from storage on file deletion');
    }

    emit.fileDeleted(roomId, fileId, callerId);

    await audit.log({
      actorId: callerId,
      action: 'file.delete',
      targetType: 'file',
      targetId: fileId,
      roomId,
      outcome: 'success',
    });
  }

  /**
   * Helper contract consumed by Part 3 share-links module.
   * Retrieves and decrypts file content without room auth check (caller authorizes via share key).
   */
  async getDecryptedForShare(fileId: string): Promise<{ name: string; size: number; buffer: Buffer }> {
    const result = await db.query(
      `SELECT id, original_name, storage_key, enc_iv, enc_tag, dek_wrapped, kek_version
       FROM files
       WHERE id = $1 AND deleted_at IS NULL`,
      [fileId]
    );

    if (result.rows.length === 0) {
      throw AppError.notFound('File not found', 'FILE_NOT_FOUND');
    }

    const file = result.rows[0];
    const ciphertext = await storage.getObject(file.storage_key);

    const plaintext = await fileCrypto.decrypt({
      ciphertext,
      iv: file.enc_iv,
      tag: file.enc_tag,
      dekWrapped: file.dek_wrapped,
      kekVersion: file.kek_version,
    });

    return {
      name: file.original_name,
      size: plaintext.length,
      buffer: plaintext,
    };
  }
}

export const filesService = new FilesService();
