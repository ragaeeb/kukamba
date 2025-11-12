/**
 * Represents the health status and metrics for an API key
 */
export type KeyHealth = {
    /** The API key (redacted for logging) */
    key: string;
    /** Number of successful requests */
    successCount: number;
    /** Number of failed requests */
    failureCount: number;
    /** Number of consecutive failures */
    consecutiveFailures: number;
    /** Health score (0-1, where 1 is healthy) */
    healthScore: number;
    /** Whether the key is currently in circuit breaker mode */
    isCircuitOpen: boolean;
    /** Timestamp when circuit breaker will reset */
    circuitResetTime?: number;
    /** Current number of parallel requests using this key */
    activeRequests: number;
    /** Maximum allowed parallel requests per key */
    maxParallelRequests: number;
};

/**
 * Configuration options for the ApiKeyManager
 */
export type ApiKeyManagerConfig = {
    /** Maximum consecutive failures before circuit breaker opens */
    maxConsecutiveFailures?: number;
    /** Time in milliseconds before circuit breaker resets */
    circuitBreakerResetTime?: number;
    /** Minimum health score (0-1) before a key is deprioritized */
    minHealthScore?: number;
    /** Maximum parallel requests allowed per key */
    maxParallelRequestsPerKey?: number;
    /** Weight decay factor for health score calculation */
    healthDecayFactor?: number;
};

/**
 * Load balancing strategy for selecting API keys
 */
export enum LoadBalancingStrategy {
    /** Simple round-robin selection */
    RoundRobin = 'round-robin',
    /** Weighted selection based on health score */
    WeightedHealth = 'weighted-health',
    /** Select key with lowest active requests */
    LeastConnections = 'least-connections',
}

/**
 * Logger interface for custom logging implementations
 */
export interface Logger {
    log: (message: string, ...args: any[]) => void;
    warn: (message: string, ...args: any[]) => void;
    error: (message: string, ...args: any[]) => void;
}

/**
 * Configuration for retry behavior
 */
export type RetryConfig = {
    /** Maximum number of retry attempts */
    maxRetries?: number;
    /** Initial delay between retries in milliseconds */
    initialDelay?: number;
    /** Maximum delay between retries in milliseconds */
    maxDelay?: number;
    /** Multiplier for exponential backoff */
    backoffMultiplier?: number;
    /** Timeout for each request in milliseconds */
    timeout?: number;
};

/**
 * Result of an LLM generation attempt
 */
export type GenerationResult<T = string> = {
    /** The generated content */
    content: T;
    /** The API key that was used */
    apiKey: string;
    /** Number of attempts made */
    attempts: number;
    /** Whether the result passed validation */
    isValid: boolean;
};

/**
 * Error types for classification and retry logic
 */
export enum ErrorType {
    RateLimit = 'rate-limit',
    Timeout = 'timeout',
    BadRequest = 'bad-request',
    Authentication = 'authentication',
    ServerError = 'server-error',
    ValidationFailed = 'validation-failed',
    Unknown = 'unknown',
}

/**
 * Adapter function type that LLM providers must implement
 * @param prompt - The prompt or input to send to the LLM
 * @param apiKey - The API key to use for authentication
 * @param config - Any additional configuration
 * @returns The raw response from the LLM
 */
export type LlmAdapter<TInput = any, TOutput = any> = (
    prompt: TInput,
    apiKey: string,
    config?: any,
) => Promise<TOutput>;

/**
 * Function to extract text content from LLM response
 */
export type TextExtractor<TOutput = any> = (response: TOutput) => string | null;

/**
 * Function to validate LLM responses
 */
export type Validator<T = string> = (response: T) => boolean;
