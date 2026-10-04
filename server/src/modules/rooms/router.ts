import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { auth } from '../../middleware/auth';
import { requireRoomRole } from '../../middleware/rbac';
import { validate, uuidParamSchema } from '../../middleware/validate';
import { roomsService } from './service';
import { roomJoinKeysService } from './joinKeysService';
import { shareLinksService } from '../shareLinks/service';
import { filesRouter } from '../files/router';

export const roomsRouter = Router();

// All rooms routes require authentication
roomsRouter.use(auth);

// Mount file pipeline routes
roomsRouter.use('/:roomId/files', filesRouter);

const createRoomSchema = z
  .object({
    name: z.string().min(1, 'Room name is required').max(100, 'Room name cannot exceed 100 characters'),
  })
  .strict();

const joinRoomByKeySchema = z
  .object({
    key: z.string().min(1, 'Join key is required'),
    password: z.string().optional(),
  })
  .strict();

const createJoinKeySchema = z
  .object({
    role: z.enum(['editor', 'viewer']).optional(),
    expiresInHours: z.number().int().min(1).max(168).optional(),
    maxUses: z.number().int().min(1).optional(),
    password: z.string().min(1).optional(),
  })
  .strict();

const addMemberSchema = z
  .object({
    identifier: z.string().min(1, 'Email or username is required'),
    role: z.enum(['editor', 'viewer'], { errorMap: () => ({ message: 'Role must be editor or viewer' }) }),
  })
  .strict();

const updateMemberRoleSchema = z
  .object({
    role: z.enum(['editor', 'viewer'], { errorMap: () => ({ message: 'Role must be editor or viewer' }) }),
  })
  .strict();

// 0. POST /api/rooms/join (Join a room using a cryptographic join key)
roomsRouter.post(
  '/join',
  validate({ body: joinRoomByKeySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await roomJoinKeysService.joinRoomWithKey({
        key: req.body.key,
        password: req.body.password,
        userId: req.user!.id,
        userEmail: req.user!.email,
        username: req.user!.username,
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

// 1. POST /api/rooms (any authenticated user)
roomsRouter.post(
  '/',
  validate({ body: createRoomSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const room = await roomsService.createRoom(req.user!.id, req.body.name);
      res.status(201).json({ room });
    } catch (err) {
      next(err);
    }
  }
);

// 2. GET /api/rooms (any authenticated user: returns rooms user is member of)
roomsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rooms = await roomsService.listUserRooms(req.user!.id);
    res.status(200).json({ rooms });
  } catch (err) {
    next(err);
  }
});

// 3. GET /api/rooms/:roomId (min role: viewer)
roomsRouter.get(
  '/:roomId',
  validate({ params: z.object({ roomId: uuidParamSchema }).strict() }),
  requireRoomRole('viewer'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const room = await roomsService.getRoom(req.params.roomId, req.user!.id);
      res.status(200).json({ room });
    } catch (err) {
      next(err);
    }
  }
);

// 4. DELETE /api/rooms/:roomId (min role: owner)
roomsRouter.delete(
  '/:roomId',
  validate({ params: z.object({ roomId: uuidParamSchema }).strict() }),
  requireRoomRole('owner'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await roomsService.deleteRoom(req.params.roomId, req.user!.id);
      res.status(200).json({ message: 'Room deleted successfully' });
    } catch (err) {
      next(err);
    }
  }
);

// 5. GET /api/rooms/:roomId/members (min role: viewer)
roomsRouter.get(
  '/:roomId/members',
  validate({ params: z.object({ roomId: uuidParamSchema }).strict() }),
  requireRoomRole('viewer'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const members = await roomsService.listMembers(req.params.roomId);
      res.status(200).json({ members });
    } catch (err) {
      next(err);
    }
  }
);

// 6. POST /api/rooms/:roomId/members (min role: owner)
roomsRouter.post(
  '/:roomId/members',
  validate({
    params: z.object({ roomId: uuidParamSchema }).strict(),
    body: addMemberSchema,
  }),
  requireRoomRole('owner'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const member = await roomsService.addMember(
        req.params.roomId,
        req.user!.id,
        req.body.identifier,
        req.body.role
      );
      res.status(201).json({ member });
    } catch (err) {
      next(err);
    }
  }
);

// 7. PATCH /api/rooms/:roomId/members/:userId (min role: owner)
roomsRouter.patch(
  '/:roomId/members/:userId',
  validate({
    params: z.object({ roomId: uuidParamSchema, userId: uuidParamSchema }).strict(),
    body: updateMemberRoleSchema,
  }),
  requireRoomRole('owner'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const member = await roomsService.updateMemberRole(
        req.params.roomId,
        req.user!.id,
        req.params.userId,
        req.body.role
      );
      res.status(200).json({ member });
    } catch (err) {
      next(err);
    }
  }
);

// 8. DELETE /api/rooms/:roomId/members/:userId (owner or self to leave)
roomsRouter.delete(
  '/:roomId/members/:userId',
  validate({
    params: z.object({ roomId: uuidParamSchema, userId: uuidParamSchema }).strict(),
  }),
  requireRoomRole('viewer'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await roomsService.removeMember(
        req.params.roomId,
        req.user!.id,
        req.roomMembership!.role,
        req.params.userId
      );
      res.status(200).json({ message: 'Member removed successfully' });
    } catch (err) {
      next(err);
    }
  }
);

// 9. POST /api/rooms/:roomId/join-keys (Owner generates an expiring join key)
roomsRouter.post(
  '/:roomId/join-keys',
  validate({
    params: z.object({ roomId: uuidParamSchema }).strict(),
    body: createJoinKeySchema,
  }),
  requireRoomRole('owner'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const joinKey = await roomJoinKeysService.createJoinKey({
        roomId: req.params.roomId,
        creatorId: req.user!.id,
        role: req.body.role,
        expiresInHours: req.body.expiresInHours,
        maxUses: req.body.maxUses,
        password: req.body.password,
      });
      res.status(201).json({ joinKey });
    } catch (err) {
      next(err);
    }
  }
);

// 10. GET /api/rooms/:roomId/join-keys (Owner lists active join keys)
roomsRouter.get(
  '/:roomId/join-keys',
  validate({
    params: z.object({ roomId: uuidParamSchema }).strict(),
  }),
  requireRoomRole('owner'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const joinKeys = await roomJoinKeysService.listJoinKeys(req.params.roomId);
      res.status(200).json({ joinKeys });
    } catch (err) {
      next(err);
    }
  }
);

// 11. DELETE /api/rooms/:roomId/join-keys/:keyId (Owner revokes a join key)
roomsRouter.delete(
  '/:roomId/join-keys/:keyId',
  validate({
    params: z.object({ roomId: uuidParamSchema, keyId: uuidParamSchema }).strict(),
  }),
  requireRoomRole('owner'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await roomJoinKeysService.revokeJoinKey(
        req.params.roomId,
        req.params.keyId,
        req.user!.id
      );
      res.status(200).json({ message: 'Join key revoked successfully' });
    } catch (err) {
      next(err);
    }
  }
);

const createShareLinkSchema = z
  .object({
    expiresInMinutes: z.number().int().min(5).max(10080).optional(),
    maxDownloads: z.number().int().min(1).optional(),
    password: z.string().min(1).optional(),
  })
  .strict();

// 12. POST /api/rooms/:roomId/files/:fileId/share-links (Create public share key for file)
roomsRouter.post(
  '/:roomId/files/:fileId/share-links',
  validate({
    params: z.object({ roomId: uuidParamSchema, fileId: uuidParamSchema }).strict(),
    body: createShareLinkSchema,
  }),
  requireRoomRole('editor'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const link = await shareLinksService.createShareLink({
        roomId: req.params.roomId,
        fileId: req.params.fileId,
        creatorId: req.user!.id,
        creatorRole: req.roomMembership!.role,
        expiresInMinutes: req.body.expiresInMinutes,
        maxDownloads: req.body.maxDownloads,
        password: req.body.password,
      });
      res.status(201).json({ shareLink: link });
    } catch (err) {
      next(err);
    }
  }
);

// 13. GET /api/rooms/:roomId/files/:fileId/share-links (List share links for file)
roomsRouter.get(
  '/:roomId/files/:fileId/share-links',
  validate({
    params: z.object({ roomId: uuidParamSchema, fileId: uuidParamSchema }).strict(),
  }),
  requireRoomRole('editor'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const shareLinks = await shareLinksService.listShareLinks(
        req.params.roomId,
        req.params.fileId
      );
      res.status(200).json({ shareLinks });
    } catch (err) {
      next(err);
    }
  }
);

// 14. DELETE /api/rooms/:roomId/share-links/:linkId (Revoke a share link)
roomsRouter.delete(
  '/:roomId/share-links/:linkId',
  validate({
    params: z.object({ roomId: uuidParamSchema, linkId: uuidParamSchema }).strict(),
  }),
  requireRoomRole('editor'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await shareLinksService.revokeShareLink(
        req.params.roomId,
        req.params.linkId,
        req.user!.id,
        req.roomMembership!.role
      );
      res.status(200).json({ message: 'Share link revoked successfully' });
    } catch (err) {
      next(err);
    }
  }
);
