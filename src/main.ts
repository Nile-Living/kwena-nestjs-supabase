import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import multipart from '@fastify/multipart';
import { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import { Readable } from 'stream';

async function bootstrap() {
  const fastifyAdapter = new FastifyAdapter();
  const fastifyInstance: FastifyInstance = fastifyAdapter.getInstance();

  fastifyInstance.addHook(
    'onRequest',
    (request: FastifyRequest, reply: FastifyReply, done: () => void) => {
      const logger = new Logger('FastifyOnRequest');
      logger.log(
        `Incoming Request: ${request.method} ${request.raw.url} (Content-Type: ${request.headers['content-type']})`,
      );
      done();
    },
  );

  // Use a preParsing hook to capture the raw body for JSON requests
  fastifyInstance.addHook(
    'preParsing',
    async (request: FastifyRequest, reply: FastifyReply, payload: any) => {
      if (request.headers['content-type']?.includes('application/json')) {
        const logger = new Logger('FastifyPreParsing');
        try {
          // The 'payload' in preParsing is a Readable stream
          const chunks: Buffer[] = [];
          for await (const chunk of payload) {
            chunks.push(chunk);
          }
          const rawBodyBuffer = Buffer.concat(chunks);
          (request as any).rawBodyString = rawBodyBuffer.toString('utf-8');
          logger.debug('Raw JSON body captured in preParsing hook.');

          // Return a new stream from the buffered data for subsequent parsers
          const newStream = new Readable();
          newStream.push(rawBodyBuffer);
          newStream.push(null); // Signal end of stream
          return newStream;
        } catch (error) {
          logger.error('Error capturing raw body in preParsing:', error);
          // If an error occurs, you might want to let the original payload pass
          // or handle the error appropriately. For now, we'll let it pass.
          return payload;
        }
      }
      // For other content types, just pass the payload through
      return payload;
    },
  );

  await fastifyAdapter.register(multipart, {
    attachFieldsToBody: 'keyValues',
    onError: (error: Error, request: FastifyRequest, reply: FastifyReply) => {
      const mpLogger = new Logger('FastifyMultipartError');
      mpLogger.error(`Multipart parsing error: ${error.message}`, error.stack);
    },
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    fastifyAdapter,
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

  app.setGlobalPrefix('api');

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') || 8080;
  const bootstrapLogger = new Logger('Bootstrap');

  await app.listen(port, '0.0.0.0');
  bootstrapLogger.log(`Application listening on port ${port}`);
}
bootstrap();