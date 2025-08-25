import { z } from 'zod';

// Job Status enum
export const JobStatus = z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']);
export type JobStatus = z.infer<typeof JobStatus>;

// Prompt schema
export const PromptSchema = z.object({
  id: z.string(),
  text: z.string(),
  expected_output: z.string().optional(),
  category: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});
export type Prompt = z.infer<typeof PromptSchema>;

// Model configuration schema
export const ModelConfigSchema = z.object({
  id: z.string(),
  provider: z.string(),
  model_name: z.string(),
  parameters: z.object({
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().positive().optional(),
    top_p: z.number().min(0).max(1).optional(),
    frequency_penalty: z.number().min(-2).max(2).optional(),
    presence_penalty: z.number().min(-2).max(2).optional(),
  }).optional(),
  api_key: z.string().optional(),
  endpoint: z.string().url().optional(),
});
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

// Metric configuration schema
export const MetricConfigSchema = z.object({
  name: z.string(),
  enabled: z.boolean().default(true),
  weight: z.number().min(0).max(1).default(1),
  parameters: z.record(z.any()).optional(),
});
export type MetricConfig = z.infer<typeof MetricConfigSchema>;

// Evaluation request schema
export const EvaluationRequestSchema = z.object({
  name: z.string().min(1),
  prompts: z.array(PromptSchema).min(1),
  models: z.array(ModelConfigSchema).min(1),
  metrics: z.array(MetricConfigSchema).min(1),
  config: z.object({
    parallel_requests: z.number().positive().default(5),
    timeout_seconds: z.number().positive().default(120),
    retry_attempts: z.number().min(0).default(3),
  }).optional(),
});
export type EvaluationRequest = z.infer<typeof EvaluationRequestSchema>;

// Metric result schema
export const MetricResultSchema = z.object({
  metric_name: z.string(),
  score: z.number(),
  details: z.record(z.any()),
  per_prompt_scores: z.record(z.number()),
});
export type MetricResult = z.infer<typeof MetricResultSchema>;

// Model output schema
export const ModelOutputSchema = z.object({
  prompt_id: z.string(),
  text: z.string(),
  latency_ms: z.number(),
  tokens_used: z.number(),
  cost_usd: z.number(),
  error: z.string().optional(),
});
export type ModelOutput = z.infer<typeof ModelOutputSchema>;

// Performance metrics schema
export const PerformanceMetricsSchema = z.object({
  total_latency_ms: z.number(),
  average_latency_ms: z.number(),
  total_tokens: z.number(),
  total_cost_usd: z.number(),
  success_rate: z.number().min(0).max(1),
  throughput_per_second: z.number(),
});
export type PerformanceMetrics = z.infer<typeof PerformanceMetricsSchema>;

// Model result schema
export const ModelResultSchema = z.object({
  model_id: z.string(),
  outputs: z.array(ModelOutputSchema),
  metrics: z.record(MetricResultSchema),
  performance: PerformanceMetricsSchema,
  errors: z.array(z.object({
    error_type: z.string(),
    message: z.string(),
    prompt_id: z.string(),
    timestamp: z.string(),
    context: z.record(z.any()),
  })),
});
export type ModelResult = z.infer<typeof ModelResultSchema>;

// Evaluation job schema
export const EvaluationJobSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: JobStatus,
  created_at: z.string().datetime(),
  completed_at: z.string().datetime().optional(),
  prompts: z.array(PromptSchema),
  models: z.array(ModelConfigSchema),
  metrics: z.array(MetricConfigSchema),
  results: z.object({
    job_id: z.string().uuid(),
    completed_at: z.string().datetime().optional(),
    model_results: z.record(ModelResultSchema),
    summary: z.object({
      total_prompts: z.number(),
      total_models: z.number(),
      total_evaluations: z.number(),
      success_rate: z.number().min(0).max(1),
      average_score: z.number(),
      total_cost_usd: z.number(),
      total_latency_ms: z.number(),
    }),
  }).optional(),
  config: z.object({
    parallel_requests: z.number().positive(),
    timeout_seconds: z.number().positive(),
    retry_attempts: z.number().min(0),
  }),
});
export type EvaluationJob = z.infer<typeof EvaluationJobSchema>;

// API Response schemas
export const SuccessResponseSchema = z.object({
  success: z.literal(true),
  data: z.any(),
  message: z.string().optional(),
});

export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  code: z.string().optional(),
  details: z.any().optional(),
});

export type ApiResponse<T = any> = 
  | { success: true; data: T; message?: string }
  | { success: false; error: string; code?: string; details?: any };

// Comparison request schema
export const ComparisonRequestSchema = z.object({
  job_ids: z.array(z.string().uuid()).min(2).max(10),
  metrics: z.array(z.string()).optional(),
  group_by: z.enum(['model', 'prompt', 'metric']).default('model'),
});
export type ComparisonRequest = z.infer<typeof ComparisonRequestSchema>;
