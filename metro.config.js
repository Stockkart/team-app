/**
 * Metro config for the Stockkart Team app. The repository root is both the Expo project and the
 * pnpm workspace root (`pnpm-workspace.yaml` lists `packages/*`), so `expo/metro-config`'s defaults
 * already watch `packages/attendance-protocol` and resolve from the root `node_modules`
 * (symlinks into `node_modules/.pnpm`). Nothing is added to `watchFolders` or `nodeModulesPaths`
 * (the monorepo version of this file had to add the workspace root; here they are the same folder).
 *
 * Hierarchical lookup stays on: pnpm's isolated layout resolves a package's own dependencies from
 * the real path next to it, which needs the walk up the directory tree.
 */
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;

const config = getDefaultConfig(projectRoot);

// The protocol package's TypeScript sources import siblings with the `.js` extension that `tsc`
// will emit (`import … from './canonical.js'` in `packages/attendance-protocol/src`). Metro
// resolves the package from source (`exports["."].default` → `src/index.ts`) and does not map
// `.js` to `.ts`, so when a relative `.js` import has no file, retry without the extension and let
// `sourceExts` find the `.ts`. Node and Vite are unaffected.
const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstreamResolveRequest ?? context.resolveRequest;
  try {
    return resolve(context, moduleName, platform);
  } catch (error) {
    if (moduleName.startsWith('.') && /\.[cm]?js$/.test(moduleName)) {
      return resolve(context, moduleName.replace(/\.[cm]?js$/, ''), platform);
    }
    throw error;
  }
};

module.exports = config;
