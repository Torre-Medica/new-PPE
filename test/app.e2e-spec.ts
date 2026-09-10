import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('PPE API (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    process.env.DATABASE_PATH = './data/ppe.sqlite';
    process.env.PPE_HEADLESS_MODE = 'true';
    process.env.LOCAL_API_AUDIT_KEY = 'ppe-audit-local';
    process.env.LOCAL_API_OPERATOR_KEY = 'ppe-operator-local';
    process.env.LOCAL_API_ADMIN_KEY = 'ppe-admin-local';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
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
    await app.init();
  });

  it('/api/health/live (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/health/live')
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('ok');
        expect(body.service).toBe('ppe-backend');
      });
  });

  it('/api/cash/inventory requires x-api-key', () => {
    return request(app.getHttpServer())
      .get('/api/cash/inventory')
      .expect(401);
  });

  afterAll(async () => {
    await app.close();
  });
});
