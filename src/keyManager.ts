import { type ApiKeyManagerConfig, type KeyHealth, LoadBalancingStrategy } from './types';

/**
 * Manages a pool of API keys with health tracking, circuit breaking,
 * and intelligent load balancing to prevent rate limiting
 */
export class ApiKeyManager {
    private keys: string[];
    private keyHealth: Map<string, KeyHealth>;
    private currentIndex: number = 0;
    private config: Required<ApiKeyManagerConfig>;
    private strategy: LoadBalancingStrategy;

    /**
     * Creates a new ApiKeyManager instance
     * @param keys - Array of API keys or comma-separated string
     * @param strategy - Load balancing strategy to use
     * @param config - Configuration options
     * @throws {Error} If no API keys are provided
     */
    constructor(
        keys: string[] | string,
        strategy: LoadBalancingStrategy = LoadBalancingStrategy.RoundRobin,
        config: ApiKeyManagerConfig = {},
    ) {
        if (typeof keys === 'string') {
            keys = keys
                .split(',')
                .map((k) => k.trim())
                .filter((k) => k);
        }

        if (keys.length === 0) {
            throw new Error('No API keys provided');
        }

        this.keys = keys;
        this.strategy = strategy;
        this.config = {
            circuitBreakerResetTime: config.circuitBreakerResetTime ?? 60000,
            healthDecayFactor: config.healthDecayFactor ?? 0.95,
            maxConsecutiveFailures: config.maxConsecutiveFailures ?? 3,
            maxParallelRequestsPerKey: config.maxParallelRequestsPerKey ?? 10,
            minHealthScore: config.minHealthScore ?? 0.3,
        };

        this.keyHealth = new Map();
        this.initializeKeyHealth();
    }

    /**
     * Initializes health tracking for all keys
     */
    private initializeKeyHealth(): void {
        for (const key of this.keys) {
            this.keyHealth.set(key, {
                activeRequests: 0,
                consecutiveFailures: 0,
                failureCount: 0,
                healthScore: 1.0,
                isCircuitOpen: false,
                key,
                maxParallelRequests: this.config.maxParallelRequestsPerKey,
                successCount: 0,
            });
        }
    }

    /**
     * Gets the next available API key based on the load balancing strategy
     * @returns The next API key to use
     * @throws {Error} If all keys are unhealthy or circuit breakers are open
     */
    getNext(): string {
        const availableKeys = this.getAvailableKeys();

        if (availableKeys.length === 0) {
            throw new Error('No healthy API keys available');
        }

        let selectedKey: string;

        switch (this.strategy) {
            case LoadBalancingStrategy.WeightedHealth:
                selectedKey = this.selectByWeightedHealth(availableKeys);
                break;
            case LoadBalancingStrategy.LeastConnections:
                selectedKey = this.selectByLeastConnections(availableKeys);
                break;
            case LoadBalancingStrategy.RoundRobin:
            default:
                selectedKey = this.selectRoundRobin(availableKeys);
                break;
        }

        return selectedKey;
    }

    /**
     * Gets all keys that are available for use (not circuit broken, under parallel limit)
     */
    private getAvailableKeys(): string[] {
        const now = Date.now();
        return this.keys.filter((key) => {
            const health = this.keyHealth.get(key)!;

            // Reset circuit breaker if time has elapsed
            if (health.isCircuitOpen && health.circuitResetTime && now >= health.circuitResetTime) {
                health.isCircuitOpen = false;
                health.consecutiveFailures = 0;
                health.circuitResetTime = undefined;
            }

            // Key is available if circuit is closed, has capacity, and meets minimum health
            return (
                !health.isCircuitOpen &&
                health.activeRequests < health.maxParallelRequests &&
                health.healthScore >= this.config.minHealthScore
            );
        });
    }

    /**
     * Selects a key using round-robin strategy
     */
    private selectRoundRobin(availableKeys: string[]): string {
        const key = availableKeys[this.currentIndex % availableKeys.length];
        this.currentIndex = (this.currentIndex + 1) % availableKeys.length;
        return key;
    }

    /**
     * Selects a key using weighted health scoring
     */
    private selectByWeightedHealth(availableKeys: string[]): string {
        const weights = availableKeys.map((key) => this.keyHealth.get(key)!.healthScore);
        const totalWeight = weights.reduce((sum, w) => sum + w, 0);
        let random = Math.random() * totalWeight;

        for (let i = 0; i < availableKeys.length; i++) {
            random -= weights[i];
            if (random <= 0) {
                return availableKeys[i];
            }
        }

        return availableKeys[0];
    }

    /**
     * Selects a key with the least active connections
     */
    private selectByLeastConnections(availableKeys: string[]): string {
        return availableKeys.reduce((minKey, key) => {
            const minHealth = this.keyHealth.get(minKey)!;
            const keyHealth = this.keyHealth.get(key)!;
            return keyHealth.activeRequests < minHealth.activeRequests ? key : minKey;
        });
    }

    /**
     * Marks the start of a request using a specific key
     * @param key - The API key being used
     */
    markRequestStart(key: string): void {
        const health = this.keyHealth.get(key);
        if (health) {
            health.activeRequests++;
        }
    }

    /**
     * Records a successful request and updates health metrics
     * @param key - The API key that was used
     */
    recordSuccess(key: string): void {
        const health = this.keyHealth.get(key);
        if (health) {
            health.successCount++;
            health.consecutiveFailures = 0;
            health.activeRequests = Math.max(0, health.activeRequests - 1);
            this.updateHealthScore(health);
        }
    }

    /**
     * Records a failed request and updates health metrics
     * @param key - The API key that was used
     * @param isRateLimit - Whether the failure was due to rate limiting
     */
    recordFailure(key: string, isRateLimit: boolean = false): void {
        const health = this.keyHealth.get(key);
        if (health) {
            health.failureCount++;
            health.consecutiveFailures++;
            health.activeRequests = Math.max(0, health.activeRequests - 1);

            // Open circuit breaker if too many consecutive failures
            if (health.consecutiveFailures >= this.config.maxConsecutiveFailures) {
                health.isCircuitOpen = true;
                health.circuitResetTime = Date.now() + this.config.circuitBreakerResetTime;
            }

            this.updateHealthScore(health);
        }
    }

    /**
     * Updates the health score for a key based on success/failure ratio
     */
    private updateHealthScore(health: KeyHealth): void {
        const totalRequests = health.successCount + health.failureCount;
        if (totalRequests === 0) {
            health.healthScore = 1.0;
            return;
        }

        // Calculate base success rate
        const successRate = health.successCount / totalRequests;

        // Apply decay factor for recent performance weighting
        const decayedScore = health.healthScore * this.config.healthDecayFactor;
        health.healthScore = decayedScore + successRate * (1 - this.config.healthDecayFactor);

        // Penalize consecutive failures
        if (health.consecutiveFailures > 0) {
            health.healthScore *= 0.8 ** health.consecutiveFailures;
        }

        // Clamp between 0 and 1
        health.healthScore = Math.max(0, Math.min(1, health.healthScore));
    }

    /**
     * Gets the current health status for all keys
     * @returns Array of health information for all keys
     */
    getHealthStatus(): KeyHealth[] {
        return Array.from(this.keyHealth.values());
    }

    /**
     * Gets the total number of API keys managed
     * @returns The count of API keys
     */
    getCount(): number {
        return this.keys.length;
    }

    /**
     * Gets the number of currently available (healthy) keys
     * @returns The count of available keys
     */
    getAvailableCount(): number {
        return this.getAvailableKeys().length;
    }

    /**
     * Resets health metrics for all keys
     */
    resetHealth(): void {
        this.initializeKeyHealth();
    }

    /**
     * Resets health metrics for a specific key
     * @param key - The API key to reset
     */
    resetKeyHealth(key: string): void {
        if (this.keyHealth.has(key)) {
            this.keyHealth.set(key, {
                activeRequests: 0,
                consecutiveFailures: 0,
                failureCount: 0,
                healthScore: 1.0,
                isCircuitOpen: false,
                key,
                maxParallelRequests: this.config.maxParallelRequestsPerKey,
                successCount: 0,
            });
        }
    }
}
