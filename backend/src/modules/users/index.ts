/**
 * Module Boundary: Users
 * Reserved for user identity management.
 */
export interface UserEntity {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
  createdAt: Date;
  updatedAt: Date;
}
