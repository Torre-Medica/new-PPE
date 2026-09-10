import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '@common/security/public.decorator';
import { LocalApiRole } from '@common/security/local-api-role.enum';
import { ROLES_KEY } from '@common/security/roles.decorator';
import type { PpeTokenPayload } from '@modules/auth/application/auth.service';

@Injectable()
export class LocalApiAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      localApiRole?: LocalApiRole;
    }>();

    // Try Bearer JWT first (admin screen login via nexo_back delegation)
    const authHeader = request.headers['authorization'];
    const authHeaderStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    if (authHeaderStr?.startsWith('Bearer ')) {
      const token = authHeaderStr.slice(7);
      try {
        const secret = this.configService.get<string>('auth.jwtSecret');
        const payload = this.jwtService.verify<PpeTokenPayload>(token, { secret });
        const role = payload.role ?? LocalApiRole.Admin;
        this.assertRoleAllowed(role, context);
        request.localApiRole = role;
        return true;
      } catch {
        throw new UnauthorizedException('Token JWT inválido o expirado');
      }
    }

    // Fall through to x-api-key
    const apiKeyHeader = request.headers['x-api-key'];
    const apiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
    if (!apiKey) {
      throw new UnauthorizedException('Se requiere cabecera Authorization o x-api-key');
    }

    const role = this.resolveRole(apiKey);
    if (!role) {
      throw new UnauthorizedException('La llave x-api-key no es valida');
    }

    this.assertRoleAllowed(role, context);
    request.localApiRole = role;
    return true;
  }

  private assertRoleAllowed(role: LocalApiRole, context: ExecutionContext): void {
    const requiredRoles =
      this.reflector.getAllAndOverride<LocalApiRole[]>(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (requiredRoles.length > 0 && !requiredRoles.includes(role)) {
      throw new ForbiddenException(
        `La llave autenticada con rol ${role} no puede acceder a este recurso`,
      );
    }
  }

  private resolveRole(apiKey: string): LocalApiRole | null {
    const keysByRole: Array<[LocalApiRole, string]> = [
      [LocalApiRole.Admin, this.configService.get<string>('localApi.adminKey', '')],
      [LocalApiRole.Operator, this.configService.get<string>('localApi.operatorKey', '')],
      [LocalApiRole.Audit, this.configService.get<string>('localApi.auditKey', '')],
    ];

    const matchingRole = keysByRole.find(
      ([, configuredKey]) => configuredKey.length > 0 && configuredKey === apiKey,
    );

    return matchingRole?.[0] ?? null;
  }
}
