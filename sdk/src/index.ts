import axios from 'axios';
import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { EventEmitter } from 'eventemitter3';

// Type definitions
export interface EvaluationConfig {
  name: string;
  prompts: Prompt[];
  models: ModelConfig[];
  metrics: MetricConfig[];
  config?: {
    parallel_requests?: number;
    timeout_seconds?: number;
    retry_attempts?: number;
  };
}

export interface Prompt {
  id: string;
  text: string;
  expected_output?: string;
  category?: string;
  metadata?: Record<string, any>;
}

export interface ModelConfig {
  id: string;
  provider: string;
  model_name: string;
  parameters?: {
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
  };
  api_key?: string;
  endpoint?: string;
}

export interface MetricConfig {
  name: string;
  enabled?: boolean;
  weight?: number;
  parameters?: Record<string, any>;
}

export interface EvaluationJob {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  created_at: string;
  completed_at?: string;
  prompts: Prompt[];
  models: ModelConfig[];
  metrics: MetricConfig[];
  results?: EvaluationResults;
  config: {
    parallel_requests: number;
    timeout_seconds: number;
    retry_attempts: number;
  };
}

export interface EvaluationResults {
  job_id: string;
  completed_at?: string;
  model_results: Record<string, ModelResult>;
  summary: {
    total_prompts: number;
    total_models: number;
    total_evaluations: number;
    success_rate: number;
    average_score: number;
    total_cost_usd: number;
    total_latency_ms: number;
  };
}

export interface ModelResult {
  model_id: string;
  outputs: ModelOutput[];
  metrics: Record<string, MetricResult>;
  performance: PerformanceMetrics;
  errors: EvaluationError[];
}

export interface ModelOutput {
  prompt_id: string;
  text: string;
  latency_ms: number;
  tokens_used: number;
  cost_usd: number;
  error?: string;
}

export interface MetricResult {
  metric_name: string;
  score: number;
  details: Record<string, any>;
  per_prompt_scores: Record<string, number>;
}

export interface PerformanceMetrics {
  total_latency_ms: number;
  average_latency_ms: number;
  total_tokens: number;
  total_cost_usd: number;
  success_rate: number;
  throughput_per_second: number;
}

export interface EvaluationError {
  error_type: string;
  message: string;
  prompt_id: string;
  timestamp: string;
  context: Record<string, any>;
}

export interface ComparisonRequest {
  job_ids: string[];
  metrics?: string[];
  group_by?: 'model' | 'prompt' | 'metric';
}

export interface ClientOptions {
  baseURL?: string;
  apiKey?: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

export interface JobProgress {
  job_id: string;
  status: string;
  progress?: {
    completed_prompts: number;
    total_prompts: number;
    completed_models: number;
    total_models: number;
    percentage: number;
  };
}

/**
 * TrustLLM Client SDK
 * 
 * Main client for interacting with the TrustLLM Evaluation API
 */
export class TrustLLMClient extends EventEmitter {
  private readonly http: AxiosInstance;
  private readonly options: Required<ClientOptions>;

  constructor(options: ClientOptions = {}) {
    super();

    this.options = {
      baseURL: options.baseURL || process.env.TRUSTLLM_API_URL || 'http://localhost:3000/api/v1',
      apiKey: options.apiKey || process.env.TRUSTLLM_API_KEY || '',
      timeout: options.timeout || 30000,
      retryAttempts: options.retryAttempts || 3,
      retryDelay: options.retryDelay || 1000,
    };

    // Configure axios instance
    this.http = axios.create({
      baseURL: this.options.baseURL,
      timeout: this.options.timeout,
      headers: {
        'Content-Type': 'application/json',
        ...(this.options.apiKey && { 'Authorization': `Bearer ${this.options.apiKey}` }),
      },
    });

    // Add response interceptor for error handling
    this.http.interceptors.response.use(
      (response) => response,
      (error) => {
        this.emit('error', error);
        return Promise.reject(error);
      }
    );
  }

  /**
   * Run a new evaluation
   */
  async runEval(config: EvaluationConfig): Promise<string> {
    try {
      const response = await this.http.post('/eval/run', config);
      
      if (!response.data.success) {
        throw new Error(response.data.error);
      }

      const jobId = response.data.data.job_id;
      this.emit('jobStarted', { jobId, config });
      
      return jobId;
    } catch (error: any) {
      const message = error.response?.data?.error || error.message;
      throw new Error(`Failed to start evaluation: ${message}`);
    }
  }

  /**
   * Get evaluation job results
   */
  async getResults(jobId: string): Promise<EvaluationJob> {
    try {
      const response = await this.http.get(`/results/${jobId}`);
      
      if (!response.data.success) {
        throw new Error(response.data.error);
      }

      return response.data.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        throw new Error(`Job ${jobId} not found`);
      }
      const message = error.response?.data?.error || error.message;
      throw new Error(`Failed to get results: ${message}`);
    }
  }

  /**
   * Get job status and progress
   */
  async getJobStatus(jobId: string): Promise<JobProgress> {
    try {
      const response = await this.http.get(`/results/${jobId}/status`);
      
      if (!response.data.success) {
        throw new Error(response.data.error);
      }

      return response.data.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        throw new Error(`Job ${jobId} not found`);
      }
      const message = error.response?.data?.error || error.message;
      throw new Error(`Failed to get job status: ${message}`);
    }
  }

  /**
   * List evaluation jobs
   */
  async listJobs(options: {
    status?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<EvaluationJob[]> {
    try {
      const params = new URLSearchParams();
      if (options.status) params.append('status', options.status);
      if (options.limit) params.append('limit', options.limit.toString());
      if (options.offset) params.append('offset', options.offset.toString());

      const response = await this.http.get(`/eval/jobs?${params}`);
      
      if (!response.data.success) {
        throw new Error(response.data.error);
      }

      return response.data.data;
    } catch (error: any) {
      const message = error.response?.data?.error || error.message;
      throw new Error(`Failed to list jobs: ${message}`);
    }
  }

  /**
   * Compare multiple evaluation jobs
   */
  async compareJobs(request: ComparisonRequest): Promise<any> {
    try {
      const response = await this.http.post('/compare', request);
      
      if (!response.data.success) {
        throw new Error(response.data.error);
      }

      return response.data.data;
    } catch (error: any) {
      const message = error.response?.data?.error || error.message;
      throw new Error(`Failed to compare jobs: ${message}`);
    }
  }

  /**
   * Get model performance leaderboard
   */
  async getLeaderboard(options: {
    metric?: string;
    limit?: number;
    providers?: string[];
  } = {}): Promise<any> {
    try {
      const params = new URLSearchParams();
      if (options.metric) params.append('metric', options.metric);
      if (options.limit) params.append('limit', options.limit.toString());
      if (options.providers) {
        options.providers.forEach(provider => params.append('providers', provider));
      }

      const response = await this.http.get(`/compare/leaderboard?${params}`);
      
      if (!response.data.success) {
        throw new Error(response.data.error);
      }

      return response.data.data;
    } catch (error: any) {
      const message = error.response?.data?.error || error.message;
      throw new Error(`Failed to get leaderboard: ${message}`);
    }
  }

  /**
   * Get available metrics
   */
  async getAvailableMetrics(): Promise<string[]> {
    try {
      const response = await this.http.get('/eval/metrics');
      
      if (!response.data.success) {
        throw new Error(response.data.error);
      }

      return response.data.data;
    } catch (error: any) {
      const message = error.response?.data?.error || error.message;
      throw new Error(`Failed to get metrics: ${message}`);
    }
  }

  /**
   * Get available model providers
   */
  async getAvailableProviders(): Promise<string[]> {
    try {
      const response = await this.http.get('/eval/providers');
      
      if (!response.data.success) {
        throw new Error(response.data.error);
      }

      return response.data.data;
    } catch (error: any) {
      const message = error.response?.data?.error || error.message;
      throw new Error(`Failed to get providers: ${message}`);
    }
  }

  /**
   * Generate sample configuration
   */
  async getSampleConfig(): Promise<EvaluationConfig> {
    try {
      const response = await this.http.get('/eval/sample-config');
      
      if (!response.data.success) {
        throw new Error(response.data.error);
      }

      return response.data.data;
    } catch (error: any) {
      const message = error.response?.data?.error || error.message;
      throw new Error(`Failed to get sample config: ${message}`);
    }
  }

  /**
   * Wait for job completion with polling
   */
  async waitForCompletion(
    jobId: string, 
    options: {
      pollInterval?: number;
      timeout?: number;
      onProgress?: (progress: JobProgress) => void;
    } = {}
  ): Promise<EvaluationJob> {
    const pollInterval = options.pollInterval || 5000; // 5 seconds
    const timeout = options.timeout || 600000; // 10 minutes
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const status = await this.getJobStatus(jobId);
      
      if (options.onProgress) {
        options.onProgress(status);
      }

      this.emit('jobProgress', status);

      if (status.status === 'completed') {
        const results = await this.getResults(jobId);
        this.emit('jobCompleted', results);
        return results;
      }

      if (status.status === 'failed') {
        const error = new Error(`Job ${jobId} failed`);
        this.emit('jobFailed', { jobId, error });
        throw error;
      }

      if (status.status === 'cancelled') {
        const error = new Error(`Job ${jobId} was cancelled`);
        this.emit('jobCancelled', { jobId });
        throw error;
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    const error = new Error(`Job ${jobId} timed out after ${timeout}ms`);
    this.emit('jobTimeout', { jobId, timeout });
    throw error;
  }

  /**
   * Run evaluation and wait for completion
   */
  async runEvalAndWait(
    config: EvaluationConfig,
    options: {
      pollInterval?: number;
      timeout?: number;
      onProgress?: (progress: JobProgress) => void;
    } = {}
  ): Promise<EvaluationJob> {
    const jobId = await this.runEval(config);
    return this.waitForCompletion(jobId, options);
  }

  /**
   * Download results as file
   */
  async downloadResults(
    jobId: string,
    format: 'json' | 'csv' = 'json'
  ): Promise<string> {
    try {
      const response = await this.http.get(`/results/${jobId}/download`, {
        params: { format },
        responseType: 'text'
      });

      return response.data;
    } catch (error: any) {
      const message = error.response?.data?.error || error.message;
      throw new Error(`Failed to download results: ${message}`);
    }
  }

  /**
   * Health check
   */
  async health(): Promise<{ status: string; timestamp: string }> {
    try {
      // Adjust URL for health endpoint
      const response = await axios.get(`${this.options.baseURL.replace('/api/v1', '')}/health`);
      return response.data;
    } catch (error: any) {
      throw new Error(`Health check failed: ${error.message}`);
    }
  }
}

/**
 * Builder class for creating evaluation configurations
 */
export class EvaluationBuilder {
  private config: Partial<EvaluationConfig> = {
    prompts: [],
    models: [],
    metrics: []
  };

  /**
   * Set evaluation name
   */
  name(name: string): EvaluationBuilder {
    this.config.name = name;
    return this;
  }

  /**
   * Add a prompt
   */
  addPrompt(prompt: Prompt): EvaluationBuilder {
    this.config.prompts!.push(prompt);
    return this;
  }

  /**
   * Add multiple prompts
   */
  addPrompts(prompts: Prompt[]): EvaluationBuilder {
    this.config.prompts!.push(...prompts);
    return this;
  }

  /**
   * Add a model configuration
   */
  addModel(model: ModelConfig): EvaluationBuilder {
    this.config.models!.push(model);
    return this;
  }

  /**
   * Add multiple models
   */
  addModels(models: ModelConfig[]): EvaluationBuilder {
    this.config.models!.push(...models);
    return this;
  }

  /**
   * Add a metric
   */
  addMetric(metric: MetricConfig): EvaluationBuilder {
    this.config.metrics!.push(metric);
    return this;
  }

  /**
   * Add multiple metrics
   */
  addMetrics(metrics: MetricConfig[]): EvaluationBuilder {
    this.config.metrics!.push(...metrics);
    return this;
  }

  /**
   * Set configuration options
   */
  setConfig(config: NonNullable<EvaluationConfig['config']>): EvaluationBuilder {
    this.config.config = config;
    return this;
  }

  /**
   * Build the configuration
   */
  build(): EvaluationConfig {
    if (!this.config.name) {
      throw new Error('Evaluation name is required');
    }
    if (!this.config.prompts?.length) {
      throw new Error('At least one prompt is required');
    }
    if (!this.config.models?.length) {
      throw new Error('At least one model is required');
    }
    if (!this.config.metrics?.length) {
      throw new Error('At least one metric is required');
    }

    return this.config as EvaluationConfig;
  }
}

/**
 * Utility functions
 */
export const utils = {
  /**
   * Create a simple prompt
   */
  createPrompt(id: string, text: string, expectedOutput?: string): Prompt {
    return {
      id,
      text,
      expected_output: expectedOutput,
      category: 'general'
    };
  },

  /**
   * Create OpenAI model configuration
   */
  createOpenAIModel(
    id: string, 
    modelName: string = 'gpt-3.5-turbo', 
    apiKey?: string
  ): ModelConfig {
    return {
      id,
      provider: 'openai',
      model_name: modelName,
      parameters: {
        temperature: 0.7,
        max_tokens: 150
      },
      api_key: apiKey
    };
  },

  /**
   * Create Anthropic model configuration
   */
  createAnthropicModel(
    id: string,
    modelName: string = 'claude-3-sonnet-20240229',
    apiKey?: string
  ): ModelConfig {
    return {
      id,
      provider: 'anthropic',
      model_name: modelName,
      parameters: {
        temperature: 0.7,
        max_tokens: 150
      },
      api_key: apiKey
    };
  },

  /**
   * Create common metric configurations
   */
  createMetrics: {
    bleu: (weight: number = 1.0): MetricConfig => ({
      name: 'bleu',
      enabled: true,
      weight
    }),
    exactMatch: (weight: number = 1.0): MetricConfig => ({
      name: 'exact_match',
      enabled: true,
      weight
    }),
    latency: (weight: number = 0.3): MetricConfig => ({
      name: 'latency',
      enabled: true,
      weight
    }),
    cost: (weight: number = 0.2): MetricConfig => ({
      name: 'cost',
      enabled: true,
      weight
    })
  }
};

// Default export
export default TrustLLMClient;
