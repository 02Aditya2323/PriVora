import { Router } from 'express';

export const adminRouter = Router();

// Part 3 will implement:
// GET /api/admin/audit-logs
// PATCH /api/admin/users/:userId/lock
adminRouter.get('/audit-logs', (_req, res) => {
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'Admin audit logs module will be provided by Part 3' } });
});

adminRouter.patch('/users/:userId/lock', (_req, res) => {
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'Admin user lock module will be provided by Part 3' } });
});
