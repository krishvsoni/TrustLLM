import { readFile } from 'fs/promises';
import { join } from 'path';
import type { 
  ComparisonRequest, 
  ApiResponse, 
  EvaluationJob,
  ModelResult 
} from '../types/index.js';

export class ComparisonService {
  private readonly resultsDir: string;

  constructor() {
    const workspaceRoot = process.env.WORKSPACE_ROOT || join(process.cwd(), '..');
    this.resultsDir = join(workspaceRoot, 'eval', 'results');
  }

  /**
   * Compare multiple evaluation jobs
   */
  async compareJobs(request: ComparisonRequest): Promise<ApiResponse<any>> {
    try {
      // Load all job results
      const jobs = await Promise.all(
        request.job_ids.map(id => this.loadJobWithResults(id))
      );

      // Filter out any null results
      const validJobs = jobs.filter(job => job !== null) as EvaluationJob[];

      if (validJobs.length < 2) {
        return {
          success: false,
          error: 'At least 2 valid jobs required for comparison',
          code: 'INSUFFICIENT_JOBS'
        };
      }

      // Perform comparison based on group_by parameter
      const comparison = this.generateComparison(validJobs, request);

      return {
        success: true,
        data: comparison
      };

    } catch (error) {
      return {
        success: false,
        error: `Failed to compare jobs: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'COMPARISON_FAILED'
      };
    }
  }

  /**
   * Generate model performance leaderboard
   */
  async getLeaderboard(metricName?: string): Promise<ApiResponse<any>> {
    try {
      // This would aggregate data across all completed jobs
      // For now, we'll return a sample leaderboard structure
      
      const leaderboard = {
        metric: metricName || 'overall_score',
        updated_at: new Date().toISOString(),
        rankings: [
          {
            rank: 1,
            model_id: 'gpt-4',
            provider: 'openai',
            score: 0.95,
            evaluations_count: 150,
            avg_latency_ms: 2500,
            avg_cost_per_1k_tokens: 0.03
          },
          {
            rank: 2,
            model_id: 'claude-3-opus',
            provider: 'anthropic',
            score: 0.92,
            evaluations_count: 120,
            avg_latency_ms: 3200,
            avg_cost_per_1k_tokens: 0.015
          },
          {
            rank: 3,
            model_id: 'mixtral-8x7b',
            provider: 'together',
            score: 0.88,
            evaluations_count: 200,
            avg_latency_ms: 1800,
            avg_cost_per_1k_tokens: 0.002
          }
        ]
      };

      return {
        success: true,
        data: leaderboard
      };

    } catch (error) {
      return {
        success: false,
        error: `Failed to generate leaderboard: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'LEADERBOARD_FAILED'
      };
    }
  }

  /**
   * Load job data with results
   */
  private async loadJobWithResults(jobId: string): Promise<EvaluationJob | null> {
    try {
      const jobPath = join(this.resultsDir, 'jobs', `${jobId}.json`);
      const resultsPath = join(this.resultsDir, 'results', `${jobId}.json`);

      const [jobData, resultsData] = await Promise.all([
        readFile(jobPath, 'utf-8'),
        readFile(resultsPath, 'utf-8').catch(() => null)
      ]);

      const job = JSON.parse(jobData) as EvaluationJob;
      
      if (resultsData) {
        job.results = JSON.parse(resultsData);
        job.status = 'completed';
      }

      return job;

    } catch (error) {
      console.error(`Failed to load job ${jobId}:`, error);
      return null;
    }
  }

  /**
   * Generate comparison data based on grouping preference
   */
  private generateComparison(jobs: EvaluationJob[], request: ComparisonRequest) {
    const comparison = {
      jobs_compared: jobs.map(j => ({ id: j.id, name: j.name })),
      comparison_type: request.group_by,
      metrics_included: request.metrics || ['all'],
      generated_at: new Date().toISOString(),
      data: {} as any
    };

    switch (request.group_by) {
      case 'model':
        comparison.data = this.compareByModel(jobs, request.metrics);
        break;
      case 'prompt':
        comparison.data = this.compareByPrompt(jobs, request.metrics);
        break;
      case 'metric':
        comparison.data = this.compareByMetric(jobs, request.metrics);
        break;
    }

    return comparison;
  }

  /**
   * Compare jobs grouped by model
   */
  private compareByModel(jobs: EvaluationJob[], metrics?: string[]) {
    const modelComparison: Record<string, any> = {};

    for (const job of jobs) {
      if (!job.results) continue;

      for (const [modelId, modelResult] of Object.entries(job.results.model_results)) {
        if (!modelComparison[modelId]) {
          modelComparison[modelId] = {
            model_id: modelId,
            jobs: [],
            aggregated_metrics: {},
            performance_summary: {
              avg_latency: 0,
              avg_cost: 0,
              avg_success_rate: 0,
              total_evaluations: 0
            }
          };
        }

        modelComparison[modelId].jobs.push({
          job_id: job.id,
          job_name: job.name,
          metrics: modelResult.metrics,
          performance: modelResult.performance
        });
      }
    }

    // Calculate aggregated metrics for each model
    for (const model of Object.values(modelComparison)) {
      this.calculateAggregatedMetrics(model as any);
    }

    return modelComparison;
  }

  /**
   * Compare jobs grouped by prompt
   */
  private compareByPrompt(jobs: EvaluationJob[], metrics?: string[]) {
    const promptComparison: Record<string, any> = {};

    for (const job of jobs) {
      for (const prompt of job.prompts) {
        if (!promptComparison[prompt.id]) {
          promptComparison[prompt.id] = {
            prompt_id: prompt.id,
            prompt_text: prompt.text.substring(0, 100) + '...',
            category: prompt.category,
            model_performances: []
          };
        }

        if (job.results) {
          for (const [modelId, modelResult] of Object.entries(job.results.model_results)) {
            const promptOutput = modelResult.outputs.find(o => o.prompt_id === prompt.id);
            if (promptOutput) {
              promptComparison[prompt.id].model_performances.push({
                job_id: job.id,
                model_id: modelId,
                output: promptOutput,
                metrics: this.extractPromptMetrics(modelResult.metrics, prompt.id)
              });
            }
          }
        }
      }
    }

    return promptComparison;
  }

  /**
   * Compare jobs grouped by metric
   */
  private compareByMetric(jobs: EvaluationJob[], metrics?: string[]) {
    const metricComparison: Record<string, any> = {};

    for (const job of jobs) {
      if (!job.results) continue;

      for (const [modelId, modelResult] of Object.entries(job.results.model_results)) {
        for (const [metricName, metricResult] of Object.entries(modelResult.metrics)) {
          if (metrics && !metrics.includes(metricName)) continue;

          if (!metricComparison[metricName]) {
            metricComparison[metricName] = {
              metric_name: metricName,
              model_scores: []
            };
          }

          metricComparison[metricName].model_scores.push({
            job_id: job.id,
            job_name: job.name,
            model_id: modelId,
            score: metricResult.score,
            details: metricResult.details
          });
        }
      }
    }

    return metricComparison;
  }

  /**
   * Calculate aggregated metrics for a model across multiple jobs
   */
  private calculateAggregatedMetrics(model: any) {
    if (model.jobs.length === 0) return;

    let totalLatency = 0;
    let totalCost = 0;
    let totalSuccessRate = 0;
    let totalEvaluations = 0;

    for (const job of model.jobs) {
      totalLatency += job.performance.average_latency_ms;
      totalCost += job.performance.total_cost_usd;
      totalSuccessRate += job.performance.success_rate;
      totalEvaluations += job.performance.total_tokens;
    }

    model.performance_summary = {
      avg_latency: totalLatency / model.jobs.length,
      avg_cost: totalCost / model.jobs.length,
      avg_success_rate: totalSuccessRate / model.jobs.length,
      total_evaluations: totalEvaluations
    };
  }

  /**
   * Extract metrics for a specific prompt from model results
   */
  private extractPromptMetrics(metrics: Record<string, any>, promptId: string) {
    const promptMetrics: Record<string, number> = {};
    
    for (const [metricName, metricResult] of Object.entries(metrics)) {
      if (metricResult.per_prompt_scores && metricResult.per_prompt_scores[promptId] !== undefined) {
        promptMetrics[metricName] = metricResult.per_prompt_scores[promptId];
      }
    }

    return promptMetrics;
  }
}
