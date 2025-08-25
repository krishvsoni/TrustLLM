import { TrustLLMClient, EvaluationBuilder, utils } from '@trustllm/client'

async function basicEvaluation() {
    console.log('Starting basic evaluation example')

    const client = new TrustLLMClient({
        baseURL: 'http://localhost:3000/api/v1'
    })

    try {
        const health = await client.health()
        console.log('API health check:', health)

        const config = new EvaluationBuilder()
            .name('Basic LLM Evaluation')
            .addPrompts([
                utils.createPrompt('greeting', 'Hello, how are you today?'),
                utils.createPrompt('math', 'What is 15 + 27?', '42'),
                utils.createPrompt('explanation', 'Explain what artificial intelligence is in one sentence')
            ])
            .addModels([
                utils.createOpenAIModel('gpt35', 'gpt-3.5-turbo'),
                utils.createAnthropicModel('claude', 'claude-3-sonnet-20240229')
            ])
            .addMetrics([
                utils.createMetrics.exactMatch(1.0),
                utils.createMetrics.latency(0.5),
                utils.createMetrics.cost(0.3)
            ])
            .build()

        console.log('Configuration created:', config.name)

        const jobId = await client.runEval(config)
        console.log('Evaluation started with job ID:', jobId)

        const results = await client.waitForCompletion(jobId, {
            pollInterval: 3000,
            onProgress: (progress) => {
                console.log(`Progress: ${progress.status} - ${progress.progress?.percentage || 0}%`)
            }
        })

        console.log('Evaluation completed!')
        console.log('Summary:', results.results?.summary)

        if (results.results?.model_results) {
            for (const [modelId, modelResult] of Object.entries(results.results.model_results)) {
                console.log(`\nModel: ${modelId}`)
                console.log(`   Average Latency: ${modelResult.performance.average_latency_ms.toFixed(0)}ms`)
                console.log(`   Total Cost: $${modelResult.performance.total_cost_usd.toFixed(4)}`)
                console.log(`   Success Rate: ${(modelResult.performance.success_rate * 100).toFixed(1)}%`)
                for (const [metricName, metric] of Object.entries(modelResult.metrics)) {
                    console.log(`   ${metricName}: ${metric.score.toFixed(3)}`)
                }
            }
        }

    } catch (error) {
        console.error('Error:', error.message)
    }
}

basicEvaluation().catch(console.error)
