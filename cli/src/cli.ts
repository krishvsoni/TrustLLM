#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import Table from 'cli-table3';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import axios from 'axios';
import { config } from 'dotenv';

config();

const program = new Command();
const API_BASE_URL = process.env.TRUSTLLM_API_URL || 'http://localhost:3000/api/v1';

axios.defaults.baseURL = API_BASE_URL;
axios.defaults.timeout = 30000;

program
  .name('trustllm')
  .description('TrustLLM CLI - Evaluation as a Service')
  .version('1.0.0');

program
  .command('run')
  .description('Run an evaluation job')
  .argument('[config-file]', 'Path to evaluation configuration file')
  .option('-m, --models <models>', 'Comma-separated list of model IDs')
  .option('-o, --output <format>', 'Output format (json, table, csv)', 'table')
  .option('-w, --watch', 'Watch job progress until completion')
  .option('--api-url <url>', 'Override API base URL')
  .action(async (configFile, options) => {
    try {
      let config;

      if (configFile) {
        // Load configuration from file
        const configData = await readFile(configFile, 'utf-8');
        config = JSON.parse(configData);
      } else {
        // Interactive configuration
        config = await createInteractiveConfig();
      }

      // Override models if specified
      if (options.models) {
        const modelIds = options.models.split(',');
        config.models = config.models.filter((m: any) => modelIds.includes(m.id));
      }

      // Start evaluation
      const spinner = ora('Starting evaluation...').start();
      
      try {
        const response = await axios.post('/eval/run', config);
        const { job_id } = response.data.data;
        
        spinner.succeed(`Evaluation started: ${chalk.green(job_id)}`);

        if (options.watch) {
          await watchJob(job_id, options.output);
        } else {
          console.log(`\\nRun ${chalk.cyan('trustllm status ' + job_id)} to check progress`);
          console.log(`Run ${chalk.cyan('trustllm results ' + job_id)} to view results`);
        }

      } catch (error: any) {
        spinner.fail('Failed to start evaluation');
        if (error.response?.data?.error) {
          console.error(chalk.red(error.response.data.error));
        } else {
          console.error(chalk.red(error.message));
        }
        process.exit(1);
      }

    } catch (error: any) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Status command
program
  .command('status')
  .description('Get status of an evaluation job')
  .argument('<job-id>', 'Job ID to check status for')
  .action(async (jobId) => {
    try {
      const response = await axios.get(`/results/${jobId}/status`);
      const job = response.data.data;

      console.log(chalk.bold('\\n Job Status\\n'));
      
      const table = new Table({
        chars: { 'top': '═', 'top-mid': '╤', 'top-left': '╔', 'top-right': '╗',
                 'bottom': '═', 'bottom-mid': '╧', 'bottom-left': '╚', 'bottom-right': '╝',
                 'left': '║', 'left-mid': '╟', 'mid': '─', 'mid-mid': '┼',
                 'right': '║', 'right-mid': '╢', 'middle': '│' }
      });

      table.push(
        ['Job ID', job.job_id],
        ['Status', getStatusColor(job.status)],
        ['Created', new Date(job.created_at).toLocaleString()],
        ['Completed', job.completed_at ? new Date(job.completed_at).toLocaleString() : 'N/A']
      );

      if (job.progress) {
        table.push(
          ['Progress', `${job.progress.percentage}% (${job.progress.completed_prompts}/${job.progress.total_prompts} prompts)`]
        );
      }

      console.log(table.toString());

    } catch (error: any) {
      if (error.response?.status === 404) {
        console.error(chalk.red('Job not found'));
      } else {
        console.error(chalk.red('Error:'), error.response?.data?.error || error.message);
      }
      process.exit(1);
    }
  });

// Results command
program
  .command('results')
  .description('Get results of an evaluation job')
  .argument('<job-id>', 'Job ID to get results for')
  .option('-f, --format <format>', 'Output format (json, table, csv)', 'table')
  .option('-m, --metric <metric>', 'Show specific metric only')
  .option('-o, --output <file>', 'Save results to file')
  .action(async (jobId, options) => {
    try {
      const response = await axios.get(`/results/${jobId}`);
      const job = response.data.data;

      if (job.status !== 'completed') {
        console.log(chalk.yellow(`Job is ${job.status}. Run 'trustllm status ${jobId}' for more info.`));
        return;
      }

      if (!job.results) {
        console.log(chalk.yellow('No results available yet.'));
        return;
      }

      const formattedResults = formatResults(job, options.format, options.metric);

      if (options.output) {
        await writeFile(options.output, formattedResults);
        console.log(chalk.green(`Results saved to ${options.output}`));
      } else {
        console.log(formattedResults);
      }

    } catch (error: any) {
      if (error.response?.status === 404) {
        console.error(chalk.red('Job not found'));
      } else {
        console.error(chalk.red('Error:'), error.response?.data?.error || error.message);
      }
      process.exit(1);
    }
  });

// List jobs command
program
  .command('list')
  .description('List evaluation jobs')
  .option('-s, --status <status>', 'Filter by status (pending, running, completed, failed)')
  .option('-n, --limit <number>', 'Number of jobs to show', '10')
  .action(async (options) => {
    try {
      const params = new URLSearchParams();
      if (options.status) params.append('status', options.status);
      params.append('limit', options.limit);

      const response = await axios.get(`/eval/jobs?${params}`);
      const jobs = response.data.data;

      if (jobs.length === 0) {
        console.log(chalk.yellow('No jobs found.'));
        return;
      }

      console.log(chalk.bold('\\n📋 Evaluation Jobs\\n'));

      const table = new Table({
        head: ['Job ID', 'Name', 'Status', 'Created', 'Completed'],
        chars: { 'top': '═', 'top-mid': '╤', 'top-left': '╔', 'top-right': '╗',
                 'bottom': '═', 'bottom-mid': '╧', 'bottom-left': '╚', 'bottom-right': '╝',
                 'left': '║', 'left-mid': '╟', 'mid': '─', 'mid-mid': '┼',
                 'right': '║', 'right-mid': '╢', 'middle': '│' }
      });

      jobs.forEach((job: any) => {
        table.push([
          job.id.slice(0, 8) + '...',
          job.name.slice(0, 30),
          getStatusColor(job.status),
          new Date(job.created_at).toLocaleDateString(),
          job.completed_at ? new Date(job.completed_at).toLocaleDateString() : 'N/A'
        ]);
      });

      console.log(table.toString());

    } catch (error: any) {
      console.error(chalk.red('Error:'), error.response?.data?.error || error.message);
      process.exit(1);
    }
  });

// Compare command
program
  .command('compare')
  .description('Compare results from multiple jobs')
  .argument('<job-ids...>', 'Job IDs to compare (space-separated)')
  .option('-g, --group-by <type>', 'Group by model, prompt, or metric', 'model')
  .option('-m, --metrics <metrics>', 'Comma-separated list of metrics to include')
  .option('-o, --output <file>', 'Save comparison to file')
  .action(async (jobIds, options) => {
    try {
      const compareRequest = {
        job_ids: jobIds,
        group_by: options.groupBy,
        metrics: options.metrics ? options.metrics.split(',') : undefined
      };

      const response = await axios.post('/compare', compareRequest);
      const comparison = response.data.data;

      const formattedComparison = formatComparison(comparison);

      if (options.output) {
        await writeFile(options.output, JSON.stringify(comparison, null, 2));
        console.log(chalk.green(`Comparison saved to ${options.output}`));
      } else {
        console.log(formattedComparison);
      }

    } catch (error: any) {
      console.error(chalk.red('Error:'), error.response?.data?.error || error.message);
      process.exit(1);
    }
  });

// Leaderboard command
program
  .command('leaderboard')
  .description('Show model performance leaderboard')
  .option('-m, --metric <metric>', 'Metric to rank by')
  .option('-l, --limit <number>', 'Number of models to show', '10')
  .action(async (options) => {
    try {
      const params = new URLSearchParams();
      if (options.metric) params.append('metric', options.metric);
      params.append('limit', options.limit);

      const response = await axios.get(`/compare/leaderboard?${params}`);
      const leaderboard = response.data.data;

      console.log(chalk.bold('\\n🏆 Model Performance Leaderboard\\n'));

      const table = new Table({
        head: ['Rank', 'Model', 'Provider', 'Score', 'Evaluations', 'Avg Latency', 'Avg Cost'],
        chars: { 'top': '═', 'top-mid': '╤', 'top-left': '╔', 'top-right': '╗',
                 'bottom': '═', 'bottom-mid': '╧', 'bottom-left': '╚', 'bottom-right': '╝',
                 'left': '║', 'left-mid': '╟', 'mid': '─', 'mid-mid': '┼',
                 'right': '║', 'right-mid': '╢', 'middle': '│' }
      });

      leaderboard.rankings.forEach((model: any) => {
        const rank = model.rank === 1 ? '🥇' : model.rank === 2 ? '🥈' : model.rank === 3 ? '🥉' : model.rank.toString();
        table.push([
          rank,
          model.model_id,
          model.provider,
          model.score.toFixed(3),
          model.evaluations_count,
          `${model.avg_latency_ms.toFixed(0)}ms`,
          `$${model.avg_cost_per_1k_tokens.toFixed(4)}`
        ]);
      });

      console.log(table.toString());

    } catch (error: any) {
      console.error(chalk.red('Error:'), error.response?.data?.error || error.message);
      process.exit(1);
    }
  });

// Config command
program
  .command('config')
  .description('Generate sample configuration file')
  .option('-o, --output <file>', 'Output file path', 'evaluation-config.json')
  .action(async (options) => {
    try {
      const response = await axios.get('/eval/sample-config');
      const config = response.data.data;

      await writeFile(options.output, JSON.stringify(config, null, 2));
      console.log(chalk.green(`Sample configuration saved to ${options.output}`));
      console.log(chalk.blue('\\nEdit the configuration file and run:'));
      console.log(chalk.cyan(`trustllm run ${options.output}`));

    } catch (error: any) {
      console.error(chalk.red('Error:'), error.response?.data?.error || error.message);
      process.exit(1);
    }
  });

// Helper functions

async function createInteractiveConfig() {
  console.log(chalk.bold('\\n🔧 Interactive Evaluation Setup\\n'));

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Evaluation name:',
      default: 'Interactive Evaluation'
    },
    {
      type: 'editor',
      name: 'prompts',
      message: 'Enter prompts (one per line):',
      default: 'Explain machine learning in simple terms.\\nWhat is 25% of 80?\\nWrite a haiku about AI.'
    },
    {
      type: 'checkbox',
      name: 'models',
      message: 'Select models to test:',
      choices: [
        { name: 'GPT-3.5 Turbo (OpenAI)', value: 'gpt-3.5' },
        { name: 'GPT-4 (OpenAI)', value: 'gpt-4' },
        { name: 'Claude-3 Sonnet (Anthropic)', value: 'claude-3' },
        { name: 'Mixtral 8x7B (Together)', value: 'mixtral' }
      ]
    },
    {
      type: 'checkbox',
      name: 'metrics',
      message: 'Select evaluation metrics:',
      choices: [
        { name: 'BLEU Score', value: 'bleu' },
        { name: 'Exact Match', value: 'exact_match' },
        { name: 'Latency', value: 'latency' },
        { name: 'Cost', value: 'cost' }
      ]
    }
  ]);

  // Convert to configuration format
  const prompts = answers.prompts.split('\\n')
    .filter((line: string) => line.trim())
    .map((text: string, index: number) => ({
      id: `prompt_${index + 1}`,
      text: text.trim(),
      category: 'general'
    }));

  const modelConfigs = answers.models.map((modelId: string) => ({
    id: modelId,
    provider: getProviderForModel(modelId),
    model_name: getModelName(modelId),
    parameters: { temperature: 0.7, max_tokens: 150 }
  }));

  const metricConfigs = answers.metrics.map((metric: string) => ({
    name: metric,
    enabled: true,
    weight: 1.0
  }));

  return {
    name: answers.name,
    prompts,
    models: modelConfigs,
    metrics: metricConfigs,
    config: {
      parallel_requests: 5,
      timeout_seconds: 120,
      retry_attempts: 3
    }
  };
}

async function watchJob(jobId: string, outputFormat: string) {
  const spinner = ora('Waiting for evaluation to complete...').start();
  
  const checkInterval = 5000; // 5 seconds
  let lastStatus = '';

  while (true) {
    try {
      const response = await axios.get(`/results/${jobId}/status`);
      const job = response.data.data;

      if (job.status !== lastStatus) {
        lastStatus = job.status;
        
        if (job.status === 'running' && job.progress) {
          spinner.text = `Running... ${job.progress.percentage}% complete`;
        } else if (job.status === 'completed') {
          spinner.succeed('Evaluation completed!');
          
          // Fetch and display results
          const resultsResponse = await axios.get(`/results/${jobId}`);
          const results = formatResults(resultsResponse.data.data, outputFormat);
          console.log('\\n' + results);
          break;
        } else if (job.status === 'failed') {
          spinner.fail('Evaluation failed');
          break;
        }
      }

      await new Promise(resolve => setTimeout(resolve, checkInterval));

    } catch (error: any) {
      spinner.fail('Error checking job status');
      console.error(chalk.red(error.response?.data?.error || error.message));
      break;
    }
  }
}

function formatResults(job: any, format: string, metricFilter?: string) {
  if (format === 'json') {
    return JSON.stringify(job.results, null, 2);
  }

  if (format === 'csv') {
    return convertToCsv(job, metricFilter);
  }

  // Table format
  let output = chalk.bold(`\\n Results for ${job.name}\\n`);
  
  if (!job.results?.model_results) {
    return output + chalk.yellow('No results available.\\n');
  }

  const table = new Table({
    head: ['Model', 'Metric', 'Score', 'Avg Latency', 'Total Cost'],
    chars: { 'top': '═', 'top-mid': '╤', 'top-left': '╔', 'top-right': '╗',
             'bottom': '═', 'bottom-mid': '╧', 'bottom-left': '╚', 'bottom-right': '╝',
             'left': '║', 'left-mid': '╟', 'mid': '─', 'mid-mid': '┼',
             'right': '║', 'right-mid': '╢', 'middle': '│' }
  });

  for (const [modelId, modelResult] of Object.entries(job.results.model_results)) {
    const result = modelResult as any;
    
    for (const [metricName, metricData] of Object.entries(result.metrics)) {
      if (metricFilter && metricName !== metricFilter) continue;
      
      const metric = metricData as any;
      table.push([
        modelId,
        metricName,
        metric.score.toFixed(3),
        `${result.performance.average_latency_ms.toFixed(0)}ms`,
        `$${result.performance.total_cost_usd.toFixed(4)}`
      ]);
    }
  }

  return output + table.toString() + '\\n';
}

function formatComparison(comparison: any) {
  let output = chalk.bold(`\\n Comparison Results\\n`);
  output += `Comparison Type: ${comparison.comparison_type}\\n`;
  output += `Jobs: ${comparison.jobs_compared.map((j: any) => j.name).join(', ')}\\n\\n`;

  // Add comparison tables based on type
  return output + chalk.yellow('Detailed comparison formatting coming soon...\\n');
}

function convertToCsv(job: any, metricFilter?: string): string {
  const headers = ['job_id', 'model_id', 'metric_name', 'score', 'latency_ms', 'cost_usd'];
  const rows = [headers.join(',')];

  for (const [modelId, modelResult] of Object.entries(job.results.model_results)) {
    const result = modelResult as any;
    
    for (const [metricName, metricData] of Object.entries(result.metrics)) {
      if (metricFilter && metricName !== metricFilter) continue;
      
      const metric = metricData as any;
      rows.push([
        job.id,
        modelId,
        metricName,
        metric.score,
        result.performance.average_latency_ms,
        result.performance.total_cost_usd
      ].join(','));
    }
  }

  return rows.join('\\n');
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'completed': return chalk.green(status);
    case 'running': return chalk.blue(status);
    case 'pending': return chalk.yellow(status);
    case 'failed': return chalk.red(status);
    case 'cancelled': return chalk.gray(status);
    default: return status;
  }
}

function getProviderForModel(modelId: string): string {
  if (modelId.includes('gpt')) return 'openai';
  if (modelId.includes('claude')) return 'anthropic';
  if (modelId.includes('mixtral')) return 'together';
  return 'unknown';
}

function getModelName(modelId: string): string {
  const modelNames: Record<string, string> = {
    'gpt-3.5': 'gpt-3.5-turbo',
    'gpt-4': 'gpt-4',
    'claude-3': 'claude-3-sonnet-20240229',
    'mixtral': 'mistralai/Mixtral-8x7B-Instruct-v0.1'
  };
  return modelNames[modelId] || modelId;
}

// Error handling
process.on('uncaughtException', (error) => {
  console.error(chalk.red('\\nUnexpected error:'), error.message);
  process.exit(1);
});

process.on('unhandledRejection', (error: any) => {
  console.error(chalk.red('\\nUnhandled promise rejection:'), error.message);
  process.exit(1);
});

program.parse();
