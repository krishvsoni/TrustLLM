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
        println!("\n Evaluation Results Summary");
        println!("═══════════════════════════════");
        
        println!(" Overall Statistics:");
        println!("  • Total Prompts: {}", results.summary.total_prompts);
        println!("  • Successful Completions: {}", results.summary.successful_completions);
        println!("  • Failed Completions: {}", results.summary.failed_completions);
        
        if let Some(best) = &results.summary.best_performing_model {
            println!("  • Best Model: {}", best);
        }
        
        println!("\n Model Rankings:");
        for ranking in &results.summary.ranking {
            println!("  {}. {} (Score: {:.3})", 
                ranking.rank, 
                ranking.model_id, 
                ranking.overall_score
            );
        }
        
        println!("\n Average Metric Scores:");
        for (metric, score) in &results.summary.average_scores {
            println!("  • {}: {:.3}", metric, score);
        }
        
        println!("\n Cost & Performance:");
        for (model_id, model_result) in &results.model_results {
            println!("  • {}: ${:.4} | {:.0}ms avg | {:.1}% success", 
                model_id,
                model_result.performance.total_cost_usd,
                model_result.performance.average_latency_ms,
                model_result.performance.success_rate * 100.0
            );
        }
        
        println!("\n Results saved to: {}", self.output_dir);
        println!(" Verification hash: {}", &results.verification_hash[..16]);
    }
}
