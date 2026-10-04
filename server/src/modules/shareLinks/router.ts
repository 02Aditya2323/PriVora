import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { limiters } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import { shareLinksService } from './service';
import { encodeRFC5987 } from '../../utils/filename';

export const shareLinksRouter = Router();

// Apply public share limiter per spec §7.5
shareLinksRouter.use(limiters.share);

const downloadSchema = z
  .object({
    password: z.string().optional(),
  })
  .strict();

// 1. GET /api/s/:key/meta (Public file metadata)
shareLinksRouter.get('/:key/meta', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const meta = await shareLinksService.getShareMeta(req.params.key);
    res.status(200).json({ file: meta });
  } catch (err) {
    next(err);
  }
});

// 2. POST /api/s/:key/download (Public download with atomic counter)
shareLinksRouter.post(
  '/:key/download',
  validate({ body: downloadSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const file = await shareLinksService.downloadSharedFile(req.params.key, req.body.password);

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
