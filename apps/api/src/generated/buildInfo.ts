/**
 * Purpose: Provide build metadata for startup logs when no runtime env override is present.
 * Input/Output: Docker builds may overwrite this file with the checked-out Git commit.
 * Invariants: The value is public release metadata only; never place secrets or operator config here.
 * Debugging: If startup logs show commit "unknown", inspect apps/api/scripts/write-build-info.mjs and the Docker build context.
 */

export const BUILD_COMMIT = "unknown";
