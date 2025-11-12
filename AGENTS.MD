# AGENTS.md - Development Guide for Kukamba

This document provides comprehensive information about the Kukamba project structure, coding conventions, and guidelines for AI agents and human developers working on the codebase.

## Project Overview

**Kukamba** is a lightweight TypeScript library for intelligent API key rotation and parallel request management when working with LLM providers. The library helps developers avoid rate limits by:

- Rotating through multiple API keys intelligently
- Tracking health metrics for each key
- Implementing circuit breakers for unhealthy keys
- Supporting parallel requests across different keys
- Providing flexible load balancing strategies

## Project Structure

```
kukamba/
├── src/
│   │── keyManager.ts       # Core key management with health tracking
│   ├── keyManager.test.ts  # Unit tests for ApiKeyManager
│   ├── client.ts           # Generic LLM client with retry logic
│   └── client.test.ts      # Unit tests for LlmClient
│   └── index.ts               # Public API exports
├── package.json                    # Package configuration
├── tsconfig.json                   # TypeScript configuration
├── biome.json                      # Biome linter configuration
├── README.md                       # User-facing documentation
└── AGENTS.md                       # This file - developer guide
```

## File Descriptions

### `src/lib/ApiKeyManager.ts`

**Purpose:** Manages a pool of API keys with intelligent selection strategies, health tracking, and circuit breaking.

**Key Features:**
- Multiple load balancing strategies (round-robin, weighted health, least connections)
- Health scoring based on success/failure rates
- Circuit breaker pattern for unhealthy keys
- Parallel request limiting per key
- Automatic key rotation

**Key Classes/Interfaces:**
- `ApiKeyManager` - Main class for managing API keys
- `KeyHealth` - Interface for health metrics
- `ApiKeyManagerConfig` - Configuration options
- `LoadBalancingStrategy` - Enum for selection strategies

**Dependencies:** None (pure TypeScript)

### `src/lib/LlmClient.ts`

**Purpose:** Generic client for making LLM API requests with automatic retries, validation, and key rotation.

**Key Features:**
- Provider-agnostic adapter pattern
- Automatic retry with exponential backoff
- Error classification and handling
- Response validation
- Batch processing with concurrency control
- Custom logger support

**Key Classes/Interfaces:**
- `LlmClient` - Main client class
- `Logger` - Interface for custom logging
- `LlmAdapter` - Type for provider adapters
- `RetryConfig` - Configuration for retry behavior
- `GenerationResult` - Result of generation attempts
- `ErrorType` - Enum for error classification

**Dependencies:**
- `node:timers/promises` (for setTimeout)
- `ApiKeyManager`

### `src/__tests__/ApiKeyManager.test.ts`

**Purpose:** Comprehensive unit tests for ApiKeyManager functionality.

**Test Coverage:**
- Constructor validation and initialization
- All load balancing strategies
- Health tracking and scoring
- Circuit breaker behavior
- Parallel request limiting
- Health reset functionality

**Testing Framework:** Bun test with `describe`/`it` convention

### `src/__tests__/LlmClient.test.ts`

**Purpose:** Comprehensive unit tests for LlmClient functionality.

**Test Coverage:**
- Client initialization
- Single and batch generation
- Retry logic and backoff
- Error classification
- Key rotation on failures
- Health status tracking
- Custom logger integration

**Testing Framework:** Bun test with `describe`/`it` convention

## Coding Conventions

### General Principles

1. **TypeScript First** - All code must be written in TypeScript with full type safety
2. **No External Dependencies** - Keep the library lightweight; avoid bundling provider SDKs
3. **Functional and Clean** - Prefer pure functions where possible, keep side effects isolated
4. **Defensive Programming** - Validate inputs, handle edge cases, provide clear error messages
5. **Performance Conscious** - Optimize for high-throughput scenarios with many parallel requests

### Naming Conventions

- **Classes:** PascalCase (e.g., `ApiKeyManager`, `LlmClient`)
- **Interfaces:** PascalCase with descriptive names (e.g., `KeyHealth`, `RetryConfig`)
- **Methods:** camelCase with verb prefix (e.g., `getNext`, `recordSuccess`, `markRequestStart`)
- **Private Methods:** camelCase with `private` keyword (e.g., `private calculateDelay`)
- **Constants:** SCREAMING_SNAKE_CASE (e.g., `RATE_LIMIT_KEYWORDS`, `TIMEOUT_KEYWORDS`)
- **Enums:** PascalCase for enum name, PascalCase for values (e.g., `ErrorType.RateLimit`)
- **Type Aliases:** PascalCase (e.g., `LlmAdapter`, `Validator`)

### Code Style

- **Indentation:** 2 spaces (configured in Biome)
- **Quotes:** Single quotes for strings
- **Semicolons:** Required at statement ends
- **Line Length:** Prefer lines under 120 characters
- **Trailing Commas:** Required in multi-line objects/arrays
- **Arrow Functions:** Prefer arrow functions for callbacks and short functions

### Documentation Standards

All public APIs must have JSDoc comments including:

```typescript
/**
 * Brief description of what the function/class does
 * @param paramName - Description of the parameter
 * @returns Description of return value
 * @throws {ErrorType} Description of when/why it throws
 * @example
 * ```typescript
 * const result = exampleFunction('input');
 * ```
 */
```

**JSDoc Requirements:**
- All public classes, methods, and functions must have JSDoc
- Include `@param` for all parameters with type and description
- Include `@returns` for non-void return values
- Include `@throws` for any thrown errors
- Add `@example` for complex APIs
- Private methods should have brief comments explaining their purpose

### Testing Conventions

**Test Structure:**
```typescript
import { describe, expect, it, beforeEach } from 'bun:test';

describe('ClassName', () => {
  describe('methodName', () => {
    it('should do something specific when condition', () => {
      // Arrange
      const input = 'test';
      
      // Act
      const result = methodName(input);
      
      // Assert
      expect(result).toBe('expected');
    });
  });
});
```

**Test Guidelines:**
- Group tests by class/file using top-level `describe`
- Group related tests by method using nested `describe`
- Use `it('should...')` convention for test names
- Use Arrange-Act-Assert pattern
- Test happy paths and edge cases
- Test error conditions
- Use `beforeEach` for common setup
- Mock external dependencies using `mock()` from Bun test

### Error Handling

**Error Patterns:**
```typescript
// For validation errors
if (!isValid(input)) {
  throw new Error('Clear, descriptive error message');
}

// For typed errors
enum ErrorType {
  RateLimit = 'rate-limit',
  Timeout = 'timeout',
}

// For error classification
private classifyError(error: any): ErrorType {
  const message = error?.message?.toLowerCase() || '';
  if (KEYWORDS.some(k => message.includes(k))) {
    return ErrorType.SomeType;
  }
  return ErrorType.Unknown;
}
```

**Guidelines:**
- Throw descriptive errors that help users diagnose issues
- Use error classification for retry logic
- Always handle edge cases (empty arrays, null values, etc.)
- Provide fallback behavior where appropriate

### Type Safety

**Type Guidelines:**
```typescript
// Use generic types for flexibility
class Client<TInput = any, TOutput = any> {
  async generate(input: TInput): Promise<TOutput> { }
}

// Use strict types for internal logic
private keys: string[];
private currentIndex: number = 0;

// Use type guards for runtime checks
function isRateLimitError(error: any): error is RateLimitError {
  return error?.status === 429;
}

// Use union types for variants
type Strategy = 'round-robin' | 'weighted' | 'least-connections';
```

## Package Management

**Package Manager:** Bun (v1.1.32+)

**Commands:**
```bash
# Install dependencies
bun install

# Run tests
bun test

# Run linting
bun run lint

# Build for distribution
bun run build
```

## Linting and Formatting

**Linter:** Biome

**Configuration:** Located in `biome.json`

**Key Settings:**
- 2-space indentation
- Single quotes
- Semicolons required
- Trailing commas in multiline
- Line length: 120 characters
- Sort imports automatically

**Pre-commit:** Ensure code passes `bun run lint` before committing

## Development Workflow

### Adding New Features

1. **Design First:** Consider the API design and how it fits with existing patterns
2. **Type Safety:** Define interfaces and types before implementation
3. **Implementation:** Write the feature following coding conventions
4. **Documentation:** Add comprehensive JSDoc comments
5. **Tests:** Write unit tests covering happy paths and edge cases
6. **Examples:** Add usage examples to README.md if applicable
7. **Review:** Ensure code passes linting and all tests

### Modifying Existing Code

1. **Understand Context:** Read existing code and tests thoroughly
2. **Maintain Compatibility:** Avoid breaking changes to public APIs
3. **Update Tests:** Modify or add tests for changed behavior
4. **Update Docs:** Update JSDoc and README.md as needed
5. **Verify:** Run full test suite and linting

### Adding Tests

1. **File Naming:** Use `ClassName.test.ts` pattern
2. **Test Structure:** Follow describe/it convention
3. **Coverage:** Aim for comprehensive coverage of functionality
4. **Mocking:** Use Bun's `mock()` for external dependencies
5. **Assertions:** Use clear, specific expect() assertions
6. **Edge Cases:** Test error conditions, empty inputs, boundary values

## Design Patterns

### Adapter Pattern

The library uses adapters to support any LLM provider:

```typescript
type LlmAdapter<TInput, TOutput> = (
  prompt: TInput,
  apiKey: string,
  config?: any
) => Promise<TOutput>;
```

This keeps the core library provider-agnostic.

### Circuit Breaker Pattern

Keys that fail repeatedly are temporarily disabled:

```typescript
if (health.consecutiveFailures >= maxConsecutiveFailures) {
  health.isCircuitOpen = true;
  health.circuitResetTime = Date.now() + resetTime;
}
```

### Strategy Pattern

Multiple load balancing strategies are implemented:

```typescript
enum LoadBalancingStrategy {
  RoundRobin = 'round-robin',
  WeightedHealth = 'weighted-health',
  LeastConnections = 'least-connections',
}
```

### Dependency Injection

Logger and configuration can be injected:

```typescript
constructor(
  adapter: LlmAdapter,
  keyManager: ApiKeyManager,
  logger: Logger = consoleLogger
) { }
```

## Common Tasks for AI Agents

### Task: Add New Load Balancing Strategy

1. Add enum value to `LoadBalancingStrategy`
2. Implement `private select{StrategyName}()` method in `ApiKeyManager`
3. Add case to switch statement in `getNext()`
4. Write tests in `ApiKeyManager.test.ts`
5. Document in README.md

### Task: Add New Error Type

1. Add to `ErrorType` enum in `LlmClient.ts`
2. Add keywords to appropriate constant array
3. Update `classifyError()` method
4. Update retry logic if needed
5. Add tests for error classification
6. Document in README.md

### Task: Improve Health Scoring

1. Modify `updateHealthScore()` in `ApiKeyManager.ts`
2. Add configuration options if needed
3. Update tests to verify new behavior
4. Document algorithm in JSDoc

### Task: Add New Validation Helper

1. Create example in README.md Examples section
2. Add JSDoc explaining the validation pattern
3. Consider if it should be a built-in utility

## Performance Considerations

- **Async Operations:** Use `Promise.all()` for parallel operations
- **Memory:** Avoid storing large response bodies unnecessarily
- **Key Selection:** Keep selection algorithms O(n) or better
- **Retries:** Use exponential backoff to avoid overwhelming servers
- **Batch Processing:** Respect concurrency limits

## Security Considerations

- **Key Redaction:** Always use redaction for logging API keys
- **Error Messages:** Don't leak sensitive information in errors
- **Validation:** Validate all user inputs
- **Dependencies:** Keep zero external dependencies to minimize attack surface

## Debugging Tips

1. **Enable Logging:** Use custom logger to debug key selection and retries
2. **Health Monitoring:** Check `getKeyHealthStatus()` to see key performance
3. **Circuit Breakers:** Look for open circuits when requests fail
4. **Parallel Limits:** Check if keys are at parallel request capacity

## Future Enhancements (TODO)

- [ ] Add support for rate limit headers (X-RateLimit-*)
- [ ] Implement priority queuing for requests
- [ ] Add metrics export (Prometheus format)
- [ ] Support for weighted key allocation
- [ ] Add request deduplication
- [ ] Implement request caching layer
- [ ] Add streaming response support

## Questions for AI Agents

When working on this codebase, consider:

1. **Does this change maintain backwards compatibility?**
2. **Are there sufficient tests for the new behavior?**
3. **Is the JSDoc documentation complete and accurate?**
4. **Does this follow the established coding conventions?**
5. **Will this scale with many keys and parallel requests?**
6. **Does this introduce any new dependencies?**
7. **Is the error handling comprehensive?**
8. **Are edge cases handled properly?**

## Getting Help

- Review existing code for patterns and conventions
- Check tests for usage examples
- Read JSDoc comments for API details
- Refer to README.md for user-facing documentation

---

**Last Updated:** 2024
**Maintainers:** Open Source Contributors
