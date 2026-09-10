import { SetMetadata } from '@nestjs/common';
import { LocalApiRole } from '@common/security/local-api-role.enum';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: LocalApiRole[]) => SetMetadata(ROLES_KEY, roles);
