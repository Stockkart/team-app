/**
 * The `inventory-api` response envelope, as every endpoint returns it. Local copy of the one type
 * the app used from the web monorepo's `platform/contracts/src/index.ts` (`ApiResponse<T>`); kept
 * here since the app moved to its own repository (worker-app D17, DD21). Change it only when the
 * backend envelope changes, and change the web copy in the same step.
 */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: string;
}
