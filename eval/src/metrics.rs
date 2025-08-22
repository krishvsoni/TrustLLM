use anyhow::Result;
use std::collections::HashMap;

use crate::types::{MetricResult, ModelOutput, Prompt};

pub trait Metric: Send + Sync {
    fn name(&self) -> &str;
    fn calculate(&self, output: &ModelOutput, prompt: &Prompt) -> Result<f64>;
    fn aggregate(&self, scores: &[f64]) -> f64;
    fn details(&self, output: &ModelOutput, prompt: &Prompt) -> Result<HashMap<String, serde_json::Value>>;
}

pub struct MetricRegistry {
    metrics: HashMap<String, Box<dyn Metric>>,
}

impl MetricRegistry {
    pub fn new() -> Self {
        let mut registry = Self {
            metrics: HashMap::new(),
        };
        
        // Register built-in metrics
        registry.register(Box::new(BleuMetric::default()));
        registry.register(Box::new(RougeMetric::default()));
        registry.register(Box::new(ExactMatchMetric::default()));
        registry.register(Box::new(LatencyMetric::default()));
        registry.register(Box::new(CostMetric::default()));
        
        registry
    }
    
    pub fn register(&mut self, metric: Box<dyn Metric>) {
        self.metrics.insert(metric.name().to_string(), metric);
    }
    
    pub fn get(&self, name: &str) -> Option<&Box<dyn Metric>> {
        self.metrics.get(name)
    }
    
    pub fn calculate_all(&self, outputs: &[ModelOutput], prompts: &HashMap<String, Prompt>, metric_configs: &[crate::types::MetricConfig]) -> Result<HashMap<String, MetricResult>> {
        let mut results = HashMap::new();
        
        for config in metric_configs {
            if let Some(metric) = self.get(&config.name) {
                let mut per_prompt_scores = HashMap::new();
                let mut all_scores = Vec::new();
                
                for output in outputs {
                    if let Some(prompt) = prompts.get(&output.prompt_id) {
                        match metric.calculate(output, prompt) {
                            Ok(score) => {
                                per_prompt_scores.insert(output.prompt_id.clone(), score);
                                all_scores.push(score);
                            }
                            Err(e) => {
                                log::warn!("Failed to calculate {} for prompt {}: {}", 
                                    config.name, output.prompt_id, e);
                            }
                        }
                    }
                }
                
                let aggregate_score = metric.aggregate(&all_scores);
                let details = if let Some(first_output) = outputs.first() {
                    if let Some(first_prompt) = prompts.get(&first_output.prompt_id) {
                        metric.details(first_output, first_prompt).unwrap_or_default()
                    } else {
                        HashMap::new()
                    }
                } else {
                    HashMap::new()
                };
                
                results.insert(config.name.clone(), MetricResult {
                    metric_name: config.name.clone(),
                    score: aggregate_score,
                    details,
                    per_prompt_scores,
                });
            }
        }
        
        Ok(results)
    }
}

// BLEU Score Implementation
#[derive(Default)]
pub struct BleuMetric;

impl Metric for BleuMetric {
    fn name(&self) -> &str {
        "bleu"
    }
    
    fn calculate(&self, output: &ModelOutput, prompt: &Prompt) -> Result<f64> {
        if let Some(expected) = &prompt.expected_output {
            Ok(calculate_bleu(&output.output, expected))
        } else {
            Ok(0.0) // Cannot calculate BLEU without reference
        }
    }
    
    fn aggregate(&self, scores: &[f64]) -> f64 {
        if scores.is_empty() {
            0.0
        } else {
            scores.iter().sum::<f64>() / scores.len() as f64
        }
    }
    
    fn details(&self, output: &ModelOutput, prompt: &Prompt) -> Result<HashMap<String, serde_json::Value>> {
        let mut details = HashMap::new();
        details.insert("output_length".to_string(), serde_json::Value::Number(
            serde_json::Number::from(output.output.len())
        ));
        
        if let Some(expected) = &prompt.expected_output {
            details.insert("reference_length".to_string(), serde_json::Value::Number(
                serde_json::Number::from(expected.len())
            ));
        }
        
        Ok(details)
    }
}

// ROUGE Score Implementation  
#[derive(Default)]
pub struct RougeMetric;

impl Metric for RougeMetric {
    fn name(&self) -> &str {
        "rouge"
    }
    
    fn calculate(&self, output: &ModelOutput, prompt: &Prompt) -> Result<f64> {
        if let Some(expected) = &prompt.expected_output {
            Ok(calculate_rouge(&output.output, expected))
        } else {
            Ok(0.0)
        }
    }
    
    fn aggregate(&self, scores: &[f64]) -> f64 {
        if scores.is_empty() {
            0.0
        } else {
            scores.iter().sum::<f64>() / scores.len() as f64
        }
    }
    
    fn details(&self, output: &ModelOutput, _prompt: &Prompt) -> Result<HashMap<String, serde_json::Value>> {
        let mut details = HashMap::new();
        details.insert("word_count".to_string(), serde_json::Value::Number(
            serde_json::Number::from(output.output.split_whitespace().count())
        ));
        Ok(details)
    }
}

// Exact Match Implementation
#[derive(Default)]
pub struct ExactMatchMetric;

impl Metric for ExactMatchMetric {
    fn name(&self) -> &str {
        "exact_match"
    }
    
    fn calculate(&self, output: &ModelOutput, prompt: &Prompt) -> Result<f64> {
        if let Some(expected) = &prompt.expected_output {
            let output_clean = output.output.trim().to_lowercase();
            let expected_clean = expected.trim().to_lowercase();
            Ok(if output_clean == expected_clean { 1.0 } else { 0.0 })
        } else {
            Ok(0.0)
        }
    }
    
    fn aggregate(&self, scores: &[f64]) -> f64 {
        if scores.is_empty() {
            0.0
        } else {
            scores.iter().sum::<f64>() / scores.len() as f64
        }
    }
    
    fn details(&self, output: &ModelOutput, prompt: &Prompt) -> Result<HashMap<String, serde_json::Value>> {
        let mut details = HashMap::new();
        if let Some(expected) = &prompt.expected_output {
            details.insert("exact_match".to_string(), serde_json::Value::Bool(
                output.output.trim() == expected.trim()
            ));
        }
        Ok(details)
    }
}

// Latency Metric Implementation
#[derive(Default)]
pub struct LatencyMetric;

impl Metric for LatencyMetric {
    fn name(&self) -> &str {
        "latency"
    }
    
    fn calculate(&self, output: &ModelOutput, _prompt: &Prompt) -> Result<f64> {
        Ok(output.metadata.latency_ms as f64)
    }
    
    fn aggregate(&self, scores: &[f64]) -> f64 {
        if scores.is_empty() {
            0.0
        } else {
            scores.iter().sum::<f64>() / scores.len() as f64
        }
    }
    
    fn details(&self, output: &ModelOutput, _prompt: &Prompt) -> Result<HashMap<String, serde_json::Value>> {
        let mut details = HashMap::new();
        details.insert("latency_ms".to_string(), serde_json::Value::Number(
            serde_json::Number::from(output.metadata.latency_ms)
        ));
        Ok(details)
    }
}

// Cost Metric Implementation
#[derive(Default)]
pub struct CostMetric;

impl Metric for CostMetric {
    fn name(&self) -> &str {
        "cost"
    }
    
    fn calculate(&self, output: &ModelOutput, _prompt: &Prompt) -> Result<f64> {
        Ok(output.metadata.cost_usd.unwrap_or(0.0))
    }
    
    fn aggregate(&self, scores: &[f64]) -> f64 {
        scores.iter().sum() // Sum for total cost
    }
    
    fn details(&self, output: &ModelOutput, _prompt: &Prompt) -> Result<HashMap<String, serde_json::Value>> {
        let mut details = HashMap::new();
        details.insert("cost_usd".to_string(), serde_json::Value::Number(
            serde_json::Number::from_f64(output.metadata.cost_usd.unwrap_or(0.0)).unwrap_or(serde_json::Number::from(0))
        ));
        if let Some(tokens) = output.metadata.token_count {
            details.insert("tokens".to_string(), serde_json::Value::Number(
                serde_json::Number::from(tokens)
            ));
        }
        Ok(details)
    }
}

// Simple BLEU calculation (simplified version for demo)
fn calculate_bleu(candidate: &str, reference: &str) -> f64 {
    let candidate_words: Vec<&str> = candidate.split_whitespace().collect();
    let reference_words: Vec<&str> = reference.split_whitespace().collect();
    
    if candidate_words.is_empty() || reference_words.is_empty() {
        return 0.0;
    }
    
    // Simple unigram precision
    let mut matches = 0;
    for word in &candidate_words {
        if reference_words.contains(word) {
            matches += 1;
        }
    }
    
    let precision = matches as f64 / candidate_words.len() as f64;
    
    // Apply brevity penalty
    let bp = if candidate_words.len() < reference_words.len() {
        (1.0 - (reference_words.len() as f64 / candidate_words.len() as f64)).exp()
    } else {
        1.0
    };
    
    precision * bp
}

// Simple ROUGE-L calculation (simplified version for demo)
fn calculate_rouge(candidate: &str, reference: &str) -> f64 {
    let candidate_words: Vec<&str> = candidate.split_whitespace().collect();
    let reference_words: Vec<&str> = reference.split_whitespace().collect();
    
    if candidate_words.is_empty() || reference_words.is_empty() {
        return 0.0;
    }
    
    // Find longest common subsequence
    let lcs_length = lcs(&candidate_words, &reference_words);
    
    let precision = lcs_length as f64 / candidate_words.len() as f64;
    let recall = lcs_length as f64 / reference_words.len() as f64;
    
    if precision + recall == 0.0 {
        0.0
    } else {
        2.0 * precision * recall / (precision + recall)
    }
}

// Longest Common Subsequence
fn lcs(a: &[&str], b: &[&str]) -> usize {
    let mut dp = vec![vec![0; b.len() + 1]; a.len() + 1];
    
    for i in 1..=a.len() {
        for j in 1..=b.len() {
            if a[i - 1] == b[j - 1] {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = dp[i - 1][j].max(dp[i][j - 1]);
            }
        }
    }
    
    dp[a.len()][b.len()]
}
