import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: ['http://192.168.0.74:3001', 'http://localhost:3000'],
    credentials: true,
  });
  await app.listen(80, '0.0.0.0');
}
bootstrap();
