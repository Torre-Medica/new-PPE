import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { LocalApiRole } from '@common/security/local-api-role.enum';

export interface PpeTokenPayload {
  sub: string;
  email: string;
  name: string;
  role: LocalApiRole;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async loginWithServer(email: string, password: string): Promise<{ accessToken: string }> {
    const serverUrl = this.configService.get<string>('serverLink.url', 'http://localhost:3001');

    let serverToken: string;
    let name: string;

    try {
      const response = await fetch(`${serverUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        throw new UnauthorizedException('Credenciales inválidas');
      }

      const body = (await response.json()) as {
        token?: string;
        name?: string;
        lastName?: string;
      };

      if (!body.token) {
        throw new UnauthorizedException('El servidor no devolvió un token');
      }

      serverToken = body.token;
      name = [body.name, body.lastName].filter(Boolean).join(' ') || email;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.error('Error contactando nexo_back para login', err);
      throw new UnauthorizedException('No se pudo contactar el servidor de autenticación');
    }

    this.logger.log(`Login exitoso desde nexo_back: ${email}`);
    void serverToken;

    const payload: PpeTokenPayload = { sub: email, email, name, role: LocalApiRole.Admin };
    const accessToken = this.jwtService.sign(payload);

    return { accessToken };
  }
}
