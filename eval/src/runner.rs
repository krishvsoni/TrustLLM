use anyhow::{Context, Result};
use futures::future::join_all;
use log::{error, info, warn};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Semaphore;
use chrono::Utc;

use crate::config::EvalConfig;
use crate::metrics::MetricRegistry;
use crate::models::ModelRegistry;
use crate::storage::{FileSystemStorage, EvalLogger, LogEvent, ResultVerifier, Storage};
use crate::types::{
    EvaluationJob, EvaluationResults, JobStatus, ModelResults, PerformanceMetrics,
    ResultSummary, ModelRanking, EvaluationError, ErrorType
};

pub struct EvalRunner {
    config: EvalConfig,
    storage: Arc<FileSystemStorage>,
    model_registry: Arc<ModelRegistry>,
    metric_registry: Arc<MetricRegistry>,
    output_dir: String,
}

impl EvalRunner {
    pub async fn new(config: EvalConfig, output_dir: String) -> Result<Self> {
        let storage = Arc::new(
            FileSystemStorage::new(&output_dir)
                .with_context(|| format!("Failed to initialize storage at: {}", output_dir))?
        );
        
        let model_registry = Arc::new(ModelRegistry::new());
        let metric_registry = Arc::new(MetricRegistry::new());
        
        Ok(Self {
            config,
            storage,
            model_registry,
            metric_registry,
            output_dir,
        })
    }
    
    pub async fn run(&self) -> Result<EvaluationResults> {
        let start_time = Instant::now();
        
        // Validate all model configurations before starting
        info!("Validating model configurations...");
        for (model_id, model_config) in &self.config.models {
            match self.model_registry.validate_model_config(model_config) {
                Ok(_) => info!("Model '{}' validation passed", model_id),
                Err(e) => {
                    error!("Model '{}' validation failed: {}", model_id, e);
                    return Err(e);
                }
            }
        }
        
        // Create evaluation job
        let mut job = EvaluationJob::new(
            self.config.job_name.clone(),
            self.config.prompts.values().cloned().collect(),
            self.config.models.values().cloned().collect(),
            self.config.metrics.values().cloned().collect(),
        );
        
        // Initialize logger
        let logger = EvalLogger::new(job.id.to_string(), &self.storage);
        
        // Log job start
        logger.log_event(LogEvent::JobStarted {
            models: self.config.models.keys().cloned().collect(),
            prompts: self.config.prompts.len(),
            metrics: self.config.metrics.keys().cloned().collect(),
        })?;
        
        info!("Starting evaluation job: {} (ID: {})", job.name, job.id);
        
        // Update job status and save
        job.status = JobStatus::Running;
        self.storage.save_job(&job)?;
        
        // Run evaluations
        let results = match self.run_evaluations(&job, &logger).await {
            Ok(results) => {
                job.status = JobStatus::Completed;
                job.results = Some(results.clone());
                
                // Log completion
                let duration = start_time.elapsed();
                logger.log_event(LogEvent::JobCompleted {
                    duration_ms: duration.as_millis() as u64,
                    total_outputs: results.model_results.values()
                        .map(|r| r.outputs.len())
                        .sum(),
                    total_errors: results.model_results.values()
                        .map(|r| r.errors.len())
                        .sum(),
                })?;
                
                info!("Evaluation completed in {:?}", duration);
                results
            }
            Err(e) => {
                job.status = JobStatus::Failed;
                
                logger.log_event(LogEvent::Error {
                    message: e.to_string(),
                    context: HashMap::new(),
                })?;
                
                error!("Evaluation failed: {}", e);
                return Err(e);
            }
        };
        
        // Save final job state and results
        self.storage.save_job(&job)?;
        self.storage.save_results(&results)?;
        
        // Print summary
        self.print_summary(&results);
        
        Ok(results)
    }
    
    async fn run_evaluations(&self, job: &EvaluationJob, logger: &EvalLogger) -> Result<EvaluationResults> {
        let semaphore = Arc::new(Semaphore::new(self.config.settings.parallel_requests));
        let mut model_results = HashMap::new();
        
        // Process each model
        let model_futures: Vec<_> = job.models.iter().map(|model_config| {
            let semaphore = Arc::clone(&semaphore);
            let model_registry = Arc::clone(&self.model_registry);
            let metric_registry = Arc::clone(&self.metric_registry);
            let prompts = job.prompts.clone();
            let metrics = job.metrics.clone();
            let model_config = model_config.clone();
            let logger = logger.clone();
            
            async move {
                let _permit = semaphore.acquire().await.unwrap();
                
                self.evaluate_model(
                    &model_config,
                    &prompts,
                    &metrics,
                    &model_registry,
                    &metric_registry,
                    &logger,
                ).await
            }
        }).collect();
        
        // Wait for all models to complete
        let results = join_all(model_futures).await;
        
        // Collect results
        for result in results {
            match result {
                Ok((model_id, model_result)) => {
                    model_results.insert(model_id, model_result);
                }
                Err(e) => {
                    warn!("Model evaluation failed: {}", e);
                }
            }
        }
        
        // Calculate aggregate scores and summary
        let aggregate_scores = self.calculate_aggregate_scores(&model_results);
        let summary = self.create_summary(&model_results, &aggregate_scores);
        
        // Create final results with verification hash
        let mut results = EvaluationResults {
            job_id: job.id,
            completed_at: Utc::now(),
            model_results,
            aggregate_scores,
            summary,
            verification_hash: String::new(),
        };
        
        // Calculate verification hash
        results.verification_hash = ResultVerifier::calculate_hash(&results);
        
        Ok(results)
    }
    
    async fn evaluate_model(
        &self,
        model_config: &crate::types::ModelConfig,
        prompts: &[crate::types::Prompt],
        metrics: &[crate::types::MetricConfig],
        model_registry: &ModelRegistry,
        metric_registry: &MetricRegistry,
        logger: &EvalLogger,
    ) -> Result<(String, ModelResults)> {
        let start_time = Instant::now();
        
        logger.log_event(LogEvent::ModelStarted {
            model_id: model_config.id.clone(),
            provider: model_config.provider.clone(),
        })?;
        
        info!("Evaluating model: {} ({})", model_config.id, model_config.provider);
        
        let mut outputs = Vec::new();
        let mut errors = Vec::new();
        let mut total_latency = 0u64;
        let mut total_tokens = 0u32;
        let mut total_cost = 0.0;
        
        // Generate outputs for each prompt
        for prompt in prompts {
            match model_registry.generate(prompt, model_config).await {
                Ok(output) => {
                    total_latency += output.metadata.latency_ms;
                    total_tokens += output.metadata.token_count.unwrap_or(0);
                    total_cost += output.metadata.cost_usd.unwrap_or(0.0);
                    outputs.push(output);
                }
                Err(e) => {
                    let error_msg = format!("Failed to generate output for prompt '{}': {}", prompt.id, e);
                    error!("{}", error_msg);
                    errors.push(EvaluationError {
                        error_type: ErrorType::UnknownError,
                        message: error_msg,
                        prompt_id: Some(prompt.id.clone()),
                        timestamp: Utc::now(),
                        context: HashMap::new(),
                    });
                }
            }
        }
        
        // Calculate metrics
        let prompt_map: HashMap<String, crate::types::Prompt> = prompts.iter()
            .map(|p| (p.id.clone(), p.clone()))
            .collect();
            
        let metrics_results = metric_registry.calculate_all(&outputs, &prompt_map, metrics)?;
        
        // Log metric results
        for (metric_name, metric_result) in &metrics_results {
            logger.log_event(LogEvent::MetricCalculated {
                metric_name: metric_name.clone(),
                model_id: model_config.id.clone(),
                score: metric_result.score,
            })?;
        }
        
        // Calculate performance metrics
        let duration = start_time.elapsed();
        let success_rate = if prompts.is_empty() {
            0.0
        } else {
            outputs.len() as f64 / prompts.len() as f64
        };
        
        let throughput = if duration.as_secs_f64() > 0.0 {
            outputs.len() as f64 / duration.as_secs_f64()
        } else {
            0.0
        };
        
        let performance = PerformanceMetrics {
            total_latency_ms: total_latency,
            average_latency_ms: if outputs.is_empty() {
                0.0
            } else {
                total_latency as f64 / outputs.len() as f64
            },
            total_tokens,
            total_cost_usd: total_cost,
            success_rate,
            throughput_per_second: throughput,
        };
        
        // Log model completion
        logger.log_event(LogEvent::ModelCompleted {
            model_id: model_config.id.clone(),
            success: errors.is_empty(),
            outputs: outputs.len(),
            errors: errors.len(),
            duration_ms: duration.as_millis() as u64,
        })?;
        
        let model_results = ModelResults {
            model_id: model_config.id.clone(),
            outputs,
            metrics: metrics_results,
            performance,
            errors,
        };
        
        Ok((model_config.id.clone(), model_results))
    }
    
    fn calculate_aggregate_scores(&self, model_results: &HashMap<String, ModelResults>) -> HashMap<String, f64> {
        let mut aggregate_scores = HashMap::new();
        
        if model_results.is_empty() {
            return aggregate_scores;
        }
        
        // Get all metric names
        let metric_names: std::collections::HashSet<String> = model_results
            .values()
            .flat_map(|r| r.metrics.keys())
            .cloned()
            .collect();
        
        // Calculate average score for each metric across all models
        for metric_name in metric_names {
            let scores: Vec<f64> = model_results
                .values()
                .filter_map(|r| r.metrics.get(&metric_name).map(|m| m.score))
                .collect();
            
            if !scores.is_empty() {
                let average = scores.iter().sum::<f64>() / scores.len() as f64;
                aggregate_scores.insert(metric_name, average);
            }
        }
        
        aggregate_scores
    }
    
    fn create_summary(&self, model_results: &HashMap<String, ModelResults>, aggregate_scores: &HashMap<String, f64>) -> ResultSummary {
        let total_prompts = model_results.values()
            .map(|r| r.outputs.len() + r.errors.len())
            .max()
            .unwrap_or(0);
        
        let successful_completions: usize = model_results.values()
            .map(|r| r.outputs.len())
            .sum();
        
        let failed_completions: usize = model_results.values()
            .map(|r| r.errors.len())
            .sum();
        
        // Calculate overall scores for ranking
        let mut rankings = Vec::new();
        for (model_id, results) in model_results {
            let overall_score = if results.metrics.is_empty() {
                0.0
            } else {
                results.metrics.values().map(|m| m.score).sum::<f64>() / results.metrics.len() as f64
            };
            
            rankings.push(ModelRanking {
                model_id: model_id.clone(),
                overall_score,
                rank: 0, // Will be set after sorting
                strengths: vec![], // TODO: Implement strength/weakness analysis
                weaknesses: vec![],
            });
        }
        
        // Sort by overall score (descending)
        rankings.sort_by(|a, b| b.overall_score.partial_cmp(&a.overall_score).unwrap_or(std::cmp::Ordering::Equal));
        
        // Set ranks
        for (i, ranking) in rankings.iter_mut().enumerate() {
            ranking.rank = i + 1;
        }
        
        let best_performing_model = rankings.first().map(|r| r.model_id.clone());
        let worst_performing_model = rankings.last().map(|r| r.model_id.clone());
        
        ResultSummary {
            total_prompts,
            successful_completions,
            failed_completions,
            best_performing_model,
            worst_performing_model,
            average_scores: aggregate_scores.clone(),
            ranking: rankings,
        }
    }
    
    fn print_summary(&self, results: &EvaluationResults) {
        println!("\n");
        println!("═══════════════════════════════════════════════════════════════");
        println!("  TRUSTLLM COMPREHENSIVE EVALUATION RESULTS");
        println!("═══════════════════════════════════════════════════════════════");
        
        // Overall Statistics
        println!("\nOVERALL STATISTICS:");
        println!("  • Total Prompts Evaluated: {}", results.summary.total_prompts);
        println!("  • Successful Completions: {}", results.summary.successful_completions);
        println!("  • Failed Completions: {}", results.summary.failed_completions);
        
        let success_rate = if results.summary.total_prompts > 0 {
            (results.summary.successful_completions as f64 / results.summary.total_prompts as f64) * 100.0
        } else {
            0.0
        };
        println!("  • Overall Success Rate: {:.1}%", success_rate);
        
        if let Some(best) = &results.summary.best_performing_model {
            println!("  • Champion Model: {}", best);
        }
        
        // Model Rankings with detailed analysis
        println!("\nMODEL PERFORMANCE RANKINGS:");
        for ranking in &results.summary.ranking {
            let medal = match ranking.rank {
                1 => "[1st]",
                2 => "[2nd]", 
                3 => "[3rd]",
                _ => "[Other]"
            };
            
            if let Some(model_results) = results.model_results.get(&ranking.model_id) {
                let success_rate = model_results.performance.success_rate * 100.0;
                
                println!("  {} {}. {} (Composite Score: {:.3})", 
                    medal, ranking.rank, ranking.model_id, ranking.overall_score);
                println!("     Success Rate: {:.1}% ({}/{} completions)", 
                    success_rate, 
                    model_results.outputs.len(), 
                    model_results.outputs.len() + model_results.errors.len()
                );
                println!("     Avg Latency: {:.0}ms", model_results.performance.average_latency_ms);
                println!("     Total Cost: ${:.4}", model_results.performance.total_cost_usd);
                println!("     Throughput: {:.2} completions/sec", model_results.performance.throughput_per_second);
                
                // Show top metrics for this model
                let mut sorted_metrics: Vec<_> = model_results.metrics.iter().collect();
                sorted_metrics.sort_by(|a, b| b.1.score.partial_cmp(&a.1.score).unwrap_or(std::cmp::Ordering::Equal));
                
                if !sorted_metrics.is_empty() {
                    println!("     Top Metrics:");
                    for (metric_name, metric_result) in sorted_metrics.iter().take(3) {
                        println!("       • {}: {:.3}", metric_name, metric_result.score);
                    }
                }
                println!();
            }
        }
        
        // Detailed Metric Analysis
        println!("DETAILED METRIC ANALYSIS:");
        for (metric, score) in &results.summary.average_scores {
            println!("  • {}: {:.3} (average across all models)", metric, score);
            
            // Show best and worst performers for this metric
            let mut metric_performers: Vec<_> = results.model_results.iter()
                .filter_map(|(model_id, results)| {
                    results.metrics.get(metric).map(|m| (model_id, m.score))
                })
                .collect();
            
            if !metric_performers.is_empty() {
                metric_performers.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
                let best = &metric_performers[0];
                let worst = &metric_performers[metric_performers.len() - 1];
                
                println!("    Best: {} ({:.3})", best.0, best.1);
                if metric_performers.len() > 1 {
                    println!("    Worst: {} ({:.3})", worst.0, worst.1);
                }
            }
            println!();
        }
        
        // Cost & Performance Analysis
        println!("COST & PERFORMANCE BREAKDOWN:");
        let mut cost_sorted: Vec<_> = results.model_results.iter().collect();
        cost_sorted.sort_by(|a, b| a.1.performance.total_cost_usd.partial_cmp(&b.1.performance.total_cost_usd).unwrap_or(std::cmp::Ordering::Equal));
        
        for (model_id, model_result) in cost_sorted {
            let avg_latency = model_result.performance.average_latency_ms;
            let success_rate = model_result.performance.success_rate * 100.0;
            
            let cost_indicator = if model_result.performance.total_cost_usd == 0.0 { "[FREE]" } else { "[PAID]" };
            let speed_indicator = if avg_latency < 1000.0 { "[FAST]" } else if avg_latency < 3000.0 { "[MEDIUM]" } else { "[SLOW]" };
            let reliability_indicator = if success_rate == 100.0 { "[PERFECT]" } else if success_rate >= 80.0 { "[GOOD]" } else { "[POOR]" };
            
            println!("  {} {} {} {}: ${:.4} | {:.0}ms avg | {:.1}% success | {:.2} comp/sec", 
                cost_indicator, speed_indicator, reliability_indicator, model_id,
                model_result.performance.total_cost_usd, 
                avg_latency, 
                success_rate,
                model_result.performance.throughput_per_second
            );
        }
        
        // Quality Insights
        println!("\nQUALITY INSIGHTS:");
        
        // Find the most consistent model (lowest variance in metrics)
        let mut consistency_scores = HashMap::new();
        for (model_id, model_result) in &results.model_results {
            if model_result.metrics.len() > 1 {
                let scores: Vec<f64> = model_result.metrics.values().map(|m| m.score).collect();
                let mean = scores.iter().sum::<f64>() / scores.len() as f64;
                let variance = scores.iter().map(|&x| (x - mean).powi(2)).sum::<f64>() / scores.len() as f64;
                consistency_scores.insert(model_id, variance);
            }
        }
        
        if let Some((most_consistent, _)) = consistency_scores.iter()
            .min_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal)) {
            println!("  Most Consistent Model: {}", most_consistent);
        }
        
        // Find the fastest model
        if let Some((fastest_model, fastest_result)) = results.model_results.iter()
            .filter(|(_, r)| !r.outputs.is_empty())
            .min_by(|a, b| a.1.performance.average_latency_ms.partial_cmp(&b.1.performance.average_latency_ms).unwrap_or(std::cmp::Ordering::Equal)) {
            println!("  Fastest Model: {} ({:.0}ms avg)", fastest_model, fastest_result.performance.average_latency_ms);
        }
        
        // Find the most cost-effective model
        if let Some((cost_effective, _)) = results.model_results.iter()
            .filter(|(_, r)| r.performance.success_rate > 0.8) // Only consider reliable models
            .min_by(|a, b| a.1.performance.total_cost_usd.partial_cmp(&b.1.performance.total_cost_usd).unwrap_or(std::cmp::Ordering::Equal)) {
            println!("  Most Cost-Effective: {}", cost_effective);
        }
        
        println!("\nResults saved to: {}", self.output_dir);
        println!("Verification hash: {}", &results.verification_hash[..16]);
        
        println!("\nTIP: Use 'cargo run -- show-results {}' to view detailed results later", results.job_id);
        println!("═══════════════════════════════════════════════════════════════\n");
    }
}
