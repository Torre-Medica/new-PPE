import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { LocalApiAuthGuard } from '@common/security/local-api-auth.guard';
import { LocalApiRole } from '@common/security/local-api-role.enum';

describe('LocalApiAuthGuard', () => {
  const createExecutionContext = (headers: Record<string, string | undefined>) =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          headers,
        }),
      }),
    }) as never;

  it('allows a request with a matching audit key', () => {
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValueOnce(false)
        .mockReturnValueOnce([LocalApiRole.Audit]),
    } as unknown as Reflector;
    const configService = {
      get: jest.fn((path: string) => {
        const values: Record<string, string> = {
          'localApi.adminKey': 'admin-key',
          'localApi.operatorKey': 'operator-key',
          'localApi.auditKey': 'audit-key',
        };

        return values[path] ?? '';
      }),
    };

    const jwtService = { verify: jest.fn() } as unknown as JwtService;
    const guard = new LocalApiAuthGuard(reflector, configService as never, jwtService);
    const context = createExecutionContext({
      'x-api-key': 'audit-key',
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a request without api key', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as unknown as Reflector;
    const configService = {
      get: jest.fn().mockReturnValue(''),
    };

    const jwtService = { verify: jest.fn() } as unknown as JwtService;
    const guard = new LocalApiAuthGuard(reflector, configService as never, jwtService);
    const context = createExecutionContext({});

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
