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

#[derive(Parser)]
#[command(name = "eaas")]
#[command(about = "TrustLLM Eval As A Service")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Run an evaluation job
    Run {
        /// Path to configuration file
        #[arg(short, long)]
        config: String,
        /// Output directory for results
        #[arg(short, long, default_value = "./results")]
        output: String,
    },
    /// Validate configuration
    Validate {
        /// Path to configuration file
        #[arg(short, long)]
        config: String,
    },
    /// List available metrics
    ListMetrics,
    /// List available model providers
    ListProviders,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Load environment variables from .env file
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
            let registry = ModelRegistry::new();
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
                
                // Check if API key is available
                let api_key_available = match provider.as_str() {
                    "together" => std::env::var("TOGETHER_API_KEY").is_ok(),
                    "groq" => std::env::var("GROQ_API_KEY").is_ok(),
                    "cohere" => std::env::var("COHERE_API_KEY").is_ok(),
                    "openrouter" => std::env::var("OPENROUTER_API_KEY").is_ok(),
                    _ => false,
                };
                
                let status = if api_key_available { "✓" } else { "✗" };
                println!("  {} {} - {} (API key: {})", status, provider, description, 
                    if api_key_available { "configured" } else { "missing" });
            }
            
            println!("\nEnvironment Variables:");
            println!("  TOGETHER_API_KEY: {}", if std::env::var("TOGETHER_API_KEY").is_ok() { "Set" } else { "Not set" });
            println!("  GROQ_API_KEY: {}", if std::env::var("GROQ_API_KEY").is_ok() { "Set" } else { "Not set" });
            println!("  COHERE_API_KEY: {}", if std::env::var("COHERE_API_KEY").is_ok() { "Set" } else { "Not set" });
            println!("  OPENROUTER_API_KEY: {}", if std::env::var("OPENROUTER_API_KEY").is_ok() { "Set" } else { "Not set" });
        }
    }
    
    Ok(())
}