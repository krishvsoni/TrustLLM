import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { ComparisonService } from '../services/comparison.service.js';
import { ComparisonRequestSchema } from '../types/index.js';

const comparisonService = new ComparisonService();

export async function compareRoutes(fastify: FastifyInstance, opts: FastifyPluginOptions) {
  
  // Compare multiple evaluation jobs
  fastify.post('/compare', {
    schema: {
      description: 'Compare results from multiple evaluation jobs',
      tags: ['Comparison'],
      body: {
        type: 'object',
        properties: {
          job_ids: {
            type: 'array',
            minItems: 2,
            maxItems: 10,
            items: { type: 'string', format: 'uuid' }
          },
          metrics: {
            type: 'array',
            items: { type: 'string' }
          },
          group_by: {
            type: 'string',
            enum: ['model', 'prompt', 'metric'],
            default: 'model'
          }
        },
        required: ['job_ids']
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object' }
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
      const comparisonRequest = request.body as any;
      const result = await comparisonService.compareJobs(comparisonRequest);
      
      if (result.success) {
        reply.send(result);
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

  // Get model performance leaderboard
  fastify.get('/compare/leaderboard', {
    schema: {
      description: 'Get model performance leaderboard across all evaluations',
      tags: ['Comparison'],
      querystring: {
        type: 'object',
        properties: {
          metric: { 
            type: 'string',
            description: 'Metric to rank by (e.g., bleu, exact_match, overall_score)'
          },
          limit: { 
            type: 'integer', 
            minimum: 1, 
            maximum: 100, 
            default: 20 
          },
          providers: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter by model providers'
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
                metric: { type: 'string' },
                updated_at: { type: 'string' },
                rankings: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      rank: { type: 'integer' },
                      model_id: { type: 'string' },
                      provider: { type: 'string' },
                      score: { type: 'number' },
                      evaluations_count: { type: 'integer' },
                      avg_latency_ms: { type: 'number' },
                      avg_cost_per_1k_tokens: { type: 'number' }
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
    const { metric, limit = 20, providers } = request.query as any;
    const result = await comparisonService.getLeaderboard(metric);
    
    if (result.success && providers) {
      // Filter by providers if specified
      result.data.rankings = result.data.rankings
        .filter((ranking: any) => providers.includes(ranking.provider))
        .slice(0, limit);
    } else if (result.success) {
      result.data.rankings = result.data.rankings.slice(0, limit);
    }

    reply.send(result);
  });

  // Compare specific models across different evaluations
  fastify.get('/compare/models', {
    schema: {
      description: 'Compare specific models across different evaluation jobs',
      tags: ['Comparison'],
      querystring: {
        type: 'object',
        properties: {
          model_ids: {
            type: 'array',
            items: { type: 'string' },
            minItems: 2,
            maxItems: 10
          },
          metrics: {
            type: 'array',
            items: { type: 'string' }
          },
          date_from: { type: 'string', format: 'date' },
          date_to: { type: 'string', format: 'date' }
        },
        required: ['model_ids']
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                models_compared: {
                  type: 'array',
                  items: { type: 'string' }
                },
                comparison_matrix: { type: 'object' },
                statistical_significance: { type: 'object' }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { model_ids, metrics, date_from, date_to } = request.query as any;

    // For now, return a sample comparison structure
    // In a real implementation, this would load and analyze actual data
    const comparison = {
      models_compared: model_ids,
      metrics_analyzed: metrics || ['bleu', 'exact_match', 'latency', 'cost'],
      date_range: {
        from: date_from,
        to: date_to
      },
      comparison_matrix: generateComparisonMatrix(model_ids, metrics),
      statistical_significance: generateStatisticalSignificance(model_ids),
      generated_at: new Date().toISOString()
    };

    reply.send({
      success: true,
      data: comparison
    });
  });

  // Get evaluation trends over time
  fastify.get('/compare/trends', {
    schema: {
      description: 'Get evaluation performance trends over time',
      tags: ['Comparison'],
      querystring: {
        type: 'object',
        properties: {
          models: {
            type: 'array',
            items: { type: 'string' }
          },
          metrics: {
            type: 'array',
            items: { type: 'string' }
          },
          period: {
            type: 'string',
            enum: ['day', 'week', 'month'],
            default: 'week'
          },
          date_from: { type: 'string', format: 'date' },
          date_to: { type: 'string', format: 'date' }
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
                period: { type: 'string' },
                date_range: {
                  type: 'object',
                  properties: {
                    from: { type: 'string' },
                    to: { type: 'string' }
                  }
                },
                trends: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      date: { type: 'string' },
                      model_performances: { type: 'object' }
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
    const { models, metrics, period = 'week', date_from, date_to } = request.query as any;

    // Generate sample trend data
    const trends = generateTrendData(models, metrics, period, date_from, date_to);

    reply.send({
      success: true,
      data: {
        period,
        date_range: {
          from: date_from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          to: date_to || new Date().toISOString().split('T')[0]
        },
        trends,
        generated_at: new Date().toISOString()
      }
    });
  });

  // Export comparison report
  fastify.get('/compare/export', {
    schema: {
      description: 'Export comparison report in various formats',
      tags: ['Comparison'],
      querystring: {
        type: 'object',
        properties: {
          job_ids: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
            minItems: 2
          },
          format: {
            type: 'string',
            enum: ['json', 'csv', 'html'],
            default: 'json'
          },
          template: {
            type: 'string',
            enum: ['detailed', 'summary', 'executive'],
            default: 'detailed'
          }
        },
        required: ['job_ids']
      }
    }
  }, async (request, reply) => {
    const { job_ids, format = 'json', template = 'detailed' } = request.query as any;

    const comparisonRequest = {
      job_ids,
      group_by: 'model' as const
    };

    const result = await comparisonService.compareJobs(comparisonRequest);

    if (!result.success) {
      reply.code(400).send(result);
      return;
    }

    const filename = `comparison-report-${Date.now()}.${format}`;

    if (format === 'json') {
      reply
        .header('Content-Type', 'application/json')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(JSON.stringify(result.data, null, 2));
    } else if (format === 'csv') {
      const csvData = convertComparisonToCsv(result.data);
      reply
        .header('Content-Type', 'text/csv')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(csvData);
    } else if (format === 'html') {
      const htmlReport = generateHtmlReport(result.data, template);
      reply
        .header('Content-Type', 'text/html')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(htmlReport);
    }
  });
}

/**
 * Generate comparison matrix for models
 */
function generateComparisonMatrix(modelIds: string[], metrics?: string[]) {
  const matrix: Record<string, Record<string, any>> = {};

  for (const model1 of modelIds) {
    matrix[model1] = {};
    for (const model2 of modelIds) {
      if (model1 !== model2) {
        matrix[model1][model2] = {
          better_metrics: Math.floor(Math.random() * 3),
          worse_metrics: Math.floor(Math.random() * 3),
          win_rate: Math.random(),
          avg_score_difference: (Math.random() - 0.5) * 0.2
        };
      }
    }
  }

  return matrix;
}

/**
 * Generate statistical significance data
 */
function generateStatisticalSignificance(modelIds: string[]) {
  const significance: Record<string, any> = {};

  for (const modelId of modelIds) {
    significance[modelId] = {
      confidence_interval: {
        lower: Math.random() * 0.8,
        upper: Math.random() * 0.2 + 0.8
      },
      p_value: Math.random() * 0.1,
      effect_size: Math.random() * 0.5
    };
  }

  return significance;
}

/**
 * Generate trend data over time
 */
function generateTrendData(models?: string[], metrics?: string[], period = 'week', dateFrom?: string, dateTo?: string) {
  const trends = [];
  const startDate = new Date(dateFrom || Date.now() - 30 * 24 * 60 * 60 * 1000);
  const endDate = new Date(dateTo || Date.now());
  const periodMs = period === 'day' ? 24 * 60 * 60 * 1000 : 
                   period === 'week' ? 7 * 24 * 60 * 60 * 1000 : 
                   30 * 24 * 60 * 60 * 1000;

  for (let date = startDate.getTime(); date <= endDate.getTime(); date += periodMs) {
    const currentDate = new Date(date);
    const modelPerformances: Record<string, any> = {};

    for (const model of models || ['gpt-4', 'claude-3', 'mixtral']) {
      modelPerformances[model] = {
        avg_score: 0.7 + Math.random() * 0.3,
        evaluation_count: Math.floor(Math.random() * 50) + 10,
        avg_latency: 1000 + Math.random() * 2000,
        avg_cost: Math.random() * 0.05
      };
    }

    trends.push({
      date: currentDate.toISOString().split('T')[0],
      model_performances: modelPerformances
    });
  }

  return trends;
}

/**
 * Convert comparison data to CSV format
 */
function convertComparisonToCsv(comparison: any): string {
  const headers = ['model_id', 'metric_name', 'score', 'job_id', 'job_name'];
  const rows = [headers.join(',')];

  for (const [modelId, modelData] of Object.entries(comparison.data || {})) {
    const model = modelData as any;
    for (const job of model.jobs || []) {
      for (const [metricName, metricData] of Object.entries(job.metrics || {})) {
        const metric = metricData as any;
        rows.push([
          modelId,
          metricName,
          metric.score,
          job.job_id,
          job.job_name
        ].join(','));
      }
    }
  }

  return rows.join('\n');
}

/**
 * Generate HTML report
 */
function generateHtmlReport(comparison: any, template: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
    <title>TrustLLM Comparison Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1, h2 { color: #333; }
        table { border-collapse: collapse; width: 100%; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
        th { background-color: #f2f2f2; }
        .metric-score { font-weight: bold; }
        .summary { background-color: #f9f9f9; padding: 20px; border-radius: 5px; margin: 20px 0; }
    </style>
</head>
<body>
    <h1>TrustLLM Evaluation Comparison Report</h1>
    <div class="summary">
        <h2>Summary</h2>
        <p>Generated on: ${new Date().toISOString()}</p>
        <p>Jobs compared: ${comparison.jobs_compared?.map((j: any) => j.name).join(', ')}</p>
        <p>Comparison type: ${comparison.comparison_type}</p>
    </div>
    
    <h2>Model Performance Comparison</h2>
    <table>
        <thead>
            <tr>
                <th>Model ID</th>
                <th>Average Score</th>
                <th>Evaluations</th>
                <th>Avg Latency (ms)</th>
                <th>Avg Cost (USD)</th>
            </tr>
        </thead>
        <tbody>
            ${Object.entries(comparison.data || {}).map(([modelId, data]: [string, any]) => `
                <tr>
                    <td>${modelId}</td>
                    <td class="metric-score">${data.performance_summary?.avg_success_rate?.toFixed(3) || 'N/A'}</td>
                    <td>${data.performance_summary?.total_evaluations || 0}</td>
                    <td>${data.performance_summary?.avg_latency?.toFixed(0) || 'N/A'}</td>
                    <td>${data.performance_summary?.avg_cost?.toFixed(4) || 'N/A'}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
</body>
</html>
  `;
}
