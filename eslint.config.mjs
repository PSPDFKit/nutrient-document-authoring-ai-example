import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
	...nextVitals,
	...nextTs,
	// Ignore generated runtime output and optional self-hosted SDK assets.
	globalIgnores([
		'.next/**',
		'out/**',
		'build/**',
		'next-env.d.ts',
		'public/sdk-assets/**',
		'test-results/**',
		'playwright-report/**',
		'blob-report/**',
	]),
]);

export default eslintConfig;
