import fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { evalRoutes } from './routes/eval.js';
import { compareRoutes } from './routes/compare.js';
import { resultsRoutes } from './routes/results.js';
const server = fastify({
  logger: {
    level: 'info'
  },
});

await server.register(cors, {
  origin: true,
});

await server.register(swagger, {
  swagger: {
    info: {
      title: 'TrustLLM EaaS API',
      description: 'Evaluation as a Service API for LLM testing and benchmarking',
      version: '1.0.0',
    },
    host: 'localhost:3000',
    schemes: ['http'],
    consumes: ['application/json'],
    produces: ['application/json'],
  },
});

await server.register(swaggerUi, {
  routePrefix: '/docs',
  uiConfig: {
    docExpansion: 'full',
    deepLinking: false,
  },
  uiHooks: {
    onRequest: function (request, reply, next) { next(); },
    preHandler: function (request, reply, next) { next(); },
  },
  staticCSP: true,
  transformStaticCSP: (header) => header,
  transformSpecification: (swaggerObject, request, reply) => { return swaggerObject; },
  transformSpecificationClone: true,
});

server.get('/health', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

await server.register(evalRoutes, { prefix: '/api/v1' });
await server.register(resultsRoutes, { prefix: '/api/v1' });
await server.register(compareRoutes, { prefix: '/api/v1' });

const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3000');
    const host = process.env.HOST || '0.0.0.0';
    
    await server.listen({ port, host });
    server.log.info(` TrustLLM EaaS API running on http://${host}:${port}`);
    server.log.info(` API Documentation available at http://${host}:${port}/docs`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();