/**
 * Advanced evaluation example with multiple models and comprehensive metrics
 */

import axios from 'axios';

interface EvaluationConfig {
    name: string;
    prompts: Array<{
        id: string;
        text: string;
        expected_output?: string;
        category?: string;
    }>;
    models: Array<{
        id: string;
        provider: string;
        model_name: string;
        parameters?: Record<string, any>;
    }>;
    metrics: Array<{
        name: string;
        enabled: boolean;
        weight: number;
    }>;
    config?: {
        parallel_requests?: number;
        timeout_seconds?: number;
        retry_attempts?: number;
    };
}

class TrustLLMExample {
    private apiUrl = 'http://localhost:3000/api/v1';

    async runAdvancedEvaluation() {
        console.log('Starting advanced evaluation example');

        try {
            // Create comprehensive evaluation
            const config: EvaluationConfig = {
                name: 'Advanced LLM Comparison Study',
                prompts: [
                    {
                        id: 'reasoning',
                        text: 'A farmer has 17 sheep. All but 9 die. How many sheep are left?',
                        expected_output: '9',
                        category: 'logical_reasoning'
                    },
                    {
                        id: 'creativity',
                        text: 'Write a creative story about a robot learning to paint, in exactly 50 words.',
                        category: 'creative_writing'
                    },
                    {
                        id: 'math',
                        text: 'Calculate the area of a circle with radius 5 units. Show your work.',
                        expected_output: '78.54 square units',
                        category: 'mathematics'
                    },
                    {
                        id: 'knowledge',
                        text: 'Explain the concept of photosynthesis in simple terms suitable for a 10-year-old.',
                        category: 'science_explanation'
                    },
                    {
                        id: 'analysis',
                        text: 'Compare and contrast the themes in Shakespeare\'s Romeo and Juliet versus Hamlet.',
                        category: 'literary_analysis'
                    }
                ],
                models: [
                    {
                        id: 'gpt-4',
                        provider: 'openai',
                        model_name: 'gpt-4',
                        parameters: {
                            temperature: 0.7,
                            max_tokens: 200
                        }
                    },
                    {
                        id: 'gpt-3.5',
                        provider: 'openai',
                        model_name: 'gpt-3.5-turbo',
                        parameters: {
                            temperature: 0.7,
                            max_tokens: 200
                        }
                    },
                    {
                        id: 'claude-3-opus',
                        provider: 'anthropic',
                        model_name: 'claude-3-opus-20240229',
                        parameters: {
                            temperature: 0.7,
                            max_tokens: 200
                        }
                    },
                    {
                        id: 'claude-3-sonnet',
                        provider: 'anthropic',
                        model_name: 'claude-3-sonnet-20240229',
                        parameters: {
                            temperature: 0.7,
                            max_tokens: 200
                        }
                    }
                ],
                metrics: [
                    { name: 'exact_match', enabled: true, weight: 1.0 },
                    { name: 'bleu', enabled: true, weight: 0.8 },
                    { name: 'rouge', enabled: true, weight: 0.7 },
                    { name: 'embedding_similarity', enabled: true, weight: 0.9 },
                    { name: 'latency', enabled: true, weight: 0.4 },
                    { name: 'cost', enabled: true, weight: 0.3 },
                    { name: 'toxicity', enabled: true, weight: 0.5 }
                ],
                config: {
                    parallel_requests: 8,
                    timeout_seconds: 180,
                    retry_attempts: 2
                }
            };

            console.log('Starting evaluation with', config.models.length, 'models and', config.prompts.length, 'prompts');

            // Start evaluation
            const startResponse = await axios.post(`${this.apiUrl}/eval/run`, config);
            const jobId = startResponse.data.data.job_id;
            
            console.log('Evaluation started with job ID:', jobId);

            // Monitor progress
            await this.monitorJob(jobId);

            // Get final results
            const resultsResponse = await axios.get(`${this.apiUrl}/results/${jobId}`);
            const results = resultsResponse.data.data;

            console.log('Evaluation completed!');
            this.displayResults(results);

            // Run comparison analysis
            await this.runComparisons([jobId]);

        } catch (error: any) {
            console.error('Error:', error.response?.data?.error || error.message);
        }
    }

    private async monitorJob(jobId: string) {
        console.log('Monitoring job progress...');
        
        const maxWait = 10 * 60 * 1000; // 10 minutes
        const pollInterval = 5000; // 5 seconds
        const startTime = Date.now();

        while (Date.now() - startTime < maxWait) {
            try {
                const statusResponse = await axios.get(`${this.apiUrl}/results/${jobId}/status`);
                const status = statusResponse.data.data;

                if (status.status === 'completed') {
                    console.log('Job completed!');
                    return;
                }

                if (status.status === 'failed') {
                    throw new Error('Job failed');
                }

                if (status.progress) {
                    console.log(`Progress: ${status.status} - ${status.progress.percentage}% (${status.progress.completed_prompts}/${status.progress.total_prompts} prompts)`);
                } else {
                    console.log(`Status: ${status.status}`);
                }

                await new Promise(resolve => setTimeout(resolve, pollInterval));

            } catch (error: any) {
                console.error('Error checking status:', error.message);
                break;
            }
        }
    }

    private displayResults(results: any) {
        console.log('\nEvaluation Results Summary');
        console.log('================================');
        
        if (results.results?.summary) {
            const summary = results.results.summary;
            console.log(`Total Evaluations: ${summary.total_evaluations}`);
            console.log(`Success Rate: ${(summary.success_rate * 100).toFixed(1)}%`);
            console.log(`Average Score: ${summary.average_score.toFixed(3)}`);
            console.log(`Total Cost: $${summary.total_cost_usd.toFixed(4)}`);
            console.log(`Total Time: ${(summary.total_latency_ms / 1000).toFixed(1)}s`);
        }

        console.log('\nModel Performance Breakdown');
        console.log('================================');

        if (results.results?.model_results) {
            const modelData = [];

            for (const [modelId, modelResult] of Object.entries(results.results.model_results)) {
                const result = modelResult as any;
                
                // Calculate average metric score
                const metricScores = Object.values(result.metrics).map((m: any) => m.score);
                const avgScore = metricScores.reduce((a: number, b: number) => a + b, 0) / metricScores.length;

                modelData.push({
                    model: modelId,
                    avgScore: avgScore.toFixed(3),
                    latency: `${result.performance.average_latency_ms.toFixed(0)}ms`,
                    cost: `$${result.performance.total_cost_usd.toFixed(4)}`,
                    success: `${(result.performance.success_rate * 100).toFixed(1)}%`,
                    tokens: result.performance.total_tokens
                });
            }

            // Sort by average score
            modelData.sort((a, b) => parseFloat(b.avgScore) - parseFloat(a.avgScore));

            // Display as table
            console.log('Rank | Model           | Avg Score | Latency | Cost    | Success | Tokens');
            console.log('-----|-----------------|-----------|---------|---------|---------|-------');
            
            modelData.forEach((model, index) => {
                const rank = (index + 1).toString().padStart(4);
                const modelName = model.model.padEnd(15);
                const score = model.avgScore.padStart(9);
                const latency = model.latency.padStart(7);
                const cost = model.cost.padStart(7);
                const success = model.success.padStart(7);
                const tokens = model.tokens.toString().padStart(6);
                
                console.log(`${rank} | ${modelName} | ${score} | ${latency} | ${cost} | ${success} | ${tokens}`);
            });
        }

        console.log('\nDetailed Metric Scores');
        console.log('===========================');

        if (results.results?.model_results) {
            for (const [modelId, modelResult] of Object.entries(results.results.model_results)) {
                console.log(`\n${modelId}:`);
                const result = modelResult as any;
                
                for (const [metricName, metric] of Object.entries(result.metrics)) {
                    const metricData = metric as any;
                    console.log(`   ${metricName.padEnd(20)}: ${metricData.score.toFixed(3)}`);
                }
            }
        }
    }

    private async runComparisons(jobIds: string[]) {
        if (jobIds.length < 2) {
            console.log('\nNeed at least 2 jobs for comparison');
            return;
        }

        console.log('\nRunning comparison analysis...');

        try {
            const comparisonResponse = await axios.post(`${this.apiUrl}/compare`, {
                job_ids: jobIds,
                group_by: 'model'
            });

            const comparison = comparisonResponse.data.data;
            console.log('Comparison completed');
            console.log('Results available for further analysis');

            // Get leaderboard
            const leaderboardResponse = await axios.get(`${this.apiUrl}/compare/leaderboard?limit=10`);
            const leaderboard = leaderboardResponse.data.data;

            console.log('\nOverall Model Leaderboard');
            console.log('=============================');
            
            leaderboard.rankings.forEach((model: any, index: number) => {
                const medal = index === 0 ? '1.' : index === 1 ? '2.' : index === 2 ? '3.' : `${index + 1}.`;
                console.log(`${medal} ${model.model_id} (${model.provider}) - Score: ${model.score.toFixed(3)}`);
            });

        } catch (error: any) {
            console.error('Comparison error:', error.response?.data?.error || error.message);
        }
    }

    async generateSampleConfig() {
        try {
            const response = await axios.get(`${this.apiUrl}/eval/sample-config`);
            const config = response.data.data;
            
            console.log('Sample configuration generated:');
            console.log(JSON.stringify(config, null, 2));
            
            return config;
        } catch (error: any) {
            console.error('Error generating config:', error.message);
        }
    }

    async listJobs() {
        try {
            const response = await axios.get(`${this.apiUrl}/eval/jobs?limit=10`);
            const jobs = response.data.data;
            
            console.log('\nRecent Evaluation Jobs');
            console.log('===========================');
            
            if (jobs.length === 0) {
                console.log('No jobs found.');
                return;
            }

            jobs.forEach((job: any) => {
                const status = job.status.toUpperCase();
                const created = new Date(job.created_at).toLocaleString();
                console.log(`${job.id.slice(0, 8)}... | ${job.name.padEnd(30)} | ${status.padEnd(10)} | ${created}`);
            });

        } catch (error: any) {
            console.error('Error listing jobs:', error.message);
        }
    }

    async getSystemMetrics() {
        try {
            const [metricsResponse, providersResponse] = await Promise.all([
                axios.get(`${this.apiUrl}/eval/metrics`),
                axios.get(`${this.apiUrl}/eval/providers`)
            ]);

            console.log('\nAvailable Metrics:', metricsResponse.data.data.join(', '));
            console.log('Available Providers:', providersResponse.data.data.join(', '));

        } catch (error: any) {
            console.error('Error getting system info:', error.message);
        }
    }
}

// Main execution
async function main() {
    const example = new TrustLLMExample();

    console.log('TrustLLM Advanced Evaluation Example');
    console.log('========================================\n');

    // Show system information
    await example.getSystemMetrics();

    // List existing jobs
    await example.listJobs();

    // Generate sample config
    console.log('\nGenerating sample configuration...');
    await example.generateSampleConfig();

    // Run the main evaluation
    console.log('\nStarting comprehensive evaluation...');
    await example.runAdvancedEvaluation();
}

// Run example if called directly
if (import.meta.main) {
    main().catch(console.error);
}

export { TrustLLMExample };
