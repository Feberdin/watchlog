/**
 * Purpose: Write build metadata into the API source before TypeScript compilation.
 * Input/Output: APP_COMMIT or the local .git checkout becomes src/generated/buildInfo.ts.
 * Invariants: Only public commit metadata is written; no env values other than APP_COMMIT are read or logged.
 * Debugging: Run `APP_COMMIT=$(git rev-parse HEAD) node apps/api/scripts/write-build-info.mjs` from the repo root.
 */

import fs from "node:fs";
import path from "node:path";

function resolveGitDir(repoRoot) {
  const gitPath = path.join(repoRoot, ".git");
  if (!fs.existsSync(gitPath)) {
    return null;
  }

  const stat = fs.statSync(gitPath);
  if (stat.isDirectory()) {
    return gitPath;
  }

  const gitFile = fs.readFileSync(gitPath, "utf8").trim();
  if (!gitFile.startsWith("gitdir:")) {
    return null;
  }

  return path.resolve(repoRoot, gitFile.slice("gitdir:".length).trim());
}

function readCommitFromGit(repoRoot) {
  const gitDir = resolveGitDir(repoRoot);
  if (!gitDir) {
    return null;
  }

  const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
  if (!head.startsWith("ref: ")) {
    return head;
  }

  const refPath = path.join(gitDir, head.slice("ref: ".length));
  if (!fs.existsSync(refPath)) {
    return readCommitFromPackedRefs(gitDir, head.slice("ref: ".length));
  }

  return fs.readFileSync(refPath, "utf8").trim();
}

function readCommitFromPackedRefs(gitDir, refName) {
  const packedRefsPath = path.join(gitDir, "packed-refs");
  if (!fs.existsSync(packedRefsPath)) {
    return null;
  }

  const packedRefs = fs.readFileSync(packedRefsPath, "utf8").split("\n");
  for (const line of packedRefs) {
    if (!line || line.startsWith("#") || line.startsWith("^")) {
      continue;
    }

    const [commit, packedRefName] = line.trim().split(/\s+/, 2);
    if (packedRefName === refName) {
      return commit;
    }
  }

  return null;
}

function normalizeCommit(value) {
  const commit = value?.trim();
  if (!commit || commit === "unknown") {
    return "unknown";
  }

  return /^[a-f0-9]{7,40}$/i.test(commit) ? commit : "unknown";
}

const repoRoot = process.cwd();
const commit = normalizeCommit(process.env.APP_COMMIT) !== "unknown"
  ? normalizeCommit(process.env.APP_COMMIT)
  : normalizeCommit(readCommitFromGit(repoRoot));

const outputPath = path.join(repoRoot, "apps/api/src/generated/buildInfo.ts");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `/**
 * Purpose: Provide build metadata for startup logs when no runtime env override is present.
 * Input/Output: Docker builds may overwrite this file with the checked-out Git commit.
 * Invariants: The value is public release metadata only; never place secrets or operator config here.
 * Debugging: If startup logs show commit "unknown", inspect apps/api/scripts/write-build-info.mjs and the Docker build context.
 */

export const BUILD_COMMIT = ${JSON.stringify(commit)};
`);
