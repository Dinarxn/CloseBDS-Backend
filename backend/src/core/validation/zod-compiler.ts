import { z, type ZodSchema } from 'zod';
import { ValidationError } from '../errors/api-error.js';

/**
 * Validates any arbitrary data payload against a given Zod schema.
 * Throws a formatted ValidationError if parsing fails.
 */
export function validatePayload<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
      code: i.code,
    }));
    throw new ValidationError('Validation failed for request payload', details);
  }
  return result.data;
}

/**
 * Common reusable Zod schema building blocks
 */
export const CommonSchemas = {
  id: z.string().min(1, 'ID must not be empty'),
  uuid: z.string().uuid('Must be a valid UUID'),
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  email: z.string().email('Must be a valid email address'),
  url: z.string().url('Must be a valid URL'),
  pagination: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
};
