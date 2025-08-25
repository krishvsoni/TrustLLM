import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { 
  EvaluationRequest, 
  EvaluationJob, 
  JobStatus,
  ApiResponse 
} from '../types/index.js';

const execFileAsync = promisify(execFile);

export class RustEvalService {
  private readonly evalBinaryPath: string;
  private readonly workspaceRoot: string;
  private readonly resultsDir: string;

  constructor() {
    // Adjust paths based on your workspace structure
    this.workspaceRoot = process.env.WORKSPACE_ROOT || join(process.cwd(), '..');
    this.evalBinaryPath = join(this.workspaceRoot, 'eval', 'target', 'debug', 'eval.exe');
    this.resultsDir = join(this.workspaceRoot, 'eval', 'results');
  }

  /**
   * Start a new evaluation job
   */
  async startEvaluation(request: EvaluationRequest): Promise<ApiResponse<{ job_id: string }>> {
    try {
      const jobId = uuidv4();
      
      // Create configuration file for Rust backend
      const configPath = await this.createConfigFile(jobId, request);
      
      // Execute the Rust evaluation binary
      const { stdout, stderr } = await execFileAsync(this.evalBinaryPath, [
        'run',
        '--config', configPath,
        '--output', this.resultsDir
      ]);

      if (stderr && stderr.includes('error')) {
        throw new Error(`Rust evaluation failed: ${stderr}`);
      }

      return {
        success: true,
        data: { job_id: jobId },
        message: 'Evaluation job started successfully'
      };

    } catch (error) {
      return {
        success: false,
        error: `Failed to start evaluation: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'EVAL_START_FAILED'
      };
    }
  }

  /**
   * Get job status and results
   */
  async getJobResults(jobId: string): Promise<ApiResponse<EvaluationJob>> {
    try {
      // Check for results file
      const resultsPath = join(this.resultsDir, 'results', `${jobId}.json`);
      const jobPath = join(this.resultsDir, 'jobs', `${jobId}.json`);
      
      try {
        const [resultsData, jobData] = await Promise.all([
          readFile(resultsPath, 'utf-8').catch(() => null),
          readFile(jobPath, 'utf-8').catch(() => null)
        ]);

        if (!jobData) {
          return {
            success: false,
            error: 'Job not found',
            code: 'JOB_NOT_FOUND'
          };
        }

        const job = JSON.parse(jobData) as EvaluationJob;
        
        if (resultsData) {
          const results = JSON.parse(resultsData);
          job.results = results;
          job.status = 'completed';
          job.completed_at = results.completed_at;
        } else {
          // Check if job is still running by looking at logs
          job.status = await this.getJobStatus(jobId);
        }

        return {
          success: true,
          data: job
        };

      } catch (fileError) {
        return {
          success: false,
          error: 'Failed to read job data',
          code: 'READ_ERROR'
        };
      }

    } catch (error) {
      return {
        success: false,
        error: `Failed to get job results: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'GET_RESULTS_FAILED'
      };
    }
  }

  /**
   * List all evaluation jobs
   */
  async listJobs(): Promise<ApiResponse<EvaluationJob[]>> {
    try {
      const { stdout } = await execFileAsync(this.evalBinaryPath, ['list-jobs']);
      
      // Parse the output to get job information
      const jobs: EvaluationJob[] = [];
      
      // This would need to be implemented based on the actual output format
      // For now, we'll try to read from the jobs directory
      const jobsDir = join(this.resultsDir, 'jobs');
      const { readdir } = await import('fs/promises');
      
      try {
        const jobFiles = await readdir(jobsDir);
        
        for (const file of jobFiles) {
          if (file.endsWith('.json')) {
            const jobData = await readFile(join(jobsDir, file), 'utf-8');
            const job = JSON.parse(jobData) as EvaluationJob;
            jobs.push(job);
          }
        }
      } catch {
        // Jobs directory might not exist yet
      }

      return {
        success: true,
        data: jobs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      };

    } catch (error) {
      return {
        success: false,
        error: `Failed to list jobs: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'LIST_JOBS_FAILED'
      };
    }
  }

  /**
   * Get available metrics from Rust backend
   */
  async getAvailableMetrics(): Promise<ApiResponse<string[]>> {
    try {
      const { stdout } = await execFileAsync(this.evalBinaryPath, ['list-metrics']);
      
      // Parse the metrics from stdout (would need to match actual format)
      const metrics = [
        'bleu',
        'rouge', 
        'exact_match',
        'embedding_similarity',
        'latency',
        'cost',
        'toxicity',
        'hallucination'
      ];

      return {
        success: true,
        data: metrics
      };

    } catch (error) {
      return {
        success: false,
        error: `Failed to get metrics: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'GET_METRICS_FAILED'
      };
    }
  }

  /**
   * Get available model providers from Rust backend
   */
  async getAvailableProviders(): Promise<ApiResponse<string[]>> {
    try {
      const { stdout } = await execFileAsync(this.evalBinaryPath, ['list-providers']);
      
      // Parse providers from stdout (would need to match actual format)
      const providers = [
        'openai',
        'anthropic',
        'together',
        'huggingface',
        'local'
      ];

      return {
        success: true,
        data: providers
      };

    } catch (error) {
      return {
        success: false,
        error: `Failed to get providers: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'GET_PROVIDERS_FAILED'
      };
    }
  }

  /**
   * Create configuration file for Rust backend
   */
  private async createConfigFile(jobId: string, request: EvaluationRequest): Promise<string> {
    const config = {
      name: request.name,
      prompts: Object.fromEntries(
        request.prompts.map(p => [p.id, {
          text: p.text,
          expected_output: p.expected_output,
          category: p.category,
          metadata: p.metadata || {}
        }])
      ),
      models: Object.fromEntries(
        request.models.map(m => [m.id, {
          provider: m.provider,
          model_name: m.model_name,
          parameters: m.parameters || {},
          api_key: m.api_key,
          endpoint: m.endpoint
        }])
      ),
      metrics: Object.fromEntries(
        request.metrics.map(m => [m.name, {
          enabled: m.enabled,
          weight: m.weight,
          parameters: m.parameters || {}
        }])
      ),
      config: {
        parallel_requests: request.config?.parallel_requests || 5,
        timeout_seconds: request.config?.timeout_seconds || 120,
        retry_attempts: request.config?.retry_attempts || 3
      }
    };

    const configDir = join(this.resultsDir, 'configs');
    await mkdir(configDir, { recursive: true });
    
    const configPath = join(configDir, `${jobId}.json`);
    await writeFile(configPath, JSON.stringify(config, null, 2));

    // Also save job metadata
    const jobsDir = join(this.resultsDir, 'jobs');
    await mkdir(jobsDir, { recursive: true });
    
    const job: EvaluationJob = {
      id: jobId,
      name: request.name,
      status: 'pending',
      created_at: new Date().toISOString(),
      prompts: request.prompts,
      models: request.models,
      metrics: request.metrics,
      config: {
        parallel_requests: request.config?.parallel_requests || 5,
        timeout_seconds: request.config?.timeout_seconds || 120,
        retry_attempts: request.config?.retry_attempts || 3
      }
    };

    const jobPath = join(jobsDir, `${jobId}.json`);
    await writeFile(jobPath, JSON.stringify(job, null, 2));

    return configPath;
  }

  /**
   * Determine job status by checking files and logs
   */
  private async getJobStatus(jobId: string): Promise<JobStatus> {
    try {
      const resultsPath = join(this.resultsDir, 'results', `${jobId}.json`);
      const { access } = await import('fs/promises');
      
      await access(resultsPath);
      return 'completed';
    } catch {
      // No results file, check if it's running or failed
      // This is a simplified implementation
      return 'running';
    }
  }
}
