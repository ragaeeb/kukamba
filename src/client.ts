import { setTimeout } from 'node:timers/promises';
import { AUTH_KEYWORDS, RATE_LIMIT_KEYWORDS, TIMEOUT_KEYWORDS } from './constants';
import type { ApiKeyManager } from './keyManager';
import {
    ErrorType,
    type GenerationResult,
    type LlmAdapter,
    type Logger,
    type RetryConfig,
    type TextExtractor,
    type Validator,
} from './types';

/**
 * Default console logger implementation
 */
export const consoleLogger: Logger = {
    error: console.error,
    log: console.log,
    warn: console.warn,
};

/**
 * Generic LLM client with advanced retry logic, key rotation, and health tracking
 */
export class LlmClient<TInput = any, TOutput = any, TValidated = string> {
    private keyManager: ApiKeyManager;
    private adapter: LlmAdapter<TInput, TOutput>;
    private textExtractor: TextExtractor<TOutput>;
    private retryConfig: Required<RetryConfig>;
    private logger: Logger;

    /**
     * Creates a new LlmClient instance
     * @param adapter - Function that calls the LLM provider's API
     * @param textExtractor - Function to extract text from the LLM response
     * @param keyManager - Manager for API key rotation and health tracking
     * @param retryConfig - Configuration for retry behavior
     * @param logger - Custom logger implementation
     */
    constructor(
        adapter: LlmAdapter<TInput, TOutput>,
        textExtractor: TextExtractor<TOutput>,
        keyManager: ApiKeyManager,
        retryConfig: RetryConfig = {},
        logger: Logger = consoleLogger,
    ) {
        this.adapter = adapter;
        this.textExtractor = textExtractor;
        this.keyManager = keyManager;
        this.logger = logger;
        this.retryConfig = {
            backoffMultiplier: retryConfig.backoffMultiplier ?? 2,
            initialDelay: retryConfig.initialDelay ?? 1000,
            maxDelay: retryConfig.maxDelay ?? 30000,
            maxRetries: retryConfig.maxRetries ?? 3,
            timeout: retryConfig.timeout ?? 600000, // 10 minutes
        };
    }

    /**
     * Classifies an error to determine retry strategy
     */
    private classifyError(error: any): ErrorType {
        const message = error?.message?.toLowerCase() || '';

        if (RATE_LIMIT_KEYWORDS.some((k) => message.includes(k.toLowerCase()))) {
            return ErrorType.RateLimit;
        }
        if (TIMEOUT_KEYWORDS.some((k) => message.includes(k.toLowerCase()))) {
            return ErrorType.Timeout;
        }
        if (AUTH_KEYWORDS.some((k) => message.includes(k.toLowerCase()))) {
            return ErrorType.Authentication;
        }
        if (error?.status >= 500) {
            return ErrorType.ServerError;
        }
        if (error?.status >= 400 && error?.status < 500) {
            return ErrorType.BadRequest;
        }

        return ErrorType.Unknown;
    }

    /**
     * Calculates delay for exponential backoff
     */
    private calculateDelay(attempt: number, errorType: ErrorType): number {
        let baseDelay = this.retryConfig.initialDelay * this.retryConfig.backoffMultiplier ** attempt;

        // Add jitter to prevent thundering herd
        const jitter = Math.random() * 0.3 * baseDelay;
        baseDelay += jitter;

        // Longer delays for rate limits
        if (errorType === ErrorType.RateLimit) {
            baseDelay *= 2;
        }

        return Math.min(baseDelay, this.retryConfig.maxDelay);
    }

    /**
     * Determines if an error type is retryable
     */
    private isRetryableError(errorType: ErrorType): boolean {
        return errorType !== ErrorType.BadRequest && errorType !== ErrorType.Authentication;
    }

    /**
     * Generates content with automatic retries and key rotation
     * @param prompt - The input prompt or data to send to the LLM
     * @param validate - Function to validate the response
     * @param config - Additional configuration to pass to the adapter
     * @returns The validated generation result
     * @throws {Error} If all retries fail or no valid response is generated
     */
    async generate(
        prompt: TInput,
        validate: Validator<TValidated>,
        config?: any,
    ): Promise<GenerationResult<TValidated>> {
        const maxRetries = this.retryConfig.maxRetries;
        let lastError: Error | null = null;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const apiKey = this.getApiKey();
            const redactedKey = this.redactKey(apiKey);

            try {
                this.logger.log(`[${redactedKey}] Attempt ${attempt + 1}/${maxRetries}`);

                this.keyManager.markRequestStart(apiKey);
                const response = await this.adapter(prompt, apiKey, config);
                const text = this.textExtractor(response);

                if (!text) {
                    this.handleEmptyResponse(apiKey, redactedKey, attempt);
                    continue;
                }

                if (this.validateResponse(text as TValidated, validate, apiKey, redactedKey, attempt)) {
                    return {
                        apiKey: redactedKey,
                        attempts: attempt + 1,
                        content: text as TValidated,
                        isValid: true,
                    };
                }
            } catch (error: any) {
                lastError = error;
                const shouldRetry = await this.handleError(error, apiKey, redactedKey, attempt, maxRetries);

                if (!shouldRetry) {
                    throw error;
                }
            }
        }

        throw lastError || new Error('Failed to generate valid response after all retries');
    }

    /**
     * Gets the next available API key
     */
    private getApiKey(): string {
        try {
            return this.keyManager.getNext();
        } catch (error: any) {
            this.logger.error('Failed to get API key:', error.message);
            throw new Error('No healthy API keys available');
        }
    }

    /**
     * Handles empty response from LLM
     */
    private handleEmptyResponse(apiKey: string, redactedKey: string, attempt: number): void {
        this.logger.warn(`[${redactedKey}] Empty response on attempt ${attempt + 1}`);
        this.keyManager.recordFailure(apiKey, false);
    }

    /**
     * Validates the response and records success/failure
     */
    private validateResponse(
        text: TValidated,
        validate: Validator<TValidated>,
        apiKey: string,
        redactedKey: string,
        attempt: number,
    ): boolean {
        const isValid = validate(text);

        if (isValid) {
            this.keyManager.recordSuccess(apiKey);
            this.logger.log(`[${redactedKey}] Success on attempt ${attempt + 1}`);
            return true;
        }

        this.logger.warn(
            `[${redactedKey}] Validation failed on attempt ${attempt + 1}`,
            'Response preview:',
            typeof text === 'string' ? text.substring(0, 200) : text,
        );
        this.keyManager.recordFailure(apiKey, false);
        return false;
    }

    /**
     * Handles errors and determines if retry should happen
     * @returns true if should retry, false otherwise
     */
    private async handleError(
        error: any,
        apiKey: string,
        redactedKey: string,
        attempt: number,
        maxRetries: number,
    ): Promise<boolean> {
        const errorType = this.classifyError(error);
        this.logger.error(`[${redactedKey}] ${errorType} error on attempt ${attempt + 1}:`, error.message);

        this.keyManager.recordFailure(apiKey, errorType === ErrorType.RateLimit);

        if (!this.isRetryableError(errorType)) {
            return false;
        }

        if (attempt < maxRetries - 1) {
            const delay = this.calculateDelay(attempt, errorType);
            this.logger.log(`[${redactedKey}] Waiting ${delay}ms before retry...`);
            await setTimeout(delay);
        }

        return true;
    }

    /**
     * Generates multiple completions in parallel using different API keys
     * @param prompts - Array of prompts to process
     * @param validate - Function to validate each response, or array of validators (one per prompt)
     * @param config - Additional configuration to pass to the adapter
     * @param concurrency - Maximum number of parallel requests (defaults to number of available keys)
     * @returns Array of generation results
     * @throws {Error} If validators array length doesn't match prompts array length, or if any prompt fails
     */
    async generateBatch(
        prompts: TInput[],
        validate: Validator<TValidated> | Validator<TValidated>[],
        config?: any,
        concurrency?: number,
    ): Promise<GenerationResult<TValidated>[]> {
        // Validate input
        if (Array.isArray(validate) && validate.length !== prompts.length) {
            throw new Error(
                `Validator array length (${validate.length}) must match prompts array length (${prompts.length})`,
            );
        }

        const maxConcurrency = concurrency || this.keyManager.getAvailableCount();
        const results: (GenerationResult<TValidated> | Error)[] = new Array(prompts.length);
        const executing = new Set<Promise<void>>();

        for (let i = 0; i < prompts.length; i++) {
            // Use per-prompt validator if array provided, otherwise use shared validator
            const validator = Array.isArray(validate) ? validate[i] : validate;
            const index = i; // Capture index for closure

            // Create promise variable before the async function
            let promise: Promise<void>;
            promise = (async () => {
                try {
                    const result = await this.generate(prompts[index], validator, config);
                    results[index] = result;
                } catch (error) {
                    this.logger.error(`[generateBatch] Prompt ${index} failed:`, error);
                    results[index] = error as Error;
                } finally {
                    executing.delete(promise);
                }
            })();

            executing.add(promise);

            // Wait for at least one to complete if we're at max concurrency
            if (executing.size >= maxConcurrency) {
                await Promise.race(executing);
            }
        }

        // Wait for all remaining promises to complete
        await Promise.all(Array.from(executing));

        // Check if any failed and throw the first error
        const firstError = results.find((r) => r instanceof Error);
        if (firstError) {
            throw firstError;
        }

        return results as GenerationResult<TValidated>[];
    }

    /**
     * Redacts an API key for safe logging
     */
    private redactKey(key: string): string {
        if (key.length <= 8) {
            return '***';
        }
        return `${key.slice(0, 4)}...${key.slice(-4)}`;
    }

    /**
     * Gets the current health status of all API keys
     */
    getKeyHealthStatus() {
        return this.keyManager.getHealthStatus();
    }

    /**
     * Resets health metrics for all keys
     */
    resetHealth() {
        this.keyManager.resetHealth();
    }
}
