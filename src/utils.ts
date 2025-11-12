/**
 * Redacts an API key for safe logging by showing only the first and last 4 characters
 * @param key - The API key to redact
 * @returns Redacted API key string (e.g., "sk12...xy89")
 * @example
 * ```typescript
 * const redacted = redactText('sk-1234567890abcdef');
 * console.log(redacted); // "sk-1...cdef"
 * ```
 */
export const redactText = (key: string): string => {
    if (key.length <= 8) {
        return '***';
    }
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
};
