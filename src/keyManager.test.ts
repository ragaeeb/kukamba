import { beforeEach, describe, expect, it } from 'bun:test';
import { ApiKeyManager } from './keyManager';
import { LoadBalancingStrategy } from './types';

describe('ApiKeyManager', () => {
    describe('constructor', () => {
        it('should initialize with array of keys', () => {
            const manager = new ApiKeyManager(['key1', 'key2', 'key3']);
            expect(manager.getCount()).toBe(3);
        });

        it('should initialize with comma-separated string', () => {
            const manager = new ApiKeyManager('key1,key2,key3');
            expect(manager.getCount()).toBe(3);
        });

        it('should trim whitespace from keys', () => {
            const manager = new ApiKeyManager(' key1 , key2 , key3 ');
            expect(manager.getCount()).toBe(3);
        });

        it('should filter empty strings', () => {
            const manager = new ApiKeyManager('key1,,key2,,,key3');
            expect(manager.getCount()).toBe(3);
        });

        it('should throw error when no keys provided', () => {
            expect(() => new ApiKeyManager([])).toThrow('No API keys provided');
            expect(() => new ApiKeyManager('')).toThrow('No API keys provided');
            expect(() => new ApiKeyManager(',,,')).toThrow('No API keys provided');
        });

        it('should initialize with custom config', () => {
            const manager = new ApiKeyManager(['key1'], LoadBalancingStrategy.RoundRobin, {
                circuitBreakerResetTime: 30000,
                maxConsecutiveFailures: 5,
                maxParallelRequestsPerKey: 20,
                minHealthScore: 0.5,
            });

            expect(manager.getCount()).toBe(1);
        });
    });

    describe('getNext - RoundRobin', () => {
        it('should return keys in round-robin order', () => {
            const manager = new ApiKeyManager(['key1', 'key2', 'key3'], LoadBalancingStrategy.RoundRobin);

            expect(manager.getNext()).toBe('key1');
            expect(manager.getNext()).toBe('key2');
            expect(manager.getNext()).toBe('key3');
            expect(manager.getNext()).toBe('key1');
        });

        it('should handle single key', () => {
            const manager = new ApiKeyManager(['key1'], LoadBalancingStrategy.RoundRobin);

            expect(manager.getNext()).toBe('key1');
            expect(manager.getNext()).toBe('key1');
        });
    });

    describe('getNext - WeightedHealth', () => {
        it('should prefer healthier keys', () => {
            const manager = new ApiKeyManager(['key1', 'key2'], LoadBalancingStrategy.WeightedHealth);

            // Make key1 unhealthy
            manager.recordFailure('key1');
            manager.recordFailure('key1');
            manager.recordFailure('key1');

            // Record some successes for key2
            manager.recordSuccess('key2');
            manager.recordSuccess('key2');

            // key2 should be selected more often
            const selections = new Set();
            for (let i = 0; i < 10; i++) {
                selections.add(manager.getNext());
            }

            expect(selections.has('key2')).toBe(true);
        });
    });

    describe('getNext - LeastConnections', () => {
        it('should select key with fewest active requests', () => {
            const manager = new ApiKeyManager(['key1', 'key2', 'key3'], LoadBalancingStrategy.LeastConnections);

            manager.markRequestStart('key1');
            manager.markRequestStart('key1');
            manager.markRequestStart('key2');

            // key3 has 0 active, should be selected
            expect(manager.getNext()).toBe('key3');
        });
    });

    describe('health tracking', () => {
        let manager: ApiKeyManager;

        beforeEach(() => {
            manager = new ApiKeyManager(['key1', 'key2']);
        });

        it('should track successful requests', () => {
            manager.recordSuccess('key1');
            const health = manager.getHealthStatus();
            const key1Health = health.find((h) => h.key === 'key1');

            expect(key1Health?.successCount).toBe(1);
            expect(key1Health?.failureCount).toBe(0);
            expect(key1Health?.consecutiveFailures).toBe(0);
            expect(key1Health?.healthScore).toBe(1.0);
        });

        it('should track failed requests', () => {
            manager.recordFailure('key1');
            const health = manager.getHealthStatus();
            const key1Health = health.find((h) => h.key === 'key1');

            expect(key1Health?.successCount).toBe(0);
            expect(key1Health?.failureCount).toBe(1);
            expect(key1Health?.consecutiveFailures).toBe(1);
            expect(key1Health?.healthScore).toBeLessThan(1.0);
        });

        it('should reset consecutive failures on success', () => {
            manager.recordFailure('key1');
            manager.recordFailure('key1');
            manager.recordSuccess('key1');

            const health = manager.getHealthStatus();
            const key1Health = health.find((h) => h.key === 'key1');

            expect(key1Health?.consecutiveFailures).toBe(0);
        });

        it('should track active requests', () => {
            manager.markRequestStart('key1');
            manager.markRequestStart('key1');

            const health = manager.getHealthStatus();
            const key1Health = health.find((h) => h.key === 'key1');

            expect(key1Health?.activeRequests).toBe(2);

            manager.recordSuccess('key1');
            const updatedHealth = manager.getHealthStatus();
            const updatedKey1Health = updatedHealth.find((h) => h.key === 'key1');

            expect(updatedKey1Health?.activeRequests).toBe(1);
        });
    });

    describe('circuit breaker', () => {
        it('should open circuit after max consecutive failures', () => {
            const manager = new ApiKeyManager(['key1', 'key2'], LoadBalancingStrategy.RoundRobin, {
                maxConsecutiveFailures: 3,
            });

            manager.recordFailure('key1');
            manager.recordFailure('key1');
            manager.recordFailure('key1');

            const health = manager.getHealthStatus();
            const key1Health = health.find((h) => h.key === 'key1');

            expect(key1Health?.isCircuitOpen).toBe(true);
            expect(key1Health?.circuitResetTime).toBeGreaterThan(Date.now());
        });

        it('should not return circuit-broken keys', () => {
            const manager = new ApiKeyManager(['key1', 'key2'], LoadBalancingStrategy.RoundRobin, {
                maxConsecutiveFailures: 2,
            });

            manager.recordFailure('key1');
            manager.recordFailure('key1');

            // key1 circuit is open, should only get key2
            expect(manager.getNext()).toBe('key2');
            expect(manager.getNext()).toBe('key2');
        });

        it('should throw error when all circuits are open', () => {
            const manager = new ApiKeyManager(['key1'], LoadBalancingStrategy.RoundRobin, {
                maxConsecutiveFailures: 2,
            });

            manager.recordFailure('key1');
            manager.recordFailure('key1');

            expect(() => manager.getNext()).toThrow('No healthy API keys available');
        });

        it('should reset circuit after timeout', async () => {
            const manager = new ApiKeyManager(['key1'], LoadBalancingStrategy.RoundRobin, {
                circuitBreakerResetTime: 100, // 100ms
                maxConsecutiveFailures: 2,
            });

            manager.recordFailure('key1');
            manager.recordFailure('key1');

            expect(() => manager.getNext()).toThrow('No healthy API keys available');

            // Wait for circuit to reset
            await new Promise((resolve) => setTimeout(resolve, 150));

            expect(manager.getNext()).toBe('key1');
        });
    });

    describe('parallel request limits', () => {
        it('should not return key at parallel limit', () => {
            const manager = new ApiKeyManager(['key1', 'key2'], LoadBalancingStrategy.RoundRobin, {
                maxParallelRequestsPerKey: 2,
            });

            manager.markRequestStart('key1');
            manager.markRequestStart('key1');

            // key1 is at limit, should get key2
            expect(manager.getNext()).toBe('key2');
        });

        it('should throw when all keys at parallel limit', () => {
            const manager = new ApiKeyManager(['key1'], LoadBalancingStrategy.RoundRobin, {
                maxParallelRequestsPerKey: 1,
            });

            manager.markRequestStart('key1');

            expect(() => manager.getNext()).toThrow('No healthy API keys available');
        });
    });

    describe('health score calculation', () => {
        it('should decrease health score with failures', () => {
            const manager = new ApiKeyManager(['key1']);

            const initialHealth = manager.getHealthStatus()[0].healthScore;
            manager.recordFailure('key1');
            const afterFailure = manager.getHealthStatus()[0].healthScore;

            expect(afterFailure).toBeLessThan(initialHealth);
        });

        it('should maintain high score with successes', () => {
            const manager = new ApiKeyManager(['key1']);

            manager.recordSuccess('key1');
            manager.recordSuccess('key1');
            manager.recordSuccess('key1');

            const health = manager.getHealthStatus()[0];
            expect(health.healthScore).toBeGreaterThan(0.9);
        });

        it('should penalize consecutive failures more', () => {
            const manager = new ApiKeyManager(['key1', 'key2']);

            // key1: 3 consecutive failures
            manager.recordFailure('key1');
            manager.recordFailure('key1');
            manager.recordFailure('key1');

            // key2: 3 failures with successes in between
            manager.recordFailure('key2');
            manager.recordSuccess('key2');
            manager.recordFailure('key2');
            manager.recordSuccess('key2');
            manager.recordFailure('key2');

            const health = manager.getHealthStatus();
            const key1Health = health.find((h) => h.key === 'key1')!.healthScore;
            const key2Health = health.find((h) => h.key === 'key2')!.healthScore;

            expect(key1Health).toBeLessThan(key2Health);
        });

        it('should not use keys below min health score', () => {
            const manager = new ApiKeyManager(['key1', 'key2'], LoadBalancingStrategy.RoundRobin, {
                minHealthScore: 0.5,
            });

            // Degrade key1 below threshold
            for (let i = 0; i < 10; i++) {
                manager.recordFailure('key1');
            }

            const health = manager.getHealthStatus();
            const key1Health = health.find((h) => h.key === 'key1')!;

            expect(key1Health.healthScore).toBeLessThan(0.5);
            expect(manager.getNext()).toBe('key2');
            expect(manager.getNext()).toBe('key2');
        });
    });

    describe('getAvailableCount', () => {
        it('should return count of healthy keys', () => {
            const manager = new ApiKeyManager(['key1', 'key2', 'key3'], LoadBalancingStrategy.RoundRobin, {
                maxConsecutiveFailures: 2,
            });

            expect(manager.getAvailableCount()).toBe(3);

            manager.recordFailure('key1');
            manager.recordFailure('key1');

            expect(manager.getAvailableCount()).toBe(2);
        });
    });

    describe('resetHealth', () => {
        it('should reset all key health metrics', () => {
            const manager = new ApiKeyManager(['key1', 'key2']);

            manager.recordFailure('key1');
            manager.recordFailure('key1');
            manager.markRequestStart('key1');

            manager.resetHealth();

            const health = manager.getHealthStatus();
            health.forEach((h) => {
                expect(h.successCount).toBe(0);
                expect(h.failureCount).toBe(0);
                expect(h.consecutiveFailures).toBe(0);
                expect(h.healthScore).toBe(1.0);
                expect(h.isCircuitOpen).toBe(false);
                expect(h.activeRequests).toBe(0);
            });
        });

        it('should reset specific key health', () => {
            const manager = new ApiKeyManager(['key1', 'key2']);

            manager.recordFailure('key1');
            manager.recordSuccess('key2');

            manager.resetKeyHealth('key1');

            const health = manager.getHealthStatus();
            const key1Health = health.find((h) => h.key === 'key1')!;
            const key2Health = health.find((h) => h.key === 'key2')!;

            expect(key1Health.failureCount).toBe(0);
            expect(key2Health.successCount).toBe(1);
        });
    });
});
