use anyhow::{Context, Result};
use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;
use std::collections::HashMap;
use std::time::{Duration, Instant};
use chrono::Utc;

use crate::types::{ModelConfig, ModelOutput, OutputMetadata, Prompt};

#[derive(Debug, Deserialize)]
struct TogetherAIResponse {
    choices: Vec<TogetherAIChoice>,
    usage: Option<TogetherAIUsage>,
    model: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TogetherAIChoice {
    text: Option<String>,
    message: Option<TogetherAIMessage>,
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TogetherAIMessage {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TogetherAIUsage {
    total_tokens: Option<u32>,
}

#[async_trait]
pub trait ModelProvider: Send + Sync {
    fn name(&self) -> &str;
    async fn generate(&self, prompt: &Prompt, config: &ModelConfig) -> Result<ModelOutput>;
    fn supports_model(&self, model_name: &str) -> bool;
    fn calculate_cost(&self, tokens: u32, model_name: &str) -> f64;
}

pub struct ModelRegistry {
    providers: HashMap<String, Box<dyn ModelProvider>>,
    client: Client,
}

impl ModelRegistry {
    pub fn new() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(60))
            .build()
            .expect("Failed to create HTTP client");
            
        let mut registry = Self {
            providers: HashMap::new(),
            client: client.clone(),
        };
        
        // Register built-in providers
        registry.register(Box::new(TogetherAIProvider::new(client.clone())));
        registry.register(Box::new(GroqProvider::new(client.clone())));
        registry.register(Box::new(CohereProvider::new(client.clone())));
        registry.register(Box::new(OpenRouterProvider::new(client.clone())));
        
        registry
    }
    
    pub fn register(&mut self, provider: Box<dyn ModelProvider>) {
        self.providers.insert(provider.name().to_string(), provider);
    }
    
    pub fn get(&self, name: &str) -> Option<&Box<dyn ModelProvider>> {
        self.providers.get(name)
    }
    
    pub fn list_providers(&self) -> Vec<String> {
        self.providers.keys().cloned().collect()
    }
    
    pub async fn generate(&self, prompt: &Prompt, config: &ModelConfig) -> Result<ModelOutput> {
        let provider = self.get(&config.provider)
            .with_context(|| format!("Provider '{}' not found", config.provider))?;
            
        provider.generate(prompt, config).await
    }
}

// Together AI Provider
pub struct TogetherAIProvider {
    client: Client,
}

impl TogetherAIProvider {
    pub fn new(client: Client) -> Self {
        Self { client }
    }
}

#[async_trait]
impl ModelProvider for TogetherAIProvider {
    fn name(&self) -> &str {
        "together"
    }
    
    async fn generate(&self, prompt: &Prompt, config: &ModelConfig) -> Result<ModelOutput> {
        let start_time = Instant::now();
        
        let api_key = config.api_key.as_ref()
            .cloned()
            .or_else(|| std::env::var("TOGETHER_API_KEY").ok())
            .with_context(|| "Together AI API key not found")?;
            
        let request_body = serde_json::json!({
            "model": config.model_name,
            "messages": [
                {
                    "role": "user",
                    "content": prompt.text
                }
            ],
            "temperature": config.parameters.temperature.unwrap_or(0.7),
            "max_tokens": config.parameters.max_tokens.unwrap_or(1024),
            "top_p": config.parameters.top_p.unwrap_or(1.0),
            "frequency_penalty": config.parameters.frequency_penalty.unwrap_or(0.0),
            "presence_penalty": config.parameters.presence_penalty.unwrap_or(0.0),
        });
        
        let response = self.client
            .post("https://api.together.xyz/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .await
            .with_context(|| "Failed to send request to Together AI")?;
            
        let latency = start_time.elapsed();
        
        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            anyhow::bail!("Together AI API error: {}", error_text);
        }
        
        let response_json: TogetherAIResponse = response.json().await
            .with_context(|| "Failed to parse Together AI response")?;
            
        let output_text = response_json.choices
            .first()
            .and_then(|choice| choice.message.as_ref())
            .and_then(|message| message.content.as_ref())
            .unwrap_or(&String::new())
            .clone();
            
        let token_count = response_json.usage
            .as_ref()
            .and_then(|usage| usage.total_tokens)
            .unwrap_or(0);
        let cost = self.calculate_cost(token_count, &config.model_name);
        
        Ok(ModelOutput {
            prompt_id: prompt.id.clone(),
            output: output_text,
            metadata: OutputMetadata {
                latency_ms: latency.as_millis() as u64,
                token_count: Some(token_count),
                cost_usd: Some(cost),
                timestamp: Utc::now(),
                provider_metadata: {
                    let mut meta = HashMap::new();
                    if let Some(model) = &response_json.model {
                        meta.insert("model".to_string(), serde_json::Value::String(model.clone()));
                    }
                    meta.insert("finish_reason".to_string(), 
                        serde_json::Value::String(
                            response_json.choices.first()
                                .and_then(|c| c.finish_reason.as_ref())
                                .unwrap_or(&"unknown".to_string())
                                .clone()
                        )
                    );
                    meta
                },
            },
        })
    }
    
    fn supports_model(&self, model_name: &str) -> bool {
        matches!(model_name, 
            "meta-llama/Llama-2-70b-chat-hf" |
            "meta-llama/Llama-2-13b-chat-hf" |
            "meta-llama/Llama-2-7b-chat-hf" |
            "meta-llama/Meta-Llama-3-70B-Instruct" |
            "meta-llama/Meta-Llama-3-8B-Instruct" |
            "mistralai/Mixtral-8x7B-Instruct-v0.1" |
            "mistralai/Mistral-7B-Instruct-v0.1" |
            "codellama/CodeLlama-34b-Instruct-hf" |
            "togethercomputer/RedPajama-INCITE-Chat-3B-v1" |
            "NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO" |
            "teknium/OpenHermes-2.5-Mistral-7B" |
            "Qwen/Qwen1.5-72B-Chat" |
            "OpenAI/GPT-OSS-20B"
        )
    }
    
    fn calculate_cost(&self, tokens: u32, model_name: &str) -> f64 {
        let cost_per_1k = match model_name {
            "meta-llama/Llama-2-70b-chat-hf" => 0.0009,
            "meta-llama/Meta-Llama-3-70B-Instruct" => 0.0009,
            "meta-llama/Llama-2-13b-chat-hf" => 0.0003,
            "meta-llama/Meta-Llama-3-8B-Instruct" => 0.0002,
            "meta-llama/Llama-2-7b-chat-hf" => 0.0002,
            "mistralai/Mixtral-8x7B-Instruct-v0.1" => 0.0006,
            "mistralai/Mistral-7B-Instruct-v0.1" => 0.0002,
            "codellama/CodeLlama-34b-Instruct-hf" => 0.0008,
            "togethercomputer/RedPajama-INCITE-Chat-3B-v1" => 0.0001,
            "NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO" => 0.0006,
            "teknium/OpenHermes-2.5-Mistral-7B" => 0.0002,
            "Qwen/Qwen1.5-72B-Chat" => 0.0009,
            "OpenAI/GPT-OSS-20B" => 0.0004,
            _ => 0.0005, // Default estimate
        };
        
        (tokens as f64 / 1000.0) * cost_per_1k
    }
}

// Groq Provider
pub struct GroqProvider {
    client: Client,
}

impl GroqProvider {
    pub fn new(client: Client) -> Self {
        Self { client }
    }
}

#[async_trait]
impl ModelProvider for GroqProvider {
    fn name(&self) -> &str {
        "groq"
    }
    
    async fn generate(&self, prompt: &Prompt, config: &ModelConfig) -> Result<ModelOutput> {
        let start_time = Instant::now();
        
        let api_key = config.api_key.as_ref()
            .cloned()
            .or_else(|| std::env::var("GROQ_API_KEY").ok())
            .with_context(|| "Groq API key not found")?;
            
        let request_body = serde_json::json!({
            "model": config.model_name,
            "messages": [
                {
                    "role": "user",
                    "content": prompt.text
                }
            ],
            "temperature": config.parameters.temperature.unwrap_or(0.7),
            "max_tokens": config.parameters.max_tokens.unwrap_or(1024),
        });
        
        let response = self.client
            .post("https://api.groq.com/openai/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .await
            .with_context(|| "Failed to send request to Groq")?;
            
        let latency = start_time.elapsed();
        
        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            anyhow::bail!("Groq API error: {}", error_text);
        }
        
        let response_json: TogetherAIResponse = response.json().await
            .with_context(|| "Failed to parse Groq response")?;
            
        let output_text = response_json.choices
            .first()
            .and_then(|choice| {
                choice.message.as_ref()
                    .and_then(|m| m.content.as_ref())
                    .or_else(|| choice.text.as_ref())
            })
            .unwrap_or(&String::new())
            .clone();
            
        let token_count = response_json.usage
            .as_ref()
            .and_then(|u| u.total_tokens)
            .unwrap_or(0);
        let cost = self.calculate_cost(token_count, &config.model_name);
        
        Ok(ModelOutput {
            prompt_id: prompt.id.clone(),
            output: output_text,
            metadata: OutputMetadata {
                latency_ms: latency.as_millis() as u64,
                token_count: Some(token_count),
                cost_usd: Some(cost),
                timestamp: Utc::now(),
                provider_metadata: {
                    let mut meta = HashMap::new();
                    meta.insert("model".to_string(), serde_json::Value::String(config.model_name.clone()));
                    meta
                },
            },
        })
    }
    
    fn supports_model(&self, model_name: &str) -> bool {
        matches!(model_name,
            "llama3-8b-8192" | "llama3-70b-8192" | 
            "mixtral-8x7b-32768" | "gemma-7b-it"
        )
    }
    
    fn calculate_cost(&self, tokens: u32, model_name: &str) -> f64 {
        let cost_per_1k = match model_name {
            "llama3-8b-8192" => 0.0,  // Often free tier
            "llama3-70b-8192" => 0.0,
            "mixtral-8x7b-32768" => 0.0,
            "gemma-7b-it" => 0.0,
            _ => 0.0,
        };
        
        (tokens as f64 / 1000.0) * cost_per_1k
    }
}

// Cohere Provider
pub struct CohereProvider {
    client: Client,
}

impl CohereProvider {
    pub fn new(client: Client) -> Self {
        Self { client }
    }
}

#[async_trait]
impl ModelProvider for CohereProvider {
    fn name(&self) -> &str {
        "cohere"
    }
    
    async fn generate(&self, prompt: &Prompt, config: &ModelConfig) -> Result<ModelOutput> {
        let start_time = Instant::now();
        
        let api_key = config.api_key.as_ref()
            .cloned()
            .or_else(|| std::env::var("COHERE_API_KEY").ok())
            .with_context(|| "Cohere API key not found")?;
            
        let request_body = serde_json::json!({
            "model": config.model_name,
            "message": prompt.text,
            "temperature": config.parameters.temperature.unwrap_or(0.7),
            "max_tokens": config.parameters.max_tokens.unwrap_or(1024),
            "p": config.parameters.top_p.unwrap_or(1.0),
        });
        
        let response = self.client
            .post("https://api.cohere.com/v2/chat")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .await
            .with_context(|| "Failed to send request to Cohere")?;
            
        let latency = start_time.elapsed();
        
        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            anyhow::bail!("Cohere API error: {}", error_text);
        }
        
        #[derive(serde::Deserialize)]
        struct CohereResponse {
            message: CohereMessage,
            usage: Option<CohereUsage>,
        }
        
        #[derive(serde::Deserialize)]
        struct CohereMessage {
            content: Vec<CohereContent>,
        }
        
        #[derive(serde::Deserialize)]
        struct CohereContent {
            text: String,
        }
        
        #[derive(serde::Deserialize)]
        struct CohereUsage {
            tokens: Option<CohereTokens>,
        }
        
        #[derive(serde::Deserialize)]
        struct CohereTokens {
            input_tokens: Option<u32>,
            output_tokens: Option<u32>,
        }
        
        let response_json: CohereResponse = response.json().await
            .with_context(|| "Failed to parse Cohere response")?;
            
        let output_text = response_json.message.content
            .first()
            .map(|content| content.text.clone())
            .unwrap_or_default();
            
        let token_count = response_json.usage
            .as_ref()
            .and_then(|u| u.tokens.as_ref())
            .map(|t| t.input_tokens.unwrap_or(0) + t.output_tokens.unwrap_or(0))
            .unwrap_or(0);
        let cost = self.calculate_cost(token_count, &config.model_name);
        
        Ok(ModelOutput {
            prompt_id: prompt.id.clone(),
            output: output_text,
            metadata: OutputMetadata {
                latency_ms: latency.as_millis() as u64,
                token_count: Some(token_count),
                cost_usd: Some(cost),
                timestamp: Utc::now(),
                provider_metadata: {
                    let mut meta = HashMap::new();
                    meta.insert("provider".to_string(), serde_json::Value::String("cohere".to_string()));
                    meta.insert("model".to_string(), serde_json::Value::String(config.model_name.clone()));
                    meta
                },
            },
        })
    }
    
    fn supports_model(&self, model_name: &str) -> bool {
        matches!(model_name,
            "command-r" | "command-r-plus" | "command-light" | 
            "command-nightly" | "command-r-08-2024"
        )
    }
    
    fn calculate_cost(&self, tokens: u32, model_name: &str) -> f64 {
        let cost_per_1k = match model_name {
            "command-r" => 0.0005,
            "command-r-plus" => 0.003,
            "command-light" => 0.0003,
            "command-nightly" => 0.0005,
            "command-r-08-2024" => 0.0005,
            _ => 0.0005,
        };
        
        (tokens as f64 / 1000.0) * cost_per_1k
    }
}

// OpenRouter Provider
pub struct OpenRouterProvider {
    client: Client,
}

impl OpenRouterProvider {
    pub fn new(client: Client) -> Self {
        Self { client }
    }
}

#[async_trait]
impl ModelProvider for OpenRouterProvider {
    fn name(&self) -> &str {
        "openrouter"
    }
    
    async fn generate(&self, prompt: &Prompt, config: &ModelConfig) -> Result<ModelOutput> {
        let start_time = Instant::now();
        
        let api_key = config.api_key.as_ref()
            .cloned()
            .or_else(|| std::env::var("OPENROUTER_API_KEY").ok())
            .with_context(|| "OpenRouter API key not found")?;
            
        let request_body = serde_json::json!({
            "model": config.model_name,
            "messages": [
                {
                    "role": "user",
                    "content": prompt.text
                }
            ],
            "temperature": config.parameters.temperature.unwrap_or(0.7),
            "max_tokens": config.parameters.max_tokens.unwrap_or(1024),
            "top_p": config.parameters.top_p.unwrap_or(1.0),
        });
        
        let response = self.client
            .post("https://openrouter.ai/api/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .header("HTTP-Referer", "https://github.com/your-org/trustllm") // Required by OpenRouter
            .header("X-Title", "TrustLLM Evaluation") // Optional but recommended
            .json(&request_body)
            .send()
            .await
            .with_context(|| "Failed to send request to OpenRouter")?;
            
        let latency = start_time.elapsed();
        
        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            anyhow::bail!("OpenRouter API error: {}", error_text);
        }
        
        let response_json: TogetherAIResponse = response.json().await
            .with_context(|| "Failed to parse OpenRouter response")?;
            
        let output_text = response_json.choices
            .first()
            .and_then(|choice| choice.message.as_ref())
            .and_then(|message| message.content.as_ref())
            .unwrap_or(&String::new())
            .clone();
            
        let token_count = response_json.usage
            .as_ref()
            .and_then(|usage| usage.total_tokens)
            .unwrap_or(0);
        let cost = self.calculate_cost(token_count, &config.model_name);
        
        Ok(ModelOutput {
            prompt_id: prompt.id.clone(),
            output: output_text,
            metadata: OutputMetadata {
                latency_ms: latency.as_millis() as u64,
                token_count: Some(token_count),
                cost_usd: Some(cost),
                timestamp: Utc::now(),
                provider_metadata: {
                    let mut meta = HashMap::new();
                    meta.insert("provider".to_string(), serde_json::Value::String("openrouter".to_string()));
                    meta.insert("model".to_string(), serde_json::Value::String(config.model_name.clone()));
                    meta
                },
            },
        })
    }
    
    fn supports_model(&self, model_name: &str) -> bool {
        matches!(model_name,
            "mistralai/mistral-small-3.2-24b-instruct:free" |
            "meta-llama/llama-3.1-8b-instruct:free" |
            "microsoft/phi-3-mini-128k-instruct:free" |
            "google/gemma-2-9b-it:free"
        )
    }
    
    fn calculate_cost(&self, tokens: u32, model_name: &str) -> f64 {
        // OpenRouter free models
        if model_name.ends_with(":free") {
            return 0.0;
        }
        
        let cost_per_1k = match model_name {
            "mistralai/mistral-small-3.2-24b-instruct:free" => 0.0,
            _ => 0.001, // Default for paid models
        };
        
        (tokens as f64 / 1000.0) * cost_per_1k
    }
}
