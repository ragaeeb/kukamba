import { defineConfig } from 'tsdown';

export default defineConfig({
    clean: true,
    dts: true,
    entry: ['src/index.ts'],
    external: ['node:timers/promises'],
    format: ['esm'],
    minify: true,
    platform: 'neutral',
    sourcemap: true,
    target: 'esnext',
});
