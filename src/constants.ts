/**
 * Keywords to identify rate limit errors
 */
export const RATE_LIMIT_KEYWORDS = ['429', 'rate limit', 'Too Many Requests', 'model is overloaded', 'quota exceeded'];

/**
 * Keywords to identify timeout errors
 */
export const TIMEOUT_KEYWORDS = ['timeout', 'timed out', 'ETIMEDOUT', 'ECONNABORTED'];

/**
 * Keywords to identify authentication errors
 */
export const AUTH_KEYWORDS = ['401', 'unauthorized', 'invalid api key', 'authentication failed'];
