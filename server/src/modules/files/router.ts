import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { env } from '../../config/env';
import { requireRoomRole } from '../../middleware/rbac';
import { validate, uuidParamSchema } from '../../middleware/validate';
import { limiters } from '../../middleware/rateLimit';
import { filesService } from './service';
import { encodeRFC5987 } from '../../utils/filename';

// Multer memory storage configured with 25MB cap per spec §5.3
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_UPLOAD_BYTES,
  },
});

export const filesRouter = Router({ mergeParams: true });

// 1. POST /api/rooms/:roomId/files (min role: editor)
filesRouter.post(
  '/',
  requireRoomRole('editor'),
  limiters.upload,
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const file = await filesService.uploadFile(
        req.params.roomId,
        req.user!.id,
        req.file as Express.Multer.File
      );
      res.status(201).json({ file });
    } catch (err) {
      next(err);
    }
  }
);

// 2. GET /api/rooms/:roomId/files (min role: viewer)
filesRouter.get(
  '/',
  requireRoomRole('viewer'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const files = await filesService.listFiles(req.params.roomId);
      res.status(200).json({ files });
    } catch (err) {
      next(err);
    }
  }
);

// 3. GET /api/rooms/:roomId/files/:fileId/download (min role: viewer)
filesRouter.get(
  '/:fileId/download',
  validate({
    params: z.object({ roomId: uuidParamSchema, fileId: uuidParamSchema }).strict(),
  }),
  requireRoomRole('viewer'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const file = await filesService.getFileForDownload(
        req.params.roomId,
        req.params.fileId,
        req.user!.id
      );

      // Safe headers per spec §5.4 and §7.8
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeRFC5987(file.name)}`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Length', file.size.toString());

      res.send(file.buffer);
    } catch (err) {
      next(err);
    }
  }
);

// 4. DELETE /api/rooms/:roomId/files/:fileId (min role: editor)
filesRouter.delete(
  '/:fileId',
  validate({
    params: z.object({ roomId: uuidParamSchema, fileId: uuidParamSchema }).strict(),
  }),
  requireRoomRole('editor'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await filesService.deleteFile(
        req.params.roomId,
        req.params.fileId,
        req.user!.id,
        req.roomMembership!.role
      );
      res.status(200).json({ message: 'File deleted successfully' });
    } catch (err) {
      next(err);
    }
  }
);
