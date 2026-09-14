import { UnauthorizedError, ForbiddenError } from '../errors/api-error.js';

export interface WorkspaceContext {
  workspaceId: string;
  userId?: string;
  userRole?: 'owner' | 'admin' | 'member';
  requestId: string;
}

export interface WorkspaceBoundaryValidator {
  validateWorkspaceAccess(workspaceId: string, userId: string): Promise<boolean>;
}

/**
 * Validates that the request has an active workspace context.
 */
export function assertWorkspaceContext(context?: Partial<WorkspaceContext>): asserts context is WorkspaceContext {
  if (!context?.workspaceId) {
    throw new UnauthorizedError('Missing or invalid workspace context');
  }
}

/**
 * Validates that an accessed resource belongs strictly to the authenticated workspace.
 */
export function assertTenantBoundary(
  requestedResourceWorkspaceId: string,
  currentContextWorkspaceId: string
): void {
  if (requestedResourceWorkspaceId !== currentContextWorkspaceId) {
    throw new ForbiddenError('Cross-workspace resource access is strictly prohibited');
  }
}
