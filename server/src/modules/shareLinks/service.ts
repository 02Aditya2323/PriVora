import crypto from 'crypto';
import { db } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { RoomRole } from '../../middleware/rbac';
import { hashPassword, verifyPassword } from '../../crypto/password';
import { filesService } from '../files/service';
import { audit } from '../audit/audit';
import { emit } from '../../realtime/emit';

export interface CreateShareLinkParams {
  roomId: string;
  fileId: string;
  creatorId: string;
  creatorRole: RoomRole;
  expiresInMinutes?: number;
  maxDownloads?: number;
  password?: string;
}

export class ShareLinksService {
  async createShareLink(params: CreateShareLinkParams) {
    // 1. Verify file exists in room
    const fileRes = await db.query(
      'SELECT id, original_name, uploader_id FROM files WHERE id = $1 AND room_id = $2 AND deleted_at IS NULL',
      [params.fileId, params.roomId]
    );

    if (fileRes.rows.length === 0) {
      throw AppError.notFound('File not found in room', 'FILE_NOT_FOUND');
    }

    const file = fileRes.rows[0];

    // RBAC: Editors can only share their own files; Owners can share any file
    if (params.creatorRole !== 'owner' && file.uploader_id !== params.creatorId) {
      throw AppError.forbidden('Editors can only create share links for their own uploads', 'INSUFFICIENT_PERMISSIONS');
    }

    // Expiry: default 24h, max 7 days (10080 mins)
    const minutes = Math.min(Math.max(params.expiresInMinutes || 1440, 5), 10080);
    const expiresAt = new Date(Date.now() + minutes * 60 * 1000);

    // 256-bit CSPRNG share key
    const rawKey = crypto.randomBytes(32).toString('base64url');
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    let passwordHash: string | null = null;
    if (params.password) {
      passwordHash = await hashPassword(params.password);
    }

    const insertRes = await db.query(
      `INSERT INTO share_links (file_id, created_by, key_hash, password_hash, expires_at, max_downloads)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, file_id AS "fileId", expires_at AS "expiresAt",
                 max_downloads AS "maxDownloads", created_at AS "createdAt"`,
      [
        params.fileId,
        params.creatorId,
        keyHash,
        passwordHash,
        expiresAt,
        params.maxDownloads || null,
      ]
    );

    await audit.log({
      actorId: params.creatorId,
      action: 'share.create',
      targetType: 'share_link',
      targetId: insertRes.rows[0].id,
      roomId: params.roomId,
      outcome: 'success',
      metadata: { fileId: params.fileId, maxDownloads: params.maxDownloads },
    });

    // Plaintext key returned ONCE in create response
    return {
      key: rawKey,
      ...insertRes.rows[0],
      requiresPassword: !!passwordHash,
    };
  }

  async listShareLinks(roomId: string, fileId: string) {
    const result = await db.query(
      `SELECT sl.id, sl.file_id AS "fileId", sl.expires_at AS "expiresAt",
              sl.max_downloads AS "maxDownloads", sl.download_count AS "downloadCount",
              sl.created_at AS "createdAt", sl.password_hash IS NOT NULL AS "requiresPassword"
       FROM share_links sl
       JOIN files f ON sl.file_id = f.id
       WHERE sl.file_id = $1 AND f.room_id = $2 AND sl.revoked_at IS NULL AND sl.expires_at > now()
       ORDER BY sl.created_at DESC`,
      [fileId, roomId]
    );

    return result.rows;
  }

  async revokeShareLink(roomId: string, linkId: string, callerId: string, callerRole: RoomRole) {
    const linkRes = await db.query(
      `SELECT sl.id, sl.file_id, sl.created_by, f.room_id
       FROM share_links sl
       JOIN files f ON sl.file_id = f.id
       WHERE sl.id = $1 AND f.room_id = $2 AND sl.revoked_at IS NULL`,
      [linkId, roomId]
    );

    if (linkRes.rows.length === 0) {
      throw AppError.notFound('Share link not found or already revoked', 'SHARE_LINK_NOT_FOUND');
    }

    const link = linkRes.rows[0];

    if (callerRole !== 'owner' && link.created_by !== callerId) {
      throw AppError.forbidden('Only the link creator or room owner can revoke this share link', 'INSUFFICIENT_PERMISSIONS');
    }

    await db.query('UPDATE share_links SET revoked_at = now() WHERE id = $1', [linkId]);

    emit.shareRevoked(roomId, link.file_id, linkId);

    await audit.log({
      actorId: callerId,
      action: 'share.revoke',
      targetType: 'share_link',
      targetId: linkId,
      roomId,
      outcome: 'success',
    });
  }

  async getShareMeta(key: string) {
    const keyHash = crypto.createHash('sha256').update(key.trim()).digest('hex');

    const result = await db.query(
      `SELECT sl.id, sl.expires_at, sl.max_downloads, sl.download_count, sl.revoked_at,
              sl.password_hash IS NOT NULL AS "requiresPassword",
              f.original_name, f.size_bytes, f.detected_type
       FROM share_links sl
       JOIN files f ON sl.file_id = f.id
       WHERE sl.key_hash = $1 AND f.deleted_at IS NULL`,
      [keyHash]
    );

    // Uniform 404 for unknown, revoked, expired, or exhausted links
    if (result.rows.length === 0) {
      throw AppError.notFound('Share link not found or unavailable', 'SHARE_LINK_UNAVAILABLE');
    }

    const link = result.rows[0];

    if (link.revoked_at !== null || new Date(link.expires_at) < new Date()) {
      throw AppError.notFound('Share link not found or unavailable', 'SHARE_LINK_UNAVAILABLE');
    }

    if (link.max_downloads !== null && link.download_count >= link.max_downloads) {
      throw AppError.notFound('Share link download limit reached', 'SHARE_LINK_UNAVAILABLE');
    }

    return {
      name: link.original_name,
      size: Number(link.size_bytes),
      detectedType: link.detected_type,
      requiresPassword: link.requiresPassword,
      expiresAt: link.expires_at,
    };
  }

  async downloadSharedFile(key: string, password?: string) {
    const keyHash = crypto.createHash('sha256').update(key.trim()).digest('hex');

    const result = await db.query(
      `SELECT sl.id, sl.file_id, sl.password_hash, sl.expires_at, sl.max_downloads,
              sl.download_count, sl.revoked_at, f.room_id
       FROM share_links sl
       JOIN files f ON sl.file_id = f.id
       WHERE sl.key_hash = $1 AND f.deleted_at IS NULL`,
      [keyHash]
    );

    if (result.rows.length === 0) {
      throw AppError.notFound('Share link unavailable', 'SHARE_LINK_UNAVAILABLE');
    }

    const link = result.rows[0];

    if (link.revoked_at !== null || new Date(link.expires_at) < new Date()) {
      throw AppError.notFound('Share link unavailable', 'SHARE_LINK_UNAVAILABLE');
    }

    if (link.max_downloads !== null && link.download_count >= link.max_downloads) {
      throw AppError.notFound('Share link download limit reached', 'SHARE_LINK_UNAVAILABLE');
    }

    // Password verification
    if (link.password_hash) {
      if (!password) {
        await audit.log({
          action: 'share.redeem_denied',
          targetType: 'share_link',
          targetId: link.id,
          roomId: link.room_id,
          outcome: 'denied',
          metadata: { reason: 'Password required', fileId: link.file_id },
        });
        throw AppError.badRequest('Password required to access this file', 'PASSWORD_REQUIRED');
      }
      const valid = await verifyPassword(link.password_hash, password);
      if (!valid) {
        await audit.log({
          action: 'share.redeem_denied',
          targetType: 'share_link',
          targetId: link.id,
          roomId: link.room_id,
          outcome: 'denied',
          metadata: { reason: 'Invalid password', fileId: link.file_id },
        });
        throw AppError.unauthorized('Incorrect share link password', 'INVALID_PASSWORD');
      }
    }

    // Atomic download counter increment (Prevents race condition over-downloading)
    const updateRes = await db.query(
      `UPDATE share_links
       SET download_count = download_count + 1
       WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()
         AND (max_downloads IS NULL OR download_count < max_downloads)
       RETURNING id, file_id`,
      [link.id]
    );

    if (updateRes.rows.length === 0) {
      await audit.log({
        action: 'share.redeem_denied',
        targetType: 'share_link',
        targetId: link.id,
        roomId: link.room_id,
        outcome: 'denied',
        metadata: { reason: 'Download limit reached or expired during redeem', fileId: link.file_id },
      });
      throw AppError.notFound('Share link unavailable or download cap reached', 'SHARE_LINK_UNAVAILABLE');
    }

    // Decrypt and return file bytes
    const decrypted = await filesService.getDecryptedForShare(link.file_id);

    await audit.log({
      action: 'share.redeem',
      targetType: 'share_link',
      targetId: link.id,
      roomId: link.room_id,
      outcome: 'success',
      metadata: { fileId: link.file_id },
    });

    return decrypted;
  }
}

export const shareLinksService = new ShareLinksService();
