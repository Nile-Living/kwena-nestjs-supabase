import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { logger: ['error', 'warn', 'log', 'debug', 'verbose'] },
  );

  app.enableCors();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  app.setGlobalPrefix("api");

  const configService = app.get(ConfigService);
  const port = configService.get<number>("PORT") || 8080;
  const logger = new Logger("Bootstrap");

  await app.listen(port, "0.0.0.0");
  logger.log(`Application listening on port ${port}`);
}
bootstrap();
