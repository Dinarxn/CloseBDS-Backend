import type { Task, TaskStatus } from '@prisma/client';

export type { Task, TaskStatus };

export interface FollowUpTaskItem {
  id: string;
  leadId: string;
  leadBusinessName: string;
  assignedToUserId: string | null;
  assignedUserName: string | null;
  title: string;
  description: string | null;
  dueDate: Date | null;
  status: TaskStatus;
  createdAt: Date;
  updatedAt: Date;
}
