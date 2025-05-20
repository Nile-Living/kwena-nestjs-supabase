import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import multipart from '@fastify/multipart';
import { FastifyRequest, FastifyReply } from 'fastify';

async function bootstrap() {
  const fastifyAdapter = new FastifyAdapter();

  // --- Request Logger Middleware for Fastify ---
  fastifyAdapter.getInstance().addHook('onRequest', (request: FastifyRequest, reply: FastifyReply, done: () => void) => {
    const logger = new Logger('FastifyOnRequest');
    logger.log(`Incoming Request: ${request.method} ${request.raw.url} (Content-Type: ${request.headers['content-type']})`); // Log content-type too
    // For more detailed debugging of what Fastify sees before multipart parsing:
    // if (request.method === 'POST' && request.headers['content-type']?.startsWith('multipart/form-data')) {
    //   logger.debug('Raw multipart request received by Fastify hook.');
    // }
    done();
  });
  // --- End Request Logger ---

  // *** THIS WAS THE MISSING PIECE FROM THE PREVIOUS DEBUGGING STEP ***
  // Register @fastify/multipart to handle multipart/form-data
  await fastifyAdapter.register(multipart, {
    attachFieldsToBody: 'keyValues', // Crucial for making fields available on request.body
    // You can add an onError hook here too for multipart specific errors:
    onError: (error: Error, request: FastifyRequest, reply: FastifyReply) => {
      const mpLogger = new Logger('FastifyMultipartError');
      mpLogger.error(`Multipart parsing error: ${error.message}`, error.stack);
      // Default Fastify error handling will likely take over,
      // but this log helps identify if multipart itself is failing.
      // reply.status(500).send({ message: 'Multipart processing error', error: error.message });
    },
    // limits: { fileSize: 10 * 1024 * 1024 } // Example limit
  });
  // *******************************************************************

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    fastifyAdapter, // Use the adapter instance where multipart is registered
    { logger: ['error', 'warn', 'log', 'debug', 'verbose'] },
  );

  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // app.useGlobalPipes(
  //   new ValidationPipe({
  //     whitelist: true,
  //     transform: true,
  //     transformOptions: {
  //       enableImplicitConversion: true,
  //     },
  //   }),
  // );

  app.setGlobalPrefix("api");

  const configService = app.get(ConfigService);
  const port = configService.get<number>("PORT") || 8080;
  const bootstrapLogger = new Logger("Bootstrap"); // Renamed to avoid conflict

  await app.listen(port, "0.0.0.0");
  bootstrapLogger.log(`Application listening on port ${port}`);
}
bootstrap();
