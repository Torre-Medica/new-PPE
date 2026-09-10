import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@src/app.module';
import { DomainExceptionFilter } from '@common/errors/domain-exception.filter';

// Vendor serial-port libraries throw synchronously inside event callbacks, which
// Node.js surfaces as uncaughtException. The peripherals service already handles
// hardware failures via its onError() listeners and reconnect timers; we just need
// to stop these vendor throws from crashing the process.
process.on('uncaughtException', (error: Error) => {
  const msg = error?.message ?? String(error);
  const isSerialError =
    msg.includes('Error conectando la tarjeta') ||
    msg.includes('Opening COM') ||
    msg.includes('Opening /dev/') ||
    msg.includes('File not found') ||
    msg.includes('Access denied') ||
    msg.includes('ENOENT') ||
    msg.includes('EACCES') ||
    (error.stack?.includes('serialport') ?? false) ||
    (error.stack?.includes('SerialPort') ?? false);

  if (isSerialError) {
    console.error(`[serial-port] uncaughtException interceptado (el hardware ya lo maneja via onError): ${msg}`);
    return;
  }

  console.error('[uncaughtException] Error no manejado — cerrando proceso:', error);
  process.exit(1);
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.setGlobalPrefix(configService.get<string>('app.apiPrefix') ?? 'api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );
  app.useGlobalFilters(new DomainExceptionFilter());

  await app.listen(configService.get<number>('app.port') ?? 3000);
}

void bootstrap();
