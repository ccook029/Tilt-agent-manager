// ---------------------------------------------------------------------------
// web/github.ts — minimal GitHub REST client for the Website Manager (Nova).
//
// Lets the hub open pull requests against the storefront repo (tiltweb): edit
// a file on a branch, open a PR, and — for content and merchandising paths
// only, once CI is green — merge it (see ./policy.ts for where that line sits;
// anything touching orders or payments still waits for Chris).
//
// Needs GITHUB_TOKEN with contents + PR write, and — for the merge step —
// permission to merge into the base branch. Degrades cleanly
// (websiteRepoConfigured() === false) until it's set.
// ---------------------------------------------------------------------------
const API = "https://api.github.com";

export function websiteRepo(): string {
  return process.env.WEBSITE_REPO || "ccook029/tiltweb";
}
export function websiteBaseBranch(): string {
  return process.env.WEBSITE_BASE_BRANCH || "main";
}
export function websiteRepoConfigured(): boolean {
  return !!process.env.GITHUB_TOKEN;
}

function token(): string {
  const t = process.env.GITHUB_TOKEN;
  if (!t) throw new Error("GITHUB_TOKEN is not set");
  return t;
}

async function gh(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub ${init?.method ?? "GET"} ${path} → ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

/** Read a file's text + blob sha from the base branch (or a given ref). */
export async function getFile(
  path: string,
  ref = websiteBaseBranch()
): Promise<{ content: string; sha: string }> {
  const data = (await gh(
    `/repos/${websiteRepo()}/contents/${path}?ref=${encodeURIComponent(ref)}`
  )) as { content?: string; sha: string };
  const content = Buffer.from(data.content ?? "", "base64").toString("utf8");
  return { content, sha: data.sha };
}

/** SHA of the base branch tip, to branch from. */
export async function getBaseSha(): Promise<string> {
  const data = (await gh(
    `/repos/${websiteRepo()}/git/ref/heads/${encodeURIComponent(websiteBaseBranch())}`
  )) as { object: { sha: string } };
  return data.object.sha;
}

export async function createBranch(name: string, fromSha: string): Promise<void> {
  await gh(`/repos/${websiteRepo()}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${name}`, sha: fromSha }),
  });
}

/** Commit new content for a file on a branch (sha = the file's current blob sha). */
export async function commitFile(
  path: string,
  content: string,
  message: string,
  branch: string,
  sha: string
): Promise<void> {
  await gh(`/repos/${websiteRepo()}/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch,
      sha,
    }),
  });
}

export async function openPr(
  title: string,
  head: string,
  body: string
): Promise<{ url: string; number: number }> {
  const data = (await gh(`/repos/${websiteRepo()}/pulls`, {
    method: "POST",
    body: JSON.stringify({ title, head, base: websiteBaseBranch(), body }),
  })) as { html_url: string; number: number };
  return { url: data.html_url, number: data.number };
}

/** Every file a PR touches — the input to the auto-merge policy. */
export async function listPrFiles(prNumber: number): Promise<string[]> {
  const data = (await gh(
    `/repos/${websiteRepo()}/pulls/${prNumber}/files?per_page=100`
  )) as { filename: string }[];
  return data.map((f) => f.filename);
}

export interface PrState {
  headSha: string;
  merged: boolean;
  /** GitHub's own view: "clean", "blocked", "dirty", "unstable", "unknown". */
  mergeableState: string;
}

export async function getPr(prNumber: number): Promise<PrState> {
  const data = (await gh(`/repos/${websiteRepo()}/pulls/${prNumber}`)) as {
    head: { sha: string };
    merged: boolean;
    mergeable_state: string;
  };
  return {
    headSha: data.head.sha,
    merged: data.merged,
    mergeableState: data.mergeable_state,
  };
}

export type ChecksVerdict = "passing" | "pending" | "failing" | "none";

/**
 * Combined CI verdict for a commit, across both the legacy statuses API
 * (which is what Vercel posts) and check runs. "none" means nothing has
 * reported yet — treated as not-yet-safe rather than as success, so a PR can
 * never be merged in the gap before CI starts.
 */
export async function getChecks(sha: string): Promise<ChecksVerdict> {
  const [status, runs] = await Promise.all([
    gh(`/repos/${websiteRepo()}/commits/${sha}/status`) as Promise<{
      state: string;
      total_count: number;
    }>,
    gh(`/repos/${websiteRepo()}/commits/${sha}/check-runs`) as Promise<{
      check_runs: { status: string; conclusion: string | null }[];
    }>,
  ]);

  const runList = runs.check_runs ?? [];
  const anyReported = status.total_count > 0 || runList.length > 0;
  if (!anyReported) return "none";

  if (status.total_count > 0 && status.state === "failure") return "failing";
  if (
    runList.some(
      (r) =>
        r.status === "completed" &&
        r.conclusion &&
        !["success", "neutral", "skipped"].includes(r.conclusion)
    )
  ) {
    return "failing";
  }

  const statusPending = status.total_count > 0 && status.state === "pending";
  const runsPending = runList.some((r) => r.status !== "completed");
  if (statusPending || runsPending) return "pending";

  return "passing";
}

export async function mergePr(
  prNumber: number,
  title: string
): Promise<{ merged: boolean; message: string }> {
  const data = (await gh(`/repos/${websiteRepo()}/pulls/${prNumber}/merge`, {
    method: "PUT",
    body: JSON.stringify({
      merge_method: "squash",
      commit_title: `${title} (#${prNumber})`,
    }),
  })) as { merged: boolean; message: string };
  return data;
}
