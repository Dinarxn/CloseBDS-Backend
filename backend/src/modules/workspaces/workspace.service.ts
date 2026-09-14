import {
  WorkspaceRepository,
  UserRepository,
  workspaceRepository as defaultWorkspaceRepo,
  userRepository as defaultUserRepo,
} from '../../database/repository.js';
import { NotFoundError } from '../../core/errors/api-error.js';
import { sanitizeUser, type PublicUser } from '../auth/auth.service.js';
import type { Workspace } from '@prisma/client';

export class WorkspaceService {
  constructor(
    private workspaceRepo: WorkspaceRepository = defaultWorkspaceRepo,
    private userRepo: UserRepository = defaultUserRepo
  ) {}

  /**
   * Retrieves active workspace details by workspaceId.
   */
  async getCurrentWorkspace(workspaceId: string): Promise<Workspace> {
    const workspace = await this.workspaceRepo.findById(workspaceId);
    if (!workspace) {
      throw new NotFoundError('Active workspace not found');
    }
    return workspace;
  }

  /**
   * Retrieves all member users belonging strictly to the specified workspaceId.
   */
  async getWorkspaceMembers(workspaceId: string): Promise<PublicUser[]> {
    const users = await this.userRepo.findMany(workspaceId);
    return users.map(sanitizeUser);
  }
}

export const workspaceService = new WorkspaceService();
