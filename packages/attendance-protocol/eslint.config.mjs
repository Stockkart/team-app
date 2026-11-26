// The protocol package is linted by the repository root config (`pnpm lint` runs `eslint .` from
// the root). This file exists so `eslint .` also works from inside the package. The monorepo's Nx
// module-boundary rules and `domainUiKitHtmlBan` are not carried over (DD21): pure TypeScript, no JSX.
import rootConfig from '../../eslint.config.mjs';

export default rootConfig;
