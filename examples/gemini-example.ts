/**
 * Example: Using Kukamba with Google Gemini API
 *
 * This example demonstrates:
 * - Setting up API key rotation for Gemini
 * - Creating a custom adapter for Gemini
 * - Using validation to ensure response quality
 * - Parallel batch processing
 * - Health monitoring
 */

import { GoogleGenAI } from '@google/genai';
import { ApiKeyManager, LlmClient, LoadBalancingStrategy } from 'kukamba';

// Set up key manager with multiple Gemini API keys
const keyManager = new ApiKeyManager(
    process.env.GEMINI_KEYS?.split(',') || ['your-api-key'],
    LoadBalancingStrategy.WeightedHealth,
    {
        circuitBreakerResetTime: 60000, // 1 minute
        maxConsecutiveFailures: 3,
        maxParallelRequestsPerKey: 10,
    },
);

// Create adapter for Gemini API
const geminiAdapter = async (
    prompt: string,
    apiKey: string,
    config?: { model?: string; temperature?: number; timeout?: number },
) => {
    const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { timeout: config?.timeout || 600000 },
    });

    return await ai.models.generateContent({
        config: { temperature: config?.temperature || 0.1 },
        contents: prompt,
        model: config?.model || 'gemini-2.5-flash-lite',
    });
};

// Create LLM client
const client = new LlmClient(geminiAdapter, (response) => response.text || null, keyManager, {
    initialDelay: 1000,
    maxDelay: 30000,
    maxRetries: 5,
});

// Example 1: Simple generation with validation
async function simpleExample() {
    console.log('\n=== Simple Generation Example ===\n');

    const result = await client.generate('Explain quantum computing in simple terms', (text) => {
        // Validate that response is substantial and mentions key concepts
        const hasLength = text.length > 100;
        const hasKeywords = ['quantum', 'qubit', 'superposition'].some((k) => text.toLowerCase().includes(k));
        return hasLength && hasKeywords;
    });

    console.log('Response:', `${result.content.substring(0, 200)}...`);
    console.log('Attempts:', result.attempts);
    console.log('API Key:', result.apiKey);
}

// Example 2: Structured output with JSON validation
async function jsonValidationExample() {
    console.log('\n=== JSON Validation Example ===\n');

    const prompt = `Generate a JSON object with the following structure:
{
  "name": "a programming language name",
  "year": year it was created,
  "paradigm": "programming paradigm",
  "features": ["feature1", "feature2", "feature3"]
}

Return ONLY the JSON, no other text.`;

    const result = await client.generate(prompt, (text) => {
        try {
            const json = JSON.parse(text);
            return (
                typeof json.name === 'string' &&
                typeof json.year === 'number' &&
                typeof json.paradigm === 'string' &&
                Array.isArray(json.features) &&
                json.features.length >= 3
            );
        } catch {
            return false;
        }
    });

    const data = JSON.parse(result.content);
    console.log('Parsed JSON:', data);
    console.log('Validation passed on attempt:', result.attempts);
}

// Example 3: Batch processing with parallel requests
async function batchProcessingExample() {
    console.log('\n=== Batch Processing Example ===\n');

    const topics = [
        'machine learning',
        'blockchain',
        'quantum computing',
        'artificial intelligence',
        'cloud computing',
    ];

    const prompts = topics.map((topic) => `Write a one-sentence summary of ${topic}.`);

    const startTime = Date.now();

    const results = await client.generateBatch(
        prompts,
        (text) => {
            // Validate sentence format
            const isSingleSentence =
                text
                    .trim()
                    .split(/[.!?]/)
                    .filter((s) => s.trim()).length === 1;
            const hasMinLength = text.length > 20;
            return isSingleSentence && hasMinLength;
        },
        {},
        3, // Max 3 concurrent requests
    );

    const elapsed = Date.now() - startTime;

    console.log(`Processed ${results.length} prompts in ${elapsed}ms`);
    console.log('\nResults:');
    results.forEach((result, i) => {
        console.log(`${i + 1}. ${topics[i]}: ${result.content}`);
    });

    const avgAttempts = results.reduce((sum, r) => sum + r.attempts, 0) / results.length;
    console.log(`\nAverage attempts per prompt: ${avgAttempts.toFixed(2)}`);
}

// Example 4: Code generation with validation
async function codeGenerationExample() {
    console.log('\n=== Code Generation Example ===\n');

    const prompt = `Write a TypeScript function that:
1. Takes an array of numbers
2. Returns the sum of all even numbers
3. Has proper type annotations
4. Includes a JSDoc comment

Return only the function code, no explanations.`;

    const result = await client.generate(prompt, (text) => {
        // Validate code structure
        const hasFunction = /function\s+\w+\s*\(/.test(text) || /const\s+\w+\s*=/.test(text);
        const hasReturn = /return\s+/.test(text);
        const hasTypeScript = text.includes(':') && (text.includes('number') || text.includes('[]'));
        const hasJSDoc = text.includes('/**') || text.includes('*');

        return hasFunction && hasReturn && hasTypeScript && hasJSDoc;
    });

    console.log('Generated code:\n');
    console.log(result.content);
    console.log(`\nValidation passed on attempt: ${result.attempts}`);
}

// Example 5: Health monitoring during processing
async function healthMonitoringExample() {
    console.log('\n=== Health Monitoring Example ===\n');

    // Process several requests
    const prompts = Array.from({ length: 10 }, (_, i) => `Generate a haiku about topic ${i + 1}`);

    console.log('Processing 10 requests with health monitoring...\n');

    const intervalId = setInterval(() => {
        const health = client.getKeyHealthStatus();
        console.log('\n--- Key Health Status ---');
        health.forEach((key) => {
            console.log(`Key: ${key.key}`);
            console.log(`  Health Score: ${key.healthScore.toFixed(2)}`);
            console.log(`  Success: ${key.successCount}, Failures: ${key.failureCount}`);
            console.log(`  Active Requests: ${key.activeRequests}/${key.maxParallelRequests}`);
            console.log(`  Circuit Open: ${key.isCircuitOpen}`);
        });
    }, 3000);

    await client.generateBatch(
        prompts,
        (text) => {
            // Validate haiku format (3 lines)
            const lines = text
                .trim()
                .split('\n')
                .filter((l) => l.trim());
            return lines.length === 3;
        },
        {},
        5,
    );

    clearInterval(intervalId);

    // Final health report
    console.log('\n--- Final Health Report ---');
    const finalHealth = client.getKeyHealthStatus();
    finalHealth.forEach((key) => {
        console.log(`\nKey: ${key.key}`);
        console.log(`  Total Requests: ${key.successCount + key.failureCount}`);
        console.log(
            `  Success Rate: ${((key.successCount / (key.successCount + key.failureCount)) * 100).toFixed(1)}%`,
        );
        console.log(`  Final Health Score: ${key.healthScore.toFixed(2)}`);
    });
}

// Example 6: Custom retry config for different scenarios
async function customRetryExample() {
    console.log('\n=== Custom Retry Configuration Example ===\n');

    // For quick responses, use aggressive retries
    const quickClient = new LlmClient(geminiAdapter, (response) => response.text || null, keyManager, {
        backoffMultiplier: 1.5,
        initialDelay: 500,
        maxDelay: 5000,
        maxRetries: 10,
    });

    const result = await quickClient.generate('Generate a random number between 1 and 100', (text) => /\d+/.test(text));

    console.log('Quick response:', result.content);
    console.log('Attempts:', result.attempts);
}

// Run all examples
async function main() {
    try {
        await simpleExample();
        await jsonValidationExample();
        await batchProcessingExample();
        await codeGenerationExample();
        await healthMonitoringExample();
        await customRetryExample();

        console.log('\n✅ All examples completed successfully!\n');
    } catch (error) {
        console.error('❌ Error running examples:', error);
        process.exit(1);
    }
}

// Run if executed directly
if (import.meta.main) {
    main();
}
