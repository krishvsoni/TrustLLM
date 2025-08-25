use clap::{Parser, Subcommand};
use anyhow::Result;
use log::info;

mod config;
mod metrics;
mod models;
mod runner;
mod storage;
mod types;

use crate::config::EvalConfig;
use crate::runner::EvalRunner;
use crate::models::ModelRegistry;
use crate::storage::{FileSystemStorage, EvalLogger, ResultVerifier, Storage};

#[derive(Parser)]
#[command(name = "eaas")]
#[command(about = "TrustLLM Eval As A Service")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Run {
        #[arg(short, long)]
        config: String,
        #[arg(short, long, default_value = "./results")]
        output: String,
    },
    Validate {
        #[arg(short, long)]
        config: String,
    },
    ListMetrics,
    ListProviders,
    GenerateConfig {
        #[arg(short, long, default_value = "generated_config.json")]
        output: String,
    },
    ListJobs,
    ShowResults {
        job_id: String,
    },
    ShowLogs {
        #[arg(short, long)]
        job_id: Option<String>,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    dotenv::dotenv().ok();
    env_logger::init();
    let cli = Cli::parse();

    match cli.command {
        Commands::Run { config, output } => {
            info!("Loading configuration from: {}", config);
            let config = EvalConfig::load(&config)?;
            info!("Starting evaluation run with output to: {}", output);
            let runner = EvalRunner::new(config, output).await?;
            runner.run().await?;
        }
        Commands::Validate { config } => {
            info!("Validating configuration: {}", config);
            let config = EvalConfig::load(&config)?;
            println!("Configuration is valid");
            println!("Metrics: {:?}", config.metrics.keys().collect::<Vec<_>>());
            println!("Models: {:?}", config.models.keys().collect::<Vec<_>>());
        }
        Commands::ListMetrics => {
            println!("Available Metrics:");
            println!("  bleu - BLEU score for text similarity");
            println!("  rouge - ROUGE score for summarization");
            println!("  exact_match - Exact string matching");
            println!("  embedding_similarity - Semantic similarity using embeddings");
            println!("  latency - Response time measurement");
            println!("  cost - Token cost calculation");
            println!("  toxicity - Content toxicity detection");
        }
        Commands::ListProviders => {
            println!("Checking provider status...\n");
            let registry = ModelRegistry::new();
            let health_status = registry.health_check().await;
            let providers = registry.list_providers();

            println!("Available Model Providers:");
            for provider in providers {
                let description = match provider.as_str() {
                    "together" => "Together AI - Open source models",
                    "groq" => "Groq - High-speed inference", 
                    "cohere" => "Cohere - Language models",
                    "openrouter" => "OpenRouter - API gateway",
                    _ => "Custom provider",
                };

                let api_key_available = match provider.as_str() {
                    "together" => std::env::var("TOGETHER_API_KEY").is_ok(),
                    "groq" => std::env::var("GROQ_API_KEY").is_ok(),
                    "cohere" => std::env::var("COHERE_API_KEY").is_ok(),
                    "openrouter" => std::env::var("OPENROUTER_API_KEY").is_ok(),
                    _ => false,
                };

                let status = if api_key_available { "configured" } else { "missing" };
                let health = if *health_status.get(&provider).unwrap_or(&false) { "healthy" } else { "unhealthy" };
                println!("  {} - {} - {} ({})", provider, description, health, status);
            }

            println!("\nEnvironment Variables:");
            println!("  TOGETHER_API_KEY: {}", if std::env::var("TOGETHER_API_KEY").is_ok() { "Set" } else { "Not set" });
            println!("  GROQ_API_KEY: {}", if std::env::var("GROQ_API_KEY").is_ok() { "Set" } else { "Not set" });
            println!("  COHERE_API_KEY: {}", if std::env::var("COHERE_API_KEY").is_ok() { "Set" } else { "Not set" });
            println!("  OPENROUTER_API_KEY: {}", if std::env::var("OPENROUTER_API_KEY").is_ok() { "Set" } else { "Not set" });
        }
        Commands::GenerateConfig { output } => {
            println!("Generating sample configuration...");
            let sample_config = EvalConfig::sample();
            sample_config.save(&output)?;
            println!("Sample configuration saved to: {}", output);
            println!("You can now customize it and run: cargo run -- run --config {}", output);
        }
        Commands::ListJobs => {
            let storage = FileSystemStorage::new("./results".to_string())?;
            let jobs = storage.list_jobs()?;

            if jobs.is_empty() {
                println!("No evaluation jobs found.");
            } else {
                println!("Previous Evaluation Jobs:");
                for job in jobs {
                    println!("  {} - {} ({})", job.id, job.name, job.status);
                    println!("    Created: {}", job.created_at.format("%Y-%m-%d %H:%M:%S"));
                    if let Some(completed) = job.completed_at {
                        println!("    Completed: {}", completed.format("%Y-%m-%d %H:%M:%S"));
                    }
                    println!();
                }
            }
        }
        Commands::ShowResults { job_id } => {
            let storage = FileSystemStorage::new("./results".to_string())?;
            match storage.load_results(&job_id)? {
                Some(results) => {
                    println!("Results for job: {}", job_id);
                    println!("Completed: {}", results.completed_at.format("%Y-%m-%d %H:%M:%S"));
                    println!("Verification hash: {}", results.verification_hash);

                    if ResultVerifier::verify_results(&results) {
                        println!("Results verified successfully");
                    } else {
                        println!("Results verification failed - data may be corrupted");
                    }

                    println!("\nModel Performance Summary:");
                    for (model_id, model_result) in &results.model_results {
                        println!("  {}: {} successes, {} errors", 
                            model_id, 
                            model_result.outputs.len(), 
                            model_result.errors.len()
                        );
                    }
                }
                None => {
                    println!("No results found for job ID: {}", job_id);
                }
            }
        }
        Commands::ShowLogs { job_id } => {
            let storage = FileSystemStorage::new("./results".to_string())?;
            let logger = EvalLogger::new(
                job_id.clone().unwrap_or_else(|| "all".to_string()),
                &storage
            );

            let logs = logger.read_logs()?;

            if logs.is_empty() {
                println!("No logs found.");
            } else {
                println!("Evaluation Logs:");
                for log in logs {
                    println!("[{}] {}: {:?}", 
                        log.timestamp.format("%Y-%m-%d %H:%M:%S"),
                        log.job_id,
                        log.event
                    );
                }
            }
        }
    }

    Ok(())
}
