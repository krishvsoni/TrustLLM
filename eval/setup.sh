#!/bin/bash

# TrustLLM Configuration Generator
echo "TrustLLM"
echo "=================================================="

# Create sample config using the built-in sample generator
cargo run -- validate --config sample_config.json 2>/dev/null || {
    echo "Generating sample configuration..."
    
    # Run cargo to build if needed
    cargo build --release
    
    # Use the sample config that's already created
    echo "Sample configuration available at: sample_config.json"
}

echo ""
echo "Available Commands:"
echo "  • Validate config:     cargo run -- validate --config sample_config.json"
echo "  • Run evaluation:      cargo run -- run --config sample_config.json"
echo "  • List metrics:        cargo run -- list-metrics"
echo "  • List providers:      cargo run -- list-providers"
echo ""
echo "Note: Set API keys as environment variables:"
echo "  • export TOGETHER_API_KEY=your_key_here"
echo "  • export GROQ_API_KEY=your_key_here"
echo ""
echo "For more information, run: cargo run -- --help"
