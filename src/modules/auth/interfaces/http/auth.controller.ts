import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Public } from '@common/security/public.decorator';
import { AuthService } from '@modules/auth/application/auth.service';
import { LoginDto } from '@modules/auth/application/dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto): Promise<{ accessToken: string }> {
    return this.authService.loginWithServer(dto.email, dto.password);
  }
}
