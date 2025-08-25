# TrustLLM - Evaluation as a Service

> **Phase 2 Complete**: Full TypeScript API, CLI, and SDK Implementation

TrustLLM is a comprehensive platform for evaluating Large Language Models across multiple providers, metrics, and use cases. This repository contains the complete **Phase 2** implementation with a TypeScript API, CLI tool, and SDK.

## What's Built

### Phase 1 - Core Foundations (Rust EaaS Engine)
- **Evaluation Metrics**: BLEU, ROUGE, exact match, latency, cost, toxicity, etc.
- **Parallel Execution**: Run prompts across multiple providers simultaneously
- **Structured Storage**: JSON results with verification and hashing
- **Logging System**: Comprehensive structured logs for every evaluation

### Phase 2 - API + Developer Interface (TypeScript)
- **REST API**: Full-featured API with Swagger documentation
- **SDK**: TypeScript/JavaScript client library (`@trustllm/client`)
- **CLI Tool**: Command-line interface for developers (`@trustllm/cli`)

## Quick Start

### 1. Start the API Server

```bash
cd api
bun install
bun run dev
```

The API will be available at `http://localhost:3000` with documentation at `http://localhost:3000/docs`.

### 2. Use the CLI Tool

```bash
cd cli
bun install

# Generate sample configuration
bun run src/cli.ts config -o my-eval.json

# Run evaluation
bun run src/cli.ts run my-eval.json --watch

# Check status
bun run src/cli.ts status <job-id>

# View results
bun run src/cli.ts results <job-id>

# Compare multiple jobs
bun run src/cli.ts compare <job-id-1> <job-id-2>

# View leaderboard
bun run src/cli.ts leaderboard
```

### 3. Use the SDK

```bash
cd sdk
bun install
```

```typescript
import { TrustLLMClient, EvaluationBuilder, utils } from '@trustllm/client';

const client = new TrustLLMClient({
    baseURL: 'http://localhost:3000/api/v1'
});

// Build evaluation configuration
const config = new EvaluationBuilder()
    .name('My LLM Evaluation')
    .addPrompt(utils.createPrompt('q1', 'Explain AI in simple terms'))
    .addPrompt(utils.createPrompt('q2', 'What is 25% of 80?', '20'))
    .addModel(utils.createOpenAIModel('gpt35', 'gpt-3.5-turbo'))
    .addModel(utils.createAnthropicModel('claude', 'claude-3-sonnet'))
    .addMetrics([
        utils.createMetrics.exactMatch(),
        utils.createMetrics.bleu(),
        utils.createMetrics.latency()
    ])
    .build();

// Run evaluation
const jobId = await client.runEval(config);
console.log('Started job:', jobId);

// Wait for completion with progress updates
const results = await client.waitForCompletion(jobId, {
    onProgress: (progress) => {
        console.log(`Progress: ${progress.progress?.percentage}%`);
    }
});

console.log('Results:', results);
```

## API Endpoints

### Evaluation
- `POST /api/v1/eval/run` - Start new evaluation
- `GET /api/v1/eval/jobs` - List all jobs
- `GET /api/v1/eval/metrics` - Get available metrics
- `GET /api/v1/eval/providers` - Get available providers
- `GET /api/v1/eval/sample-config` - Generate sample config

### Results
- `GET /api/v1/results/{jobId}` - Get job results
- `GET /api/v1/results/{jobId}/status` - Get job status
- `GET /api/v1/results/{jobId}/download` - Download results (JSON/CSV)
- `GET /api/v1/results/summary` - Get summary statistics

### Comparison
- `POST /api/v1/compare` - Compare multiple jobs
- `GET /api/v1/compare/leaderboard` - Model performance leaderboard
- `GET /api/v1/compare/models` - Compare specific models
- `GET /api/v1/compare/trends` - Performance trends over time

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   CLI Tool      │    │   TypeScript    │    │   JavaScript    │
│   (@trustllm/   │    │   API Server    │    │   SDK Client    │
│    cli)         │    │   (Fastify)     │    │ (@trustllm/     │
└─────────────────┘    └─────────────────┘    │  client)        │
                 │                       │             └─────────────────┘
                 │              HTTP/REST│                      │
                 └───────────────────────┼──────────────────────┘
                                                                 │
                                ┌─────────────────▼─────────────────┐
                                │         Rust Evaluation Engine    │
                                │         (Fast, Parallel Core)     │
                                │                                   │
                                │  • Metrics calculation            │
                                │  • Model provider integration     │
                                │  • Result storage & verification  │
                                │  • Structured logging             │
                                └───────────────────────────────────┘
```

## Evaluation Configuration

### Sample Configuration

```json
{
    "name": "LLM Comparison Study",
    "prompts": [
        {
            "id": "explain_ai",
            "text": "Explain artificial intelligence in simple terms",
            "expected_output": "AI is technology that enables machines to simulate human intelligence",
            "category": "explanation"
        },
        {
            "id": "math_problem",
            "text": "What is 15% of 240?",
            "expected_output": "36",
            "category": "mathematics"
        }
    ],
    "models": [
        {
            "id": "gpt-4",
            "provider": "openai",
            "model_name": "gpt-4",
            "parameters": {
                "temperature": 0.7,
                "max_tokens": 150
            }
        },
        {
            "id": "claude-3",
            "provider": "anthropic",
            "model_name": "claude-3-sonnet-20240229",
            "parameters": {
                "temperature": 0.7,
                "max_tokens": 150
            }
        }
    ],
    "metrics": [
        {
            "name": "exact_match",
            "enabled": true,
            "weight": 1.0
        },
        {
            "name": "bleu",
            "enabled": true,
            "weight": 0.8
        },
        {
            "name": "latency",
            "enabled": true,
            "weight": 0.3
        },
        {
            "name": "cost",
            "enabled": true,
            "weight": 0.2
        }
    ],
    "config": {
        "parallel_requests": 5,
        "timeout_seconds": 120,
        "retry_attempts": 3
    }
}
```

## CLI Commands

### Basic Usage

```bash
# Generate sample configuration
trustllm config -o evaluation.json

# Run evaluation from file
trustllm run evaluation.json --watch

# Run with specific models only
trustllm run evaluation.json -m gpt-4,claude-3

# Interactive setup (no config file)
trustllm run
```

### Job Management

```bash
# List all jobs
trustllm list

# Filter by status
trustllm list --status completed

# Get job status
trustllm status <job-id>

# Get detailed results
trustllm results <job-id>

# Download results as CSV
trustllm results <job-id> --format csv --output results.csv
```

### Analysis & Comparison

```bash
# Compare multiple jobs
trustllm compare <job-id-1> <job-id-2> <job-id-3>

# Group comparison by prompts instead of models
trustllm compare <job-id-1> <job-id-2> --group-by prompt

# Model leaderboard
trustllm leaderboard

# Filter leaderboard by metric
trustllm leaderboard --metric bleu --limit 5
```

## SDK Examples

### Basic Evaluation

```typescript
import { TrustLLMClient } from '@trustllm/client';

const client = new TrustLLMClient();

// Start evaluation
const jobId = await client.runEval({
    name: 'Quick Test',
    prompts: [
        { id: 'test1', text: 'Hello, how are you?' }
    ],
    models: [
        {
            id: 'gpt35',
            provider: 'openai',
            model_name: 'gpt-3.5-turbo'
        }
    ],
    metrics: [
        { name: 'latency', enabled: true }
    ]
});

// Get results
const results = await client.getResults(jobId);
```

### Advanced Usage with Builder Pattern

```typescript
import { EvaluationBuilder, utils } from '@trustllm/client';

const evaluation = new EvaluationBuilder()
    .name('Comprehensive AI Evaluation')
    
    // Add prompts
    .addPrompts([
        utils.createPrompt('reasoning', 'If a train travels 60 mph for 2 hours, how far does it go?', '120 miles'),
        utils.createPrompt('creativity', 'Write a haiku about programming'),
        utils.createPrompt('knowledge', 'What is the capital of France?', 'Paris')
    ])
    
    // Add models
    .addModels([
        utils.createOpenAIModel('gpt4', 'gpt-4'),
        utils.createAnthropicModel('claude', 'claude-3-opus'),
        {
            id: 'local-llama',
            provider: 'local',
            model_name: 'llama-2-7b',
            endpoint: 'http://localhost:8000'
        }
    ])
    
    // Add metrics
    .addMetrics([
        utils.createMetrics.exactMatch(1.0),
        utils.createMetrics.bleu(0.8),
        utils.createMetrics.latency(0.3),
        utils.createMetrics.cost(0.2)
    ])
    
    // Set configuration
    .setConfig({
        parallel_requests: 10,
        timeout_seconds: 180,
        retry_attempts: 2
    })
    
    .build();

// Run and wait for completion
const results = await client.runEvalAndWait(evaluation, {
    onProgress: (progress) => {
        console.log(`${progress.status}: ${progress.progress?.percentage || 0}%`);
    }
});
```

### Event-Driven Usage

```typescript
const client = new TrustLLMClient();

// Listen for events
client.on('jobStarted', ({ jobId }) => {
    console.log('Job started:', jobId);
});

client.on('jobProgress', (progress) => {
    console.log('Progress update:', progress);
});

client.on('jobCompleted', (results) => {
    console.log('Job completed:', results.id);
    console.log('Summary:', results.results?.summary);
});

client.on('error', (error) => {
    console.error('Error:', error.message);
});

// Start evaluation
const jobId = await client.runEval(config);
await client.waitForCompletion(jobId);
```

### Comparison and Analysis

```typescript
// Compare multiple evaluations
const comparison = await client.compareJobs({
    job_ids: ['job-1', 'job-2', 'job-3'],
    group_by: 'model',
    metrics: ['bleu', 'exact_match']
});

// Get leaderboard
const leaderboard = await client.getLeaderboard({
    metric: 'bleu',
    limit: 10,
    providers: ['openai', 'anthropic']
});

// Download results in different formats
const jsonResults = await client.downloadResults(jobId, 'json');
const csvResults = await client.downloadResults(jobId, 'csv');
```

## Features

### Implemented Features

- **Multi-Provider Support**: OpenAI, Anthropic, Together AI, HuggingFace, Local models
- **Comprehensive Metrics**: BLEU, ROUGE, exact match, semantic similarity, latency, cost, toxicity
- **Parallel Execution**: Efficient concurrent evaluation across models and prompts
- **Real-time Progress**: WebSocket-like polling for job status and progress
- **Export Options**: JSON, CSV, and HTML report generation
- **Comparison Tools**: Side-by-side model comparison with statistical analysis
- **Leaderboards**: Performance rankings across different metrics
- **SDK & CLI**: Multiple interfaces for different use cases

### Architecture Benefits

- **Fast Rust Core**: High-performance evaluation engine
- **TypeScript API**: Type-safe, well-documented REST API
- **Developer-Friendly**: Multiple interfaces (CLI, SDK, API)
- **Extensible**: Easy to add new metrics, providers, and export formats
- **Production-Ready**: Comprehensive error handling, logging, and monitoring

## Development

### Project Structure

```
TrustLLM/
├── eval/                 # Rust evaluation engine (Phase 1)
│   ├── src/
│   ├── results/          # Evaluation results storage
│   └── Cargo.toml
├── api/                  # TypeScript API server (Phase 2)
│   ├── src/
│   │   ├── routes/       # API route handlers
│   │   ├── services/     # Business logic
│   │   └── types/        # TypeScript type definitions
│   └── package.json
├── cli/                  # CLI tool (Phase 2)
│   ├── src/
│   └── package.json
└── sdk/                  # JavaScript/TypeScript SDK (Phase 2)
        ├── src/
        └── package.json
```

### Running Development Environment

```bash
# Terminal 1: Start API server
cd api && bun run dev

# Terminal 2: Test CLI
cd cli && bun run dev --help

# Terminal 3: Test SDK
cd sdk && bun run dev
```

## License

MIT License - see [LICENSE](LICENSE) for details.

.

## Support

- **Documentation**: Available at `/docs` when API is running
- **Issues**: GitHub Issues for bug reports and feature requests
- **Discussions**: GitHub Discussions for questions and community

---

> **TrustLLM**: Making LLM evaluation accessible, reliable, and scalable for everyone.
