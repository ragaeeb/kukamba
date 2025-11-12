import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { LlmClient } from './client';
import { ApiKeyManager } from './keyManager';
import { type LlmAdapter, LoadBalancingStrategy, type Logger } from './types';

describe('LlmClient', () => {
    let mockAdapter: LlmAdapter;
    let mockLogger: Logger;
    let keyManager: ApiKeyManager;

    beforeEach(() => {
        mockAdapter = mock(async (prompt: string, apiKey: string) => ({
            success: true,
            text: 'test response',
        }));

        mockLogger = {
            error: mock(() => {}),
            log: mock(() => {}),
            warn: mock(() => {}),
        };

        keyManager = new ApiKeyManager(['key1', 'key2', 'key3']);
    });

    describe('constructor', () => {
        it('should initialize with required parameters', () => {
            const client = new LlmClient(mockAdapter, (response) => response.text, keyManager);

            expect(client).toBeDefined();
        });

        it('should use custom retry config', () => {
            const client = new LlmClient(mockAdapter, (response) => response.text, keyManager, {
                initialDelay: 500,
                maxDelay: 10000,
                maxRetries: 5,
            });

            expect(client).toBeDefined();
        });

        it('should use custom logger', () => {
            const customLogger = {
                error: mock(() => {}),
                log: mock(() => {}),
                warn: mock(() => {}),
            };

            const client = new LlmClient(mockAdapter, (response) => response.text, keyManager, {}, customLogger);

            expect(client).toBeDefined();
        });
    });

    describe('generate', () => {
        it('should successfully generate with valid response', async () => {
            const client = new LlmClient(
                mockAdapter,
                (response: { text: string; success: boolean }) => response.text,
                keyManager,
                { maxRetries: 3 },
                mockLogger,
            );

            const result = await client.generate('test prompt', (text) => text === 'test response');

            expect(result.content).toBe('test response');
            expect(result.isValid).toBe(true);
            expect(result.attempts).toBe(1);
            expect(mockAdapter).toHaveBeenCalledTimes(1);
        });

        it('should retry on validation failure', async () => {
            let callCount = 0;
            const adapter = mock(async () => {
                callCount++;
                return { text: callCount === 3 ? 'valid' : 'invalid' };
            });

            const client = new LlmClient(
                adapter,
                (response: { text: string }) => response.text,
                keyManager,
                { maxRetries: 3 },
                mockLogger,
            );

            const result = await client.generate('test prompt', (text) => text === 'valid');

            expect(result.content).toBe('valid');
            expect(result.attempts).toBe(3);
            expect(adapter).toHaveBeenCalledTimes(3);
        });

        it('should retry on empty response', async () => {
            let callCount = 0;
            const adapter = mock(async () => {
                callCount++;
                return { text: callCount === 2 ? 'valid' : null };
            });

            const client = new LlmClient(
                adapter,
                (response: { text: string | null }) => response.text,
                keyManager,
                { maxRetries: 3 },
                mockLogger,
            );

            const result = await client.generate('test prompt', (text) => text === 'valid');

            expect(result.attempts).toBe(2);
        });

        it('should throw error after max retries', async () => {
            const adapter = mock(async () => ({ text: 'invalid' }));

            const client = new LlmClient(
                adapter,
                (response: { text: string }) => response.text,
                keyManager,
                { maxRetries: 3 },
                mockLogger,
            );

            await expect(client.generate('test prompt', () => false)).rejects.toThrow();

            expect(adapter).toHaveBeenCalledTimes(3);
        });

        it('should rotate keys on failure', async () => {
            const usedKeys: string[] = [];
            const adapter = mock(async (_prompt: string, apiKey: string) => {
                usedKeys.push(apiKey);
                throw new Error('Rate limit');
            });

            const client = new LlmClient(
                adapter,
                (response: { text: string }) => response.text,
                keyManager,
                { initialDelay: 10, maxRetries: 3 },
                mockLogger,
            );

            try {
                await client.generate('test prompt', () => true);
            } catch {}

            // Should have tried different keys
            expect(usedKeys.length).toBe(3);
            expect(new Set(usedKeys).size).toBeGreaterThan(1);
        });

        it('should handle rate limit errors with backoff', async () => {
            let callCount = 0;
            const adapter = mock(async () => {
                callCount++;
                // Succeed on the last attempt to ensure we measure the backoff
                if (callCount === 2) {
                    return { text: 'success' };
                }
                const error: any = new Error('429 Too Many Requests');
                error.status = 429;
                throw error;
            });

            const client = new LlmClient(
                adapter,
                (response: { text: string }) => response.text,
                keyManager,
                { initialDelay: 50, maxDelay: 200, maxRetries: 2 },
                mockLogger,
            );

            const start = Date.now();
            await client.generate('test prompt', () => true);
            const elapsed = Date.now() - start;

            // Should have waited for backoff (at least the initial delay)
            expect(elapsed).toBeGreaterThan(40); // Allow some margin
            expect(callCount).toBe(2);
        });

        it('should not retry on authentication errors', async () => {
            const adapter = mock(async () => {
                const error: any = new Error('401 Unauthorized');
                error.status = 401;
                throw error;
            });

            const client = new LlmClient(
                adapter,
                (response: { text: string }) => response.text,
                keyManager,
                { maxRetries: 3 },
                mockLogger,
            );

            await expect(client.generate('test prompt', () => true)).rejects.toThrow('401');

            // Should only try once for auth errors
            expect(adapter).toHaveBeenCalledTimes(1);
        });

        it('should not retry on bad request errors', async () => {
            const adapter = mock(async () => {
                const error: any = new Error('400 Bad Request');
                error.status = 400;
                throw error;
            });

            const client = new LlmClient(
                adapter,
                (response: { text: string }) => response.text,
                keyManager,
                { maxRetries: 3 },
                mockLogger,
            );

            await expect(client.generate('test prompt', () => true)).rejects.toThrow('400');

            expect(adapter).toHaveBeenCalledTimes(1);
        });

        it('should update key health on success', async () => {
            const client = new LlmClient(
                mockAdapter,
                (response: { text: string; success: boolean }) => response.text,
                keyManager,
                {},
                mockLogger,
            );

            await client.generate('test prompt', () => true);

            const health = client.getKeyHealthStatus();
            const usedKey = health.find((h) => h.successCount > 0);

            expect(usedKey).toBeDefined();
            expect(usedKey!.successCount).toBe(1);
            expect(usedKey!.healthScore).toBe(1.0);
        });

        it('should update key health on failure', async () => {
            const adapter = mock(async () => {
                throw new Error('Server error');
            });

            const client = new LlmClient(
                adapter,
                (response: { text: string }) => response.text,
                keyManager,
                { initialDelay: 10, maxRetries: 1 },
                mockLogger,
            );

            try {
                await client.generate('test prompt', () => true);
            } catch {}

            const health = client.getKeyHealthStatus();
            const failedKey = health.find((h) => h.failureCount > 0);

            expect(failedKey).toBeDefined();
            expect(failedKey!.failureCount).toBeGreaterThan(0);
            expect(failedKey!.healthScore).toBeLessThan(1.0);
        });

        it('should throw when no healthy keys available', async () => {
            const smallKeyManager = new ApiKeyManager(['key1'], LoadBalancingStrategy.RoundRobin, {
                maxConsecutiveFailures: 1,
            });

            const adapter = mock(async () => {
                throw new Error('Error');
            });

            const client = new LlmClient(
                adapter,
                (response: { text: string }) => response.text,
                smallKeyManager,
                { initialDelay: 10, maxRetries: 3 },
                mockLogger,
            );

            await expect(client.generate('test prompt', () => true)).rejects.toThrow('No healthy API keys available');
        });
    });

    describe('generateBatch', () => {
        it('should process multiple prompts in parallel with single validator', async () => {
            const prompts = ['prompt1', 'prompt2', 'prompt3'];
            let concurrent = 0;
            let maxConcurrent = 0;

            const adapter = mock(async (prompt: string) => {
                concurrent++;
                maxConcurrent = Math.max(maxConcurrent, concurrent);
                await new Promise((resolve) => setTimeout(resolve, 50));
                concurrent--;
                return { text: `response for ${prompt}` };
            });

            const client = new LlmClient(
                adapter,
                (response: { text: string }) => response.text,
                keyManager,
                {},
                mockLogger,
            );

            const results = await client.generateBatch(prompts, () => true, {}, 3);

            expect(results.length).toBe(3);
            expect(maxConcurrent).toBeGreaterThan(1);
            expect(results[0].content).toBe('response for prompt1');
            expect(results[1].content).toBe('response for prompt2');
            expect(results[2].content).toBe('response for prompt3');
        });

        it('should process multiple prompts with per-prompt validators', async () => {
            const prompts = ['2 paragraphs', '1 paragraph', '3 paragraphs'];

            const adapter = mock(async (prompt: string) => {
                // Simulate responses with different paragraph counts
                if (prompt.includes('2 paragraphs')) {
                    return { text: 'Paragraph 1\n\nParagraph 2' };
                } else if (prompt.includes('1 paragraph')) {
                    return { text: 'Single paragraph' };
                } else {
                    return { text: 'P1\n\nP2\n\nP3' };
                }
            });

            const client = new LlmClient(
                adapter,
                (response: { text: string }) => response.text,
                keyManager,
                {},
                mockLogger,
            );

            // Create validators that check for specific paragraph counts
            const validators = [
                (text: string) => text.split('\n\n').length === 2, // Expects 2 paragraphs
                (text: string) => text.split('\n\n').length === 1, // Expects 1 paragraph
                (text: string) => text.split('\n\n').length === 3, // Expects 3 paragraphs
            ];

            const results = await client.generateBatch(prompts, validators, {}, 3);

            expect(results.length).toBe(3);
            expect(results[0].content).toBe('Paragraph 1\n\nParagraph 2');
            expect(results[1].content).toBe('Single paragraph');
            expect(results[2].content).toBe('P1\n\nP2\n\nP3');
            expect(results.every((r) => r.isValid)).toBe(true);
        });

        it('should throw error when validator array length does not match prompts', async () => {
            const client = new LlmClient(
                mockAdapter,
                (response: { text: string; success: boolean }) => response.text,
                keyManager,
                {},
                mockLogger,
            );

            const prompts = ['p1', 'p2', 'p3'];
            const validators = [(text: string) => true, (text: string) => true]; // Only 2 validators

            await expect(client.generateBatch(prompts, validators)).rejects.toThrow(
                'Validator array length (2) must match prompts array length (3)',
            );
        });

        it('should retry failed validations with per-prompt validators', async () => {
            const attemptCount = [0, 0];

            const adapter = mock(async (prompt: string) => {
                const index = prompt === 'p1' ? 0 : 1;
                attemptCount[index]++;

                // First request needs 2 attempts to pass
                if (prompt === 'p1' && attemptCount[index] === 1) {
                    return { text: 'Wrong response' };
                }

                // Return correct responses
                return {
                    text: prompt === 'p1' ? 'Para 1\n\nPara 2' : 'Single para',
                };
            });

            const client = new LlmClient(
                adapter,
                (response: { text: string }) => response.text,
                keyManager,
                { maxRetries: 3 },
                mockLogger,
            );

            const validators = [
                (text: string) => text.split('\n\n').length === 2,
                (text: string) => text.split('\n\n').length === 1,
            ];

            const results = await client.generateBatch(['p1', 'p2'], validators, {}, 2);

            expect(results[0].attempts).toBe(2); // First needed retry
            expect(results[1].attempts).toBe(1); // Second succeeded first time
            expect(results.every((r) => r.isValid)).toBe(true);
        });

        it('should respect concurrency limit', async () => {
            const prompts = ['p1', 'p2', 'p3', 'p4', 'p5'];
            let concurrent = 0;
            let maxConcurrent = 0;

            const adapter = mock(async (prompt: string) => {
                concurrent++;
                maxConcurrent = Math.max(maxConcurrent, concurrent);
                await new Promise((resolve) => setTimeout(resolve, 20));
                concurrent--;
                return { text: `response ${prompt}` };
            });

            const client = new LlmClient(
                adapter,
                (response: { text: string }) => response.text,
                keyManager,
                {},
                mockLogger,
            );

            await client.generateBatch(prompts, () => true, {}, 2);

            expect(maxConcurrent).toBeLessThanOrEqual(2);
        });

        it('should use default concurrency based on available keys', async () => {
            const prompts = ['p1', 'p2'];

            const client = new LlmClient(
                mockAdapter,
                (response: { text: string; success: boolean }) => response.text,
                keyManager,
                {},
                mockLogger,
            );

            const results = await client.generateBatch(prompts, () => true);

            expect(results.length).toBe(2);
        });

        it('should handle individual prompt failures', async () => {
            const prompts = ['p1', 'p2', 'p3'];
            const adapter = mock(async (prompt: string) => {
                if (prompt === 'p2') {
                    throw new Error('Failed');
                }
                return { text: `response ${prompt}` };
            });

            const client = new LlmClient(
                adapter,
                (response: { text: string }) => response.text,
                keyManager,
                { maxRetries: 1 },
                mockLogger,
            );

            // generateBatch will reject if any individual prompt fails
            await expect(client.generateBatch(prompts, () => true, {}, 3)).rejects.toThrow('Failed');
        });
    });

    describe('getKeyHealthStatus', () => {
        it('should return health status for all keys', () => {
            const client = new LlmClient(mockAdapter, (response) => response.text, keyManager, {}, mockLogger);

            const status = client.getKeyHealthStatus();

            expect(status.length).toBe(3);
            status.forEach((health) => {
                expect(health).toHaveProperty('key');
                expect(health).toHaveProperty('successCount');
                expect(health).toHaveProperty('failureCount');
                expect(health).toHaveProperty('healthScore');
            });
        });
    });

    describe('resetHealth', () => {
        it('should reset health metrics', async () => {
            const client = new LlmClient(mockAdapter, (response) => response.text, keyManager, {}, mockLogger);

            await client.generate('test', () => true);

            let status = client.getKeyHealthStatus();
            expect(status.some((h) => h.successCount > 0)).toBe(true);

            client.resetHealth();

            status = client.getKeyHealthStatus();
            status.forEach((health) => {
                expect(health.successCount).toBe(0);
                expect(health.failureCount).toBe(0);
                expect(health.healthScore).toBe(1.0);
            });
        });
    });

    describe('error classification', () => {
        it('should classify rate limit errors', async () => {
            const adapter = mock(async () => {
                throw new Error('429 Rate limit exceeded');
            });

            const client = new LlmClient(
                adapter,
                (response: { text: string }) => response.text,
                keyManager,
                { initialDelay: 10, maxRetries: 1 },
                mockLogger,
            );

            try {
                await client.generate('test', () => true);
            } catch {}

            const health = client.getKeyHealthStatus();
            // Rate limit failures should be recorded
            expect(health.some((h) => h.failureCount > 0)).toBe(true);
        });

        it('should classify timeout errors', async () => {
            const adapter = mock(async () => {
                throw new Error('Request timeout');
            });

            const client = new LlmClient(
                adapter,
                (response: { text: string }) => response.text,
                keyManager,
                { initialDelay: 10, maxRetries: 2 },
                mockLogger,
            );

            try {
                await client.generate('test', () => true);
            } catch {}

            // Should retry timeout errors
            expect(adapter).toHaveBeenCalledTimes(2);
        });
    });
});
