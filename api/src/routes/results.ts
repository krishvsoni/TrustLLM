import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { RustEvalService } from '../services/rust-eval.service.js';

const evalService = new RustEvalService();

export async function resultsRoutes(fastify: FastifyInstance, opts: FastifyPluginOptions) {
  
  // Get job results by ID
  fastify.get('/results/:jobId', {
    schema: {
      description: 'Get evaluation results for a specific job',
      tags: ['Results'],
      params: {
        type: 'object',
        properties: {
          jobId: { type: 'string', format: 'uuid' }
        },
        required: ['jobId']
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object' }
          }
        },
        404: {
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
    const { jobId } = request.params as { jobId: string };
    const result = await evalService.getJobResults(jobId);
    
    if (result.success) {
      reply.send(result);
    } else if (result.code === 'JOB_NOT_FOUND') {
      reply.code(404).send(result);
    } else {
      reply.code(500).send(result);
    }
  });

  // Get job status only (lightweight)
  fastify.get('/results/:jobId/status', {
    schema: {
      description: 'Get just the status of an evaluation job',
      tags: ['Results'],
      params: {
        type: 'object',
        properties: {
          jobId: { type: 'string', format: 'uuid' }
        },
        required: ['jobId']
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                job_id: { type: 'string' },
                status: { type: 'string' },
                created_at: { type: 'string' },
                completed_at: { type: 'string' },
                progress: {
                  type: 'object',
                  properties: {
                    completed_prompts: { type: 'integer' },
                    total_prompts: { type: 'integer' },
                    completed_models: { type: 'integer' },
                    total_models: { type: 'integer' },
                    percentage: { type: 'number' }
                  }
                }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const result = await evalService.getJobResults(jobId);
    
    if (result.success) {
      const job = result.data;
      
      // Calculate progress if job is running
      let progress = null;
      if (job.status === 'running' || job.status === 'completed') {
        const totalPrompts = job.prompts.length;
        const totalModels = job.models.length;
        const totalEvaluations = totalPrompts * totalModels;
        
        let completedEvaluations = 0;
        if (job.results?.model_results) {
          for (const modelResult of Object.values(job.results.model_results)) {
            completedEvaluations += (modelResult as any).outputs.length;
          }
        }
        
        progress = {
          completed_prompts: Math.min(totalPrompts, Math.floor(completedEvaluations / totalModels)),
          total_prompts: totalPrompts,
          completed_models: Object.keys(job.results?.model_results || {}).length,
          total_models: totalModels,
          percentage: Math.round((completedEvaluations / totalEvaluations) * 100)
        };
      }

      reply.send({
        success: true,
        data: {
          job_id: job.id,
          status: job.status,
          created_at: job.created_at,
          completed_at: job.completed_at,
          progress
        }
      });
    } else {
      reply.code(result.code === 'JOB_NOT_FOUND' ? 404 : 500).send(result);
    }
  });

  // Download results as JSON file
  fastify.get('/results/:jobId/download', {
    schema: {
      description: 'Download evaluation results as JSON file',
      tags: ['Results'],
      params: {
        type: 'object',
        properties: {
          jobId: { type: 'string', format: 'uuid' }
        },
        required: ['jobId']
      },
      querystring: {
        type: 'object',
        properties: {
          format: { 
            type: 'string', 
            enum: ['json', 'csv'], 
            default: 'json' 
          }
        }
      }
    }
  }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const { format = 'json' } = request.query as { format?: 'json' | 'csv' };
    
    const result = await evalService.getJobResults(jobId);
    
    if (!result.success) {
      reply.code(result.code === 'JOB_NOT_FOUND' ? 404 : 500).send(result);
      return;
    }

    const job = result.data;
    const filename = `evaluation-${job.name.replace(/[^a-zA-Z0-9]/g, '-')}-${jobId.slice(0, 8)}.${format}`;
    
    if (format === 'json') {
      reply
        .header('Content-Type', 'application/json')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(JSON.stringify(job, null, 2));
    } else if (format === 'csv') {
      // Convert to CSV format
      const csvData = convertToCsv(job);
      reply
        .header('Content-Type', 'text/csv')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(csvData);
    }
  });

  // Get summary statistics across multiple jobs
  fastify.get('/results/summary', {
    schema: {
      description: 'Get summary statistics across all evaluation jobs',
      tags: ['Results'],
      querystring: {
        type: 'object',
        properties: {
          date_from: { type: 'string', format: 'date' },
          date_to: { type: 'string', format: 'date' },
          models: { 
            type: 'array',
            items: { type: 'string' }
          },
          metrics: {
            type: 'array', 
            items: { type: 'string' }
          }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                total_jobs: { type: 'integer' },
                completed_jobs: { type: 'integer' },
                total_evaluations: { type: 'integer' },
                total_cost_usd: { type: 'number' },
                avg_latency_ms: { type: 'number' },
                top_performing_models: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      model_id: { type: 'string' },
                      avg_score: { type: 'number' },
                      evaluation_count: { type: 'integer' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const allJobsResult = await evalService.listJobs();
    
    if (!allJobsResult.success) {
      reply.send(allJobsResult);
      return;
    }

    const jobs = allJobsResult.data.filter(job => job.status === 'completed' && job.results);
    
    // Calculate summary statistics
    let totalEvaluations = 0;
    let totalCost = 0;
    let totalLatency = 0;
    const modelPerformance: Record<string, { scores: number[], costs: number[], latencies: number[] }> = {};

    for (const job of jobs) {
      if (!job.results) continue;

      for (const [modelId, modelResult] of Object.entries(job.results.model_results)) {
        const result = modelResult as any;
        totalEvaluations += result.outputs.length;
        totalCost += result.performance.total_cost_usd;
        totalLatency += result.performance.total_latency_ms;

        if (!modelPerformance[modelId]) {
          modelPerformance[modelId] = { scores: [], costs: [], latencies: [] };
        }

        // Aggregate scores from all metrics
        const avgScore = Object.values(result.metrics)
          .map((m: any) => m.score)
          .reduce((a: number, b: number) => a + b, 0) / Object.keys(result.metrics).length;
        
        modelPerformance[modelId].scores.push(avgScore);
        modelPerformance[modelId].costs.push(result.performance.total_cost_usd);
        modelPerformance[modelId].latencies.push(result.performance.average_latency_ms);
      }
    }

    // Calculate top performing models
    const topModels = Object.entries(modelPerformance)
      .map(([modelId, perf]) => ({
        model_id: modelId,
        avg_score: perf.scores.reduce((a, b) => a + b, 0) / perf.scores.length,
        evaluation_count: perf.scores.length
      }))
      .sort((a, b) => b.avg_score - a.avg_score)
      .slice(0, 10);

    reply.send({
      success: true,
      data: {
        total_jobs: allJobsResult.data.length,
        completed_jobs: jobs.length,
        total_evaluations: totalEvaluations,
        total_cost_usd: totalCost,
        avg_latency_ms: totalEvaluations > 0 ? totalLatency / totalEvaluations : 0,
        top_performing_models: topModels
      }
    });
  });
}

/**
 * Convert evaluation results to CSV format
 */
function convertToCsv(job: any): string {
  const headers = ['job_id', 'model_id', 'prompt_id', 'metric_name', 'score', 'latency_ms', 'cost_usd'];
  const rows = [headers.join(',')];

  if (job.results?.model_results) {
    for (const [modelId, modelResult] of Object.entries(job.results.model_results)) {
      const result = modelResult as any;
      
      for (const [metricName, metricData] of Object.entries(result.metrics)) {
        const metric = metricData as any;
        
        for (const [promptId, score] of Object.entries(metric.per_prompt_scores || {})) {
          const output = result.outputs.find((o: any) => o.prompt_id === promptId);
          rows.push([
            job.id,
            modelId,
            promptId,
            metricName,
            score,
            output?.latency_ms || 0,
            output?.cost_usd || 0
          ].join(','));
        }
      }
    }
  }

  return rows.join('\n');
}
