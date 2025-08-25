#!/bin/bash

# TrustLLM CLI Usage Examples
# This script demonstrates various CLI commands and workflows

echo "🚀 TrustLLM CLI Examples"
echo "========================"

# Set API URL (optional, defaults to localhost:3000)
export TRUSTLLM_API_URL="http://localhost:3000/api/v1"

echo ""
echo "1. 📄 Generate sample configuration file"
trustllm config -o my-evaluation.json
echo "✅ Configuration saved to my-evaluation.json"

echo ""
echo "2. 🔍 List available metrics and providers"
trustllm eval metrics
trustllm eval providers

echo ""
echo "3. 🏃 Run evaluation with watch mode"
echo "   This will start an evaluation and monitor progress until completion"
trustllm run my-evaluation.json --watch

echo ""
echo "4. 📋 List all evaluation jobs"
trustllm list

echo ""
echo "5. 📊 Check status of a specific job"
echo "   Replace <job-id> with actual job ID from step 3"
# trustllm status <job-id>

echo ""
echo "6. 📥 Get detailed results"
echo "   Replace <job-id> with actual job ID"
# trustllm results <job-id>

echo ""
echo "7. 💾 Download results in different formats"
echo "   Download as JSON"
# trustllm results <job-id> --output results.json

echo "   Download as CSV"
# trustllm results <job-id> --format csv --output results.csv

echo ""
echo "8. 🔄 Compare multiple evaluation jobs"
echo "   Replace <job-id-1> and <job-id-2> with actual job IDs"
# trustllm compare <job-id-1> <job-id-2>

echo ""
echo "9. 🏆 View model leaderboard"
trustllm leaderboard

echo ""
echo "10. 📈 Filter leaderboard by specific metric"
trustllm leaderboard --metric bleu --limit 5

echo ""
echo "11. 🎯 Run evaluation with specific models only"
trustllm run my-evaluation.json --models gpt-4,claude-3 --watch

echo ""
echo "12. 📊 Interactive evaluation setup"
echo "    Run without config file for interactive setup"
# trustllm run

echo ""
echo "🎉 CLI examples completed!"
echo ""
echo "💡 Tips:"
echo "  - Use --help with any command for detailed options"
echo "  - Set TRUSTLLM_API_URL environment variable to use different API endpoint"
echo "  - Use --output to save results to files"
echo "  - Use --watch to monitor job progress in real-time"
