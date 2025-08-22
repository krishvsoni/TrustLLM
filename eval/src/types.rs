use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use chrono::{DateTime, Utc};
use uuid::Uuid;

/// Core types for the EaaS evaluation system
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvaluationJob {
    pub id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub status: JobStatus,
    pub prompts: Vec<Prompt>,
    pub models: Vec<ModelConfig>,
    pub metrics: Vec<MetricConfig>,
    pub results: Option<EvaluationResults>,
    pub metadata: JobMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum JobStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Prompt {
    pub id: String,
    pub text: String,
    pub expected_output: Option<String>,
    pub category: Option<String>,
    pub metadata: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    pub id: String,
    pub provider: String,
    pub model_name: String,
    pub parameters: ModelParameters,
    pub api_key: Option<String>,
    pub endpoint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelParameters {
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    pub top_p: Option<f32>,
    pub frequency_penalty: Option<f32>,
    pub presence_penalty: Option<f32>,
    pub stop_sequences: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricConfig {
    pub name: String,
    pub metric_type: MetricType,
    pub parameters: HashMap<String, serde_json::Value>,
    pub weight: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MetricType {
    Bleu,
    Rouge,
    ExactMatch,
    EmbeddingSimilarity,
    Latency,
    Cost,
    Toxicity,
    Custom(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvaluationResults {
    pub job_id: Uuid,
    pub completed_at: DateTime<Utc>,
    pub model_results: HashMap<String, ModelResults>,
    pub aggregate_scores: HashMap<String, f64>,
    pub summary: ResultSummary,
    pub verification_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelResults {
    pub model_id: String,
    pub outputs: Vec<ModelOutput>,
    pub metrics: HashMap<String, MetricResult>,
    pub performance: PerformanceMetrics,
    pub errors: Vec<EvaluationError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelOutput {
    pub prompt_id: String,
    pub output: String,
    pub metadata: OutputMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputMetadata {
    pub latency_ms: u64,
    pub token_count: Option<u32>,
    pub cost_usd: Option<f64>,
    pub timestamp: DateTime<Utc>,
    pub provider_metadata: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricResult {
    pub metric_name: String,
    pub score: f64,
    pub details: HashMap<String, serde_json::Value>,
    pub per_prompt_scores: HashMap<String, f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceMetrics {
    pub total_latency_ms: u64,
    pub average_latency_ms: f64,
    pub total_tokens: u32,
    pub total_cost_usd: f64,
    pub success_rate: f64,
    pub throughput_per_second: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvaluationError {
    pub error_type: ErrorType,
    pub message: String,
    pub prompt_id: Option<String>,
    pub timestamp: DateTime<Utc>,
    pub context: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ErrorType {
    NetworkError,
    AuthenticationError,
    RateLimitError,
    InvalidResponse,
    MetricCalculationError,
    ConfigurationError,
    UnknownError,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResultSummary {
    pub total_prompts: usize,
    pub successful_completions: usize,
    pub failed_completions: usize,
    pub best_performing_model: Option<String>,
    pub worst_performing_model: Option<String>,
    pub average_scores: HashMap<String, f64>,
    pub ranking: Vec<ModelRanking>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelRanking {
    pub model_id: String,
    pub overall_score: f64,
    pub rank: usize,
    pub strengths: Vec<String>,
    pub weaknesses: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobMetadata {
    pub user_id: Option<String>,
    pub project: Option<String>,
    pub tags: Vec<String>,
    pub description: Option<String>,
    pub environment: String,
    pub version: String,
}

impl Default for ModelParameters {
    fn default() -> Self {
        Self {
            temperature: Some(0.7),
            max_tokens: Some(1024),
            top_p: Some(1.0),
            frequency_penalty: Some(0.0),
            presence_penalty: Some(0.0),
            stop_sequences: None,
        }
    }
}

impl EvaluationJob {
    pub fn new(name: String, prompts: Vec<Prompt>, models: Vec<ModelConfig>, metrics: Vec<MetricConfig>) -> Self {
        Self {
            id: Uuid::new_v4(),
            name,
            created_at: Utc::now(),
            status: JobStatus::Pending,
            prompts,
            models,
            metrics,
            results: None,
            metadata: JobMetadata {
                user_id: None,
                project: None,
                tags: vec![],
                description: None,
                environment: "development".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
            },
        }
    }
}
