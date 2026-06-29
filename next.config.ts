import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const appRootDir = path.dirname(fileURLToPath(import.meta.url));

// Inside the SDK monorepo the example must trace from the monorepo root, or
// Vercel resolves the build output against the wrong directory. In a
// standalone clone of the published example repository the example is its own
// root.
const monorepoRootDir = path.resolve(appRootDir, '../..');
const outputFileTracingRoot = fs.existsSync(path.join(monorepoRootDir, 'pnpm-lock.yaml'))
	? monorepoRootDir
	: appRootDir;

const packageJson = JSON.parse(fs.readFileSync(path.join(appRootDir, 'package.json'), 'utf8')) as {
	dependencies?: Record<string, string>;
};
const documentAuthoringVersion = packageJson.dependencies?.['@nutrient-sdk/document-authoring'];
if (!documentAuthoringVersion || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(documentAuthoringVersion)) {
	throw new Error('The example must use an exact @nutrient-sdk/document-authoring version to derive the CDN UMD URL.');
}
const documentAuthoringAssetsBase = process.env.DOCAUTH_ASSETS_BASE;
const documentAuthoringUmdUrl = documentAuthoringAssetsBase
	? `${documentAuthoringAssetsBase}docauth.umd.js`
	: `https://document-authoring.cdn.nutrient.io/releases/document-authoring-${documentAuthoringVersion}-umd.js`;

const nextConfig: NextConfig = {
	outputFileTracingRoot,
	webpack(config, { isServer }) {
		if (!isServer) {
			// The Document Authoring SDK loads its implementation with a dynamic
			// import of a CDN URL, which webpack cannot bundle. Satisfy the package
			// import from the CDN-hosted UMD script's `DocAuth` global instead.
			config.externals.push({
				'@nutrient-sdk/document-authoring': `script DocAuth@${documentAuthoringUmdUrl}`,
			});
			// Script externals generate async module code; every browser the editor
			// supports has async/await, so silence webpack's environment warning.
			config.output.environment = { ...config.output.environment, asyncFunction: true };
		}
		return config;
	},
};

export default nextConfig;
