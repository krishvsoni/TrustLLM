use anyhow::{Context, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use blake3::Hasher;

use crate::types::{EvaluationJob, EvaluationResults};

pub trait Storage: Send + Sync {
    fn save_job(&self, job: &EvaluationJob) -> Result<()>;
    fn load_job(&self, job_id: &str) -> Result<EvaluationJob>;
    fn save_results(&self, results: &EvaluationResults) -> Result<()>;
    fn load_results(&self, job_id: &str) -> Result<Option<EvaluationResults>>;
    fn list_jobs(&self) -> Result<Vec<JobSummary>>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobSummary {
    pub id: String,
    pub name: String,
    pub status: String,
    pub created_at: chrono::DateTime<Utc>,
    pub completed_at: Option<chrono::DateTime<Utc>>,
    pub model_count: usize,
    pub prompt_count: usize,
    pub metric_count: usize,
}

pub struct FileSystemStorage {
    base_path: PathBuf,
}

impl FileSystemStorage {
    pub fn new<P: AsRef<Path>>(base_path: P) -> Result<Self> {
        let base_path = base_path.as_ref().to_path_buf();
        
        // Create directory structure
        fs::create_dir_all(&base_path)?;
        fs::create_dir_all(base_path.join("jobs"))?;
        fs::create_dir_all(base_path.join("results"))?;
        fs::create_dir_all(base_path.join("logs"))?;
        
        Ok(Self { base_path })
    }
    
    fn job_path(&self, job_id: &str) -> PathBuf {
        self.base_path.join("jobs").join(format!("{}.json", job_id))
    }
    
    fn results_path(&self, job_id: &str) -> PathBuf {
        self.base_path.join("results").join(format!("{}.json", job_id))
    }
    
    fn log_path(&self, job_id: &str) -> PathBuf {
        self.base_path.join("logs").join(format!("{}.log", job_id))
    }
}

impl Storage for FileSystemStorage {
    fn save_job(&self, job: &EvaluationJob) -> Result<()> {
        let path = self.job_path(&job.id.to_string());
        let content = serde_json::to_string_pretty(job)
            .with_context(|| "Failed to serialize job")?;
        
        fs::write(&path, content)
            .with_context(|| format!("Failed to write job file: {:?}", path))?;
        
        Ok(())
    }
    
    fn load_job(&self, job_id: &str) -> Result<EvaluationJob> {
        let path = self.job_path(job_id);
        let content = fs::read_to_string(&path)
            .with_context(|| format!("Failed to read job file: {:?}", path))?;
        
        let job: EvaluationJob = serde_json::from_str(&content)
            .with_context(|| "Failed to deserialize job")?;
        
        Ok(job)
    }
    
    fn save_results(&self, results: &EvaluationResults) -> Result<()> {
        let path = self.results_path(&results.job_id.to_string());
        let content = serde_json::to_string_pretty(results)
            .with_context(|| "Failed to serialize results")?;
        
        fs::write(&path, content)
            .with_context(|| format!("Failed to write results file: {:?}", path))?;
        
        Ok(())
    }
    
    fn load_results(&self, job_id: &str) -> Result<Option<EvaluationResults>> {
        let path = self.results_path(job_id);
        
        if !path.exists() {
            return Ok(None);
        }
        
        let content = fs::read_to_string(&path)
            .with_context(|| format!("Failed to read results file: {:?}", path))?;
        
        let results: EvaluationResults = serde_json::from_str(&content)
            .with_context(|| "Failed to deserialize results")?;
        
        Ok(Some(results))
    }
    
    fn list_jobs(&self) -> Result<Vec<JobSummary>> {
        let jobs_dir = self.base_path.join("jobs");
        let mut summaries = Vec::new();
        
        if !jobs_dir.exists() {
            return Ok(summaries);
        }
        
        for entry in fs::read_dir(&jobs_dir)? {
            let entry = entry?;
            let path = entry.path();
            
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                if let Ok(job) = self.load_job(
                    &path.file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or_default()
                ) {
                    let completed_at = if let Some(results) = self.load_results(&job.id.to_string())? {
                        Some(results.completed_at)
                    } else {
                        None
                    };
                    
                    summaries.push(JobSummary {
                        id: job.id.to_string(),
                        name: job.name,
                        status: format!("{:?}", job.status),
                        created_at: job.created_at,
                        completed_at,
                        model_count: job.models.len(),
                        prompt_count: job.prompts.len(),
                        metric_count: job.metrics.len(),
                    });
                }
            }
        }
        
        // Sort by creation time (newest first)
        summaries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        
        Ok(summaries)
    }
}

/// Verification utilities for ensuring result integrity
pub struct ResultVerifier;

impl ResultVerifier {
    /// Calculate a verification hash for the evaluation results
    pub fn calculate_hash(results: &EvaluationResults) -> String {
        let mut hasher = Hasher::new();
        
        // Hash job ID
        hasher.update(results.job_id.as_bytes());
        
        // Hash completion time
        hasher.update(results.completed_at.to_rfc3339().as_bytes());
        
        // Hash model results in a deterministic way
        let mut model_ids: Vec<_> = results.model_results.keys().collect();
        model_ids.sort();
        
        for model_id in model_ids {
            if let Some(model_result) = results.model_results.get(model_id) {
                hasher.update(model_id.as_bytes());
                
                // Hash outputs
                for output in &model_result.outputs {
                    hasher.update(output.prompt_id.as_bytes());
                    hasher.update(output.output.as_bytes());
                }
                
                // Hash metrics
                let mut metric_names: Vec<_> = model_result.metrics.keys().collect();
                metric_names.sort();
                
                for metric_name in metric_names {
                    if let Some(metric_result) = model_result.metrics.get(metric_name) {
                        hasher.update(metric_name.as_bytes());
                        hasher.update(&metric_result.score.to_be_bytes());
                    }
                }
            }
        }
        
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.encode(hasher.finalize().as_bytes())
    }
    
    /// Verify that results haven't been tampered with
    pub fn verify_results(results: &EvaluationResults) -> bool {
        let calculated_hash = Self::calculate_hash(results);
        calculated_hash == results.verification_hash
    }
}

/// Structured logging for evaluation runs
#[derive(Clone)]
pub struct EvalLogger {
    job_id: String,
    log_path: PathBuf,
}

impl EvalLogger {
    pub fn new(job_id: String, storage: &FileSystemStorage) -> Self {
        let log_path = storage.log_path(&job_id);
        
        Self { job_id, log_path }
    }
    
    pub fn log_event(&self, event: LogEvent) -> Result<()> {
        let log_entry = LogEntry {
            timestamp: Utc::now(),
            job_id: self.job_id.clone(),
            event,
        };
        
        let line = serde_json::to_string(&log_entry)? + "\n";
        
        fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.log_path)?
            .write_all(line.as_bytes())?;
        
        Ok(())
    }
    
    pub fn read_logs(&self) -> Result<Vec<LogEntry>> {
        if !self.log_path.exists() {
            return Ok(Vec::new());
        }
        
        let content = fs::read_to_string(&self.log_path)?;
        let mut entries = Vec::new();
        
        for line in content.lines() {
            if !line.trim().is_empty() {
                if let Ok(entry) = serde_json::from_str::<LogEntry>(line) {
                    entries.push(entry);
                }
            }
        }
        
        Ok(entries)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub timestamp: chrono::DateTime<Utc>,
    pub job_id: String,
    pub event: LogEvent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum LogEvent {
    JobStarted {
        models: Vec<String>,
        prompts: usize,
        metrics: Vec<String>,
    },
    ModelStarted {
        model_id: String,
        provider: String,
    },
    ModelCompleted {
        model_id: String,
        success: bool,
        outputs: usize,
        errors: usize,
        duration_ms: u64,
    },
    MetricCalculated {
        metric_name: String,
        model_id: String,
        score: f64,
    },
    JobCompleted {
        duration_ms: u64,
        total_outputs: usize,
        total_errors: usize,
    },
    Error {
        message: String,
        context: std::collections::HashMap<String, serde_json::Value>,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use uuid::Uuid;
    
    #[test]
    fn test_filesystem_storage() {
        let temp_dir = TempDir::new().unwrap();
        let storage = FileSystemStorage::new(temp_dir.path()).unwrap();
        
        // Create a test job
        let job = EvaluationJob::new(
            "Test Job".to_string(),
            vec![],
            vec![],
            vec![],
        );
        
        // Save and load job
        storage.save_job(&job).unwrap();
        let loaded_job = storage.load_job(&job.id.to_string()).unwrap();
        
        assert_eq!(job.id, loaded_job.id);
        assert_eq!(job.name, loaded_job.name);
    }
    
    #[test]
    fn test_result_verification() {
        use crate::types::{EvaluationResults, ModelResults};
        use std::collections::HashMap;
        
        let mut results = EvaluationResults {
            job_id: Uuid::new_v4(),
            completed_at: Utc::now(),
            model_results: HashMap::new(),
            aggregate_scores: HashMap::new(),
            summary: crate::types::ResultSummary {
                total_prompts: 0,
                successful_completions: 0,
                failed_completions: 0,
                best_performing_model: None,
                worst_performing_model: None,
                average_scores: HashMap::new(),
                ranking: vec![],
            },
            verification_hash: String::new(),
        };
        
        // Calculate and set hash
        results.verification_hash = ResultVerifier::calculate_hash(&results);
        
        // Verify results
        assert!(ResultVerifier::verify_results(&results));
        
        // Modify results and verify it fails
        results.aggregate_scores.insert("test".to_string(), 1.0);
        assert!(!ResultVerifier::verify_results(&results));
    }
}
