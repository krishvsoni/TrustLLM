use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;

use crate::types::{ModelConfig, MetricConfig, Prompt};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvalConfig {
    pub job_name: String,
    pub prompts: HashMap<String, Prompt>,
    pub models: HashMap<String, ModelConfig>,
    pub metrics: HashMap<String, MetricConfig>,
    pub settings: EvalSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvalSettings {
    pub parallel_requests: usize,
    pub timeout_seconds: u64,
    pub retry_attempts: u32,
    pub output_format: OutputFormat,
    pub logging_level: LoggingLevel,
    pub verification_enabled: bool,
    pub cost_tracking_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OutputFormat {
    Json,
    Csv,
    Yaml,
    Html,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LoggingLevel {
    Error,
    Warn,
    Info,
    Debug,
    Trace,
}

impl Default for EvalSettings {
    fn default() -> Self {
        Self {
            parallel_requests: 5,
            timeout_seconds: 30,
            retry_attempts: 3,
            output_format: OutputFormat::Json,
            logging_level: LoggingLevel::Info,
            verification_enabled: true,
            cost_tracking_enabled: true,
        }
    }
}

impl EvalConfig {
    pub fn load(path: &str) -> Result<Self> {
        let content = fs::read_to_string(path)
            .with_context(|| format!("Failed to read config file: {}", path))?;
        
        let config: EvalConfig = if path.ends_with(".yaml") || path.ends_with(".yml") {
            serde_yaml::from_str(&content)
                .with_context(|| "Failed to parse YAML config")?
        } else {
            serde_json::from_str(&content)
                .with_context(|| "Failed to parse JSON config")?
        };
        
        config.validate()?;
        Ok(config)
    }
    
    pub fn save(&self, path: &str) -> Result<()> {
        let content = if path.ends_with(".yaml") || path.ends_with(".yml") {
            serde_yaml::to_string(self)
                .with_context(|| "Failed to serialize config to YAML")?
        } else {
            serde_json::to_string_pretty(self)
                .with_context(|| "Failed to serialize config to JSON")?
        };
        
        fs::write(path, content)
            .with_context(|| format!("Failed to write config file: {}", path))?;
        
        Ok(())
    }
    
    pub fn validate(&self) -> Result<()> {
        if self.job_name.is_empty() {
            anyhow::bail!("Job name cannot be empty");
        }
        
        if self.prompts.is_empty() {
            anyhow::bail!("At least one prompt must be specified");
        }
        
        if self.models.is_empty() {
            anyhow::bail!("At least one model must be specified");
        }
        
        if self.metrics.is_empty() {
            anyhow::bail!("At least one metric must be specified");
        }
        
        // Validate model configurations
        for (id, model) in &self.models {
            if model.model_name.is_empty() {
                anyhow::bail!("Model '{}' has empty model_name", id);
            }
            if model.provider.is_empty() {
                anyhow::bail!("Model '{}' has empty provider", id);
            }
        }
        
        // Validate prompts
        for (id, prompt) in &self.prompts {
            if prompt.text.is_empty() {
                anyhow::bail!("Prompt '{}' has empty text", id);
            }
        }
        
        Ok(())
    }
    
    /// Create a sample configuration for testing
    pub fn sample() -> Self {
        use crate::types::{MetricType, ModelParameters};
        
        let mut prompts = HashMap::new();
        prompts.insert("test_prompt_1".to_string(), Prompt {
            id: "test_prompt_1".to_string(),
            text: "Explain the concept of machine learning in simple terms.".to_string(),
            expected_output: Some("Machine learning is a type of artificial intelligence that enables computers to learn and make decisions from data without being explicitly programmed for every task.".to_string()),
            category: Some("explanation".to_string()),
            metadata: HashMap::new(),
        });
        
        prompts.insert("test_prompt_2".to_string(), Prompt {
            id: "test_prompt_2".to_string(),
            text: "Write a short story about a robot learning to paint.".to_string(),
            expected_output: None,
            category: Some("creative_writing".to_string()),
            metadata: HashMap::new(),
        });
        
        let mut models = HashMap::new();
        models.insert("gpt-3.5".to_string(), ModelConfig {
            id: "gpt-3.5".to_string(),
            provider: "openai".to_string(),
            model_name: "gpt-3.5-turbo".to_string(),
            parameters: ModelParameters::default(),
            api_key: None,
            endpoint: None,
        });
        
        models.insert("groq-llama".to_string(), ModelConfig {
            id: "groq-llama".to_string(),
            provider: "groq".to_string(),
            model_name: "llama-3.1-70b-versatile".to_string(),
            parameters: ModelParameters::default(),
            api_key: None,
            endpoint: None,
        });
        
        let mut metrics = HashMap::new();
        metrics.insert("bleu".to_string(), MetricConfig {
            name: "bleu".to_string(),
            metric_type: MetricType::Bleu,
            parameters: HashMap::new(),
            weight: Some(1.0),
        });
        
        metrics.insert("latency".to_string(), MetricConfig {
            name: "latency".to_string(),
            metric_type: MetricType::Latency,
            parameters: HashMap::new(),
            weight: Some(0.5),
        });
        
        Self {
            job_name: "Sample Evaluation Job".to_string(),
            prompts,
            models,
            metrics,
            settings: EvalSettings::default(),
        }
    }
}
