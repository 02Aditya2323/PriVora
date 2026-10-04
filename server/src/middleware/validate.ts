import { Request, Response, NextFunction } from 'express';
import { ZodSchema, z } from 'zod';

export const uuidParamSchema = z.string().uuid({ message: 'Must be a valid UUIDv4' });

export interface ValidationSchemas {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
}

/**
 * Zod validation middleware enforcing strict schemas on request components.
 * Unknown properties on strict schemas will trigger a 400 Bad Request error.
 */
export function validate(schemas: ValidationSchemas) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (schemas.params) {
        req.params = await schemas.params.parseAsync(req.params);
      }
      if (schemas.query) {
        req.query = await schemas.query.parseAsync(req.query);
      }
      if (schemas.body) {
        req.body = await schemas.body.parseAsync(req.body);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
