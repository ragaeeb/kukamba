# Kukamba 🚀

[![wakatime](https://wakatime.com/badge/user/a0b906ce-b8e7-4463-8bce-383238df6d4b/project/25e1dd0b-7b32-437d-a083-f43285050fe3.svg)](https://wakatime.com/badge/user/a0b906ce-b8e7-4463-8bce-383238df6d4b/project/25e1dd0b-7b32-437d-a083-f43285050fe3)
[![Node.js CI](https://github.com/ragaeeb/kukamba/actions/workflows/build.yml/badge.svg)](https://github.com/ragaeeb/kukamba/actions/workflows/build.yml)
![GitHub License](https://img.shields.io/github/license/ragaeeb/kukamba)
![GitHub Release](https://img.shields.io/github/v/release/ragaeeb/kukamba)
[![codecov](https://codecov.io/gh/ragaeeb/kukamba/graph/badge.svg?token=FXYXXMGM6P)](https://codecov.io/gh/ragaeeb/kukamba)
[![Size](https://deno.bundlejs.com/badge?q=kukamba@latest)](https://bundlejs.com/?q=kukamba%40latest)
![typescript](https://badgen.net/badge/icon/typescript?icon=typescript&label&color=blue)
![npm](https://img.shields.io/npm/v/kukamba)
![npm](https://img.shields.io/npm/dm/kukamba)
![GitHub issues](https://img.shields.io/github/issues/ragaeeb/kukamba)
![GitHub stars](https://img.shields.io/github/stars/ragaeeb/kukamba?style=social)

**Intelligent API key rotation and parallel request management for LLM providers**

Kukamba is a lightweight, TypeScript library that helps you avoid rate limits when working with LLM APIs. It provides smart key rotation, health tracking, circuit breaking, and parallel request management - all without bundling any provider-specific SDKs.

## Features

✨ **Smart Key Rotation** - Automatically rotates through API keys using configurable strategies  
🏥 **Health Tracking** - Monitors success/failure rates and adapts key selection  
⚡ **Circuit Breaking** - Temporarily disables unhealthy keys to prevent cascading failures  
🔄 **Parallel Requests** - Execute multiple requests simultaneously across different keys  
📊 **Load Balancing** - Choose from round-robin, weighted health, or least connections strategies  
🪶 **Lightweight** - No bundled dependencies, bring your own LLM SDK  
🔌 **Provider Agnostic** - Works with any LLM API (OpenAI, Anthropic, Google, etc.)  
📝 **Full TypeScript** - Complete type safety and IntelliSense support

## Installation

```bash
bun add kukamba
```

## Quick Start

```typescript
import { LlmClient, ApiKeyManager, LoadBalancingStrategy } from 'kukamba';
import { GoogleGenAI } from '@google/genai';

// Set up your API keys
const keyManager = new ApiKeyManager(
  ['key1', 'key2', 'key3'],
  LoadBalancingStrategy.WeightedHealth
);

// Create an adapter for your LLM provider
const geminiAdapter = async (prompt: string, apiKey: string) => {
  const ai = new GoogleGenAI({ apiKey });
  return await ai.models.generateContent({
    model: 'gemini-2.5-flash-lite',
    contents: prompt,
  });
};

// Create the client
const client = new LlmClient(
  geminiAdapter,
  (response) => response.text, // Extract text from response
  keyManager,
  { maxRetries: 3, initialDelay: 1000 }
);

// Generate with automatic retries and key rotation
const result = await client.generate(
  'Explain quantum computing',
  (text) => text.length > 100 // Validate response
);

console.log(result.content);
console.log(`Succeeded on attempt ${result.attempts}`);
```

## API Reference

### ApiKeyManager

Manages a pool of API keys with intelligent load balancing and health tracking.

```typescript
const keyManager = new ApiKeyManager(
  keys: string[] | string,
  strategy?: LoadBalancingStrategy,
  config?: ApiKeyManagerConfig
);
```

**Parameters:**
- `keys` - Array of API keys or comma-separated string
- `strategy` - Load balancing strategy (default: `RoundRobin`)
- `config` - Configuration options:
  - `maxConsecutiveFailures` - Failures before circuit breaker opens (default: 3)
  - `circuitBreakerResetTime` - Reset time in milliseconds (default: 60000)
  - `minHealthScore` - Minimum health score to use key (default: 0.3)
  - `maxParallelRequestsPerKey` - Max concurrent requests per key (default: 10)

**Load Balancing Strategies:**
- `LoadBalancingStrategy.RoundRobin` - Simple rotation through keys
- `LoadBalancingStrategy.WeightedHealth` - Prefer healthier keys
- `LoadBalancingStrategy.LeastConnections` - Use key with fewest active requests

**Methods:**
- `getNext()` - Get next available API key
- `markRequestStart(key)` - Track start of request
- `recordSuccess(key)` - Record successful request
- `recordFailure(key, isRateLimit?)` - Record failed request
- `getHealthStatus()` - Get health metrics for all keys
- `getCount()` - Get total number of keys
- `getAvailableCount()` - Get number of healthy keys
- `resetHealth()` - Reset all health metrics

### LlmClient

Generic client for making LLM requests with retries, validation, and key rotation.

```typescript
const client = new LlmClient(
  adapter: LlmAdapter,
  textExtractor: TextExtractor,
  keyManager: ApiKeyManager,
  retryConfig?: RetryConfig,
  logger?: Logger
);
```

**Parameters:**
- `adapter` - Function that calls your LLM provider's API
- `textExtractor` - Function to extract text from LLM response
- `keyManager` - ApiKeyManager instance
- `retryConfig` - Retry configuration:
  - `maxRetries` - Maximum retry attempts (default: 3)
  - `initialDelay` - Initial delay in ms (default: 1000)
  - `maxDelay` - Maximum delay in ms (default: 30000)
  - `backoffMultiplier` - Exponential backoff multiplier (default: 2)
  - `timeout` - Request timeout in ms (default: 600000)
- `logger` - Custom logger (default: console)

**Methods:**
- `generate(prompt, validate, config?)` - Generate single response
- `generateBatch(prompts, validate, config?, concurrency?)` - Generate multiple responses in parallel
  - `validate` can be a single function (applied to all prompts) or an array of functions (one per prompt)
- `getKeyHealthStatus()` - Get health status for all keys
- `resetHealth()` - Reset health metrics

## Examples

### Example 1: OpenAI with JSON Validation

```typescript
import OpenAI from 'openai';
import { LlmClient, ApiKeyManager } from 'kukamba';

const keyManager = new ApiKeyManager(process.env.OPENAI_KEYS!.split(','));

const openaiAdapter = async (prompt: string, apiKey: string) => {
  const openai = new OpenAI({ apiKey });
  return await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: prompt }],
  });
};

const client = new LlmClient(
  openaiAdapter,
  (response) => response.choices[0]?.message?.content || null,
  keyManager
);

// Validate that response is valid JSON
const result = await client.generate(
  'Generate a JSON object with name and age fields',
  (text) => {
    try {
      const json = JSON.parse(text);
      return json.name && json.age;
    } catch {
      return false;
    }
  }
);

console.log(JSON.parse(result.content));
```

### Example 2: Anthropic Claude with Structured Output

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { LlmClient, ApiKeyManager, LoadBalancingStrategy } from 'kukamba';

const keyManager = new ApiKeyManager(
  process.env.ANTHROPIC_KEYS!.split(','),
  LoadBalancingStrategy.WeightedHealth
);

const claudeAdapter = async (prompt: string, apiKey: string) => {
  const anthropic = new Anthropic({ apiKey });
  return await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });
};

const client = new LlmClient(
  claudeAdapter,
  (response) => response.content[0]?.text || null,
  keyManager
);

// Validate structured response format
const result = await client.generate(
  'List 5 programming languages in the format: "1. Language - Description"',
  (text) => {
    const lines = text.split('\n').filter(l => l.trim());
    return lines.length === 5 && lines.every(l => /^\d+\./.test(l));
  }
);

console.log(result.content);
```

### Example 3: Batch Processing with Parallel Requests

```typescript
import { LlmClient, ApiKeyManager } from 'kukamba';

// Process 100 prompts in parallel using 5 API keys
const keyManager = new ApiKeyManager([
  'key1', 'key2', 'key3', 'key4', 'key5'
]);

const client = new LlmClient(
  yourAdapter,
  yourTextExtractor,
  keyManager
);

const prompts = Array.from({ length: 100 }, (_, i) => 
  `Summarize article ${i + 1}`
);

// Option 1: Single validator for all prompts
const results = await client.generateBatch(
  prompts,
  (text) => text.length > 50, // Same validation for all
  {},
  5 // Max 5 concurrent requests
);

console.log(`Processed ${results.length} articles`);
```

### Example 3b: Batch Processing with Per-Prompt Validation

```typescript
import { LlmClient, ApiKeyManager } from 'kukamba';

// Different prompts need different validation!
const prompts = [
  'Translate these 2 paragraphs into Arabic:\nP1 - Text\nP2 - Text2',
  'Translate this 1 paragraph into Arabic:\nP1 - Text3',
  'Translate these 3 paragraphs into Arabic:\nP1 - A\nP2 - B\nP3 - C',
];

// Create a validator for each prompt
const validators = [
  (text) => text.split('\n').filter(p => p.trim()).length === 2, // Expects 2 paragraphs
  (text) => text.split('\n').filter(p => p.trim()).length === 1, // Expects 1 paragraph  
  (text) => text.split('\n').filter(p => p.trim()).length === 3, // Expects 3 paragraphs
];

// Pass array of validators - one per prompt
const results = await client.generateBatch(
  prompts,
  validators, // Array of validators!
  {},
  3
);

// Each prompt was validated with its own validator
results.forEach((result, i) => {
  console.log(`Prompt ${i + 1}: ${result.isValid ? '✓' : '✗'} (${result.attempts} attempts)`);
});
```

### Example 4: Custom Validation Logic

```typescript
import { LlmClient, ApiKeyManager } from 'kukamba';

const client = new LlmClient(
  yourAdapter,
  yourTextExtractor,
  keyManager
);

// Validate response contains specific keywords
const validateKeywords = (text: string) => {
  const required = ['quantum', 'superposition', 'entanglement'];
  return required.every(keyword => 
    text.toLowerCase().includes(keyword)
  );
};

const result = await client.generate(
  'Explain quantum computing concepts',
  validateKeywords
);

// Validate response length and format
const validateBlogPost = (text: string) => {
  const wordCount = text.split(/\s+/).length;
  const hasHeadings = /#{1,6}\s/.test(text);
  return wordCount >= 500 && wordCount <= 1000 && hasHeadings;
};

const blogPost = await client.generate(
  'Write a blog post about TypeScript',
  validateBlogPost
);

// Validate code output
const validateCode = (text: string) => {
  const hasFunction = /function\s+\w+\s*\(/.test(text);
  const hasReturn = /return\s+/.test(text);
  const isComplete = text.includes('}');
  return hasFunction && hasReturn && isComplete;
};

const code = await client.generate(
  'Write a TypeScript function to sort an array',
  validateCode
);
```

### Example 5: Custom Logger Integration

```typescript
import { LlmClient, ApiKeyManager, type Logger } from 'kukamba';
import winston from 'winston';

// Use Winston logger
const winstonLogger: Logger = {
  log: (msg, ...args) => winston.info(msg, ...args),
  warn: (msg, ...args) => winston.warn(msg, ...args),
  error: (msg, ...args) => winston.error(msg, ...args),
};

const client = new LlmClient(
  yourAdapter,
  yourTextExtractor,
  keyManager,
  { maxRetries: 5 },
  winstonLogger
);

// Or use a silent logger for production
const silentLogger: Logger = {
  log: () => {},
  warn: () => {},
  error: () => {},
};
```

### Example 6: Google Gemini with Retry Logic

```typescript
import { GoogleGenAI } from '@google/genai';
import { LlmClient, ApiKeyManager } from 'kukamba';

const keyManager = new ApiKeyManager(
  process.env.GEMINI_KEYS!.split(','),
  LoadBalancingStrategy.LeastConnections,
  {
    maxConsecutiveFailures: 5,
    circuitBreakerResetTime: 120000, // 2 minutes
    maxParallelRequestsPerKey: 20,
  }
);

const geminiAdapter = async (prompt: string, apiKey: string, config: any) => {
  const ai = new GoogleGenAI({ 
    apiKey, 
    httpOptions: { timeout: config.timeout } 
  });
  
  return await ai.models.generateContent({
    model: config.model || 'gemini-2.5-flash-lite',
    contents: prompt,
    config: { temperature: config.temperature || 0.1 },
  });
};

const client = new LlmClient(
  geminiAdapter,
  (response) => response.text || null,
  keyManager,
  {
    maxRetries: 5,
    initialDelay: 2000,
    maxDelay: 60000,
    timeout: 600000,
  }
);

// Generate with custom config
const result = await client.generate(
  'Explain machine learning',
  (text) => text.length > 200,
  { 
    model: 'gemini-2.5-pro',
    temperature: 0.7,
    timeout: 120000 
  }
);
```

### Example 7: Health Monitoring and Circuit Breaking

```typescript
import { LlmClient, ApiKeyManager } from 'kukamba';

const keyManager = new ApiKeyManager(
  ['key1', 'key2', 'key3'],
  LoadBalancingStrategy.WeightedHealth,
  {
    maxConsecutiveFailures: 3,
    minHealthScore: 0.4,
    circuitBreakerResetTime: 90000,
  }
);

const client = new LlmClient(
  yourAdapter,
  yourTextExtractor,
  keyManager
);

// Monitor health during processing
setInterval(() => {
  const health = client.getKeyHealthStatus();
  
  health.forEach(key => {
    console.log(`Key: ${key.key}`);
    console.log(`  Health Score: ${key.healthScore.toFixed(2)}`);
    console.log(`  Success: ${key.successCount}, Failures: ${key.failureCount}`);
    console.log(`  Circuit Open: ${key.isCircuitOpen}`);
    console.log(`  Active Requests: ${key.activeRequests}`);
  });
}, 10000);

// Process many requests
const results = await client.generateBatch(
  prompts,
  validateFunction
);

// Reset health if needed
client.resetHealth();
```

## Error Handling

Kukamba automatically classifies and handles different error types:

- **Rate Limit (429)** - Applies exponential backoff with longer delays
- **Timeout** - Retries with backoff
- **Server Errors (5xx)** - Retries with backoff
- **Authentication (401)** - No retry, throws immediately
- **Bad Request (4xx)** - No retry, throws immediately

Circuit breakers automatically disable keys after consecutive failures and re-enable them after a timeout.

## Best Practices

1. **Use validation functions** - Always validate LLM responses to ensure quality
2. **Set appropriate retry limits** - Balance between success rate and latency
3. **Monitor health status** - Track key performance to identify issues
4. **Use batch processing** - Maximize throughput for multiple requests
5. **Choose the right strategy** - WeightedHealth for reliability, LeastConnections for speed
6. **Configure circuit breakers** - Prevent wasting requests on unhealthy keys
7. **Provide custom loggers** - Integrate with your existing logging infrastructure

## Contributing

Contributions are welcome! Please read our [AGENTS.md](./AGENTS.md) for development guidelines.

## License

MIT

## Support

For issues and questions, please open an issue on GitHub.
