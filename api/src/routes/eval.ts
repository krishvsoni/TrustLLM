import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { RustEvalService } from '../services/rust-eval.service.js';
import { EvaluationRequestSchema } from '../types/index.js';

const evalService = new RustEvalService();

export async function evalRoutes(fastify: FastifyInstance, opts: FastifyPluginOptions) {
  
  // Start a new evaluation
  fastify.post('/eval/run', {
    schema: {
      description: 'Start a new evaluation job',
      tags: ['Evaluation'],
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          prompts: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                text: { type: 'string' },
                expected_output: { type: 'string' },
                category: { type: 'string' },
                metadata: { type: 'object' }
              },
              required: ['id', 'text']
            }
          },
          models: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                provider: { type: 'string' },
                model_name: { type: 'string' },
                parameters: { type: 'object' },
                api_key: { type: 'string' },
                endpoint: { type: 'string' }
              },
              required: ['id', 'provider', 'model_name']
            }
          },
          metrics: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                enabled: { type: 'boolean', default: true },
                weight: { type: 'number', minimum: 0, maximum: 1, default: 1 },
                parameters: { type: 'object' }
              },
              required: ['name']
            }
          },
          config: {
            type: 'object',
            properties: {
              parallel_requests: { type: 'number', default: 5 },
              timeout_seconds: { type: 'number', default: 120 },
              retry_attempts: { type: 'number', default: 3 }
            }
          }
        },
        required: ['name', 'prompts', 'models', 'metrics']
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                job_id: { type: 'string', format: 'uuid' }
              }
            },
            message: { type: 'string' }
          }
        },
        400: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            code: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const evaluationRequest = request.body as any;
      const result = await evalService.startEvaluation(evaluationRequest);
      
      if (result.success) {
        reply.code(200).send(result);
      } else {
        reply.code(400).send(result);
      }
    } catch (error) {
      reply.code(400).send({
        success: false,
        error: 'Invalid request body',
        code: 'VALIDATION_ERROR',
        details: error instanceof Error ? error.message : 'Unknown validation error'
      });
    }
  });

  // Get available metrics
  fastify.get('/eval/metrics', {
    schema: {
      description: 'Get list of available evaluation metrics',
      tags: ['Evaluation'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'array',
              items: { type: 'string' }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const result = await evalService.getAvailableMetrics();
    reply.send(result);
  });

  // Get available model providers
  fastify.get('/eval/providers', {
    schema: {
      description: 'Get list of available model providers',
      tags: ['Evaluation'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'array',
              items: { type: 'string' }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const result = await evalService.getAvailableProviders();
    reply.send(result);
  });

  // List all evaluation jobs
  fastify.get('/eval/jobs', {
    schema: {
      description: 'List all evaluation jobs',
      tags: ['Evaluation'],
      querystring: {
        type: 'object',
        properties: {
          status: { 
            type: 'string', 
            enum: ['pending', 'running', 'completed', 'failed', 'cancelled'] 
          },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          offset: { type: 'integer', minimum: 0, default: 0 }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  status: { type: 'string' },
                  created_at: { type: 'string' },
                  completed_at: { type: 'string' }
                }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const result = await evalService.listJobs();
    
    if (result.success) {
      const query = request.query as any;
      let jobs = result.data;

      // Filter by status if specified
      if (query.status) {
        jobs = jobs.filter(job => job.status === query.status);
      }

      // Apply pagination
      const offset = query.offset || 0;
      const limit = query.limit || 20;
      const paginatedJobs = jobs.slice(offset, offset + limit);

      reply.send({
        success: true,
        data: paginatedJobs,
        pagination: {
          total: jobs.length,
          offset,
          limit,
          has_more: offset + limit < jobs.length
        }
      });
    } else {
      reply.send(result);
    }
  });

  // Generate sample configuration
  fastify.get('/eval/sample-config', {
    schema: {
      description: 'Generate a sample evaluation configuration',
      tags: ['Evaluation'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const sampleConfig = {
      name: "Sample LLM Evaluation",
      prompts: [
        {
          id: "explain_ai",
          text: "Explain artificial intelligence in simple terms.",
          expected_output: "AI is technology that enables machines to simulate human intelligence and perform tasks that typically require human cognition.",
          category: "explanation"
        },
        {
          id: "solve_math",
          text: "What is 15% of 240?",
          expected_output: "36",
          category: "mathematics"
        },
        {
          id: "creative_writing",
          text: "Write a haiku about technology.",
          category: "creativity"
        }
      ],
      models: [
        {
          id: "gpt-3.5",
          provider: "openai",
          model_name: "gpt-3.5-turbo",
          parameters: {
            temperature: 0.7,
            max_tokens: 150
          }
        },
        {
          id: "claude-3",
          provider: "anthropic", 
          model_name: "claude-3-sonnet-20240229",
          parameters: {
            temperature: 0.7,
            max_tokens: 150
          }
        }
      ],
      metrics: [
        {
          name: "exact_match",
          enabled: true,
          weight: 1.0
        },
        {
          name: "bleu",
          enabled: true,
          weight: 0.8
        },
        {
          name: "latency",
          enabled: true,
          weight: 0.3
        },
        {
          name: "cost",
          enabled: true,
          weight: 0.2
        }
      ],
      config: {
        parallel_requests: 5,
        timeout_seconds: 120,
        retry_attempts: 3
      }
    };

    reply.send({
      success: true,
      data: sampleConfig
    });
  });
}
