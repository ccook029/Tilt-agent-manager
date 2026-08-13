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

/** Carries the status code, so a 404 can be interpreted rather than just shown. */
class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
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
    throw new GitHubError(
      `GitHub ${init?.method ?? "GET"} ${path} → ${res.status}: ${body.slice(0, 300)}`,
      res.status
    );
  }
  return res.json();
}

/** Whether the token can see the storefront repo at all. GitHub answers 404
 *  (not 403) for a private repo the token lacks access to, so "file not found"
 *  and "repo not visible" arrive looking identical — this tells them apart. */
export async function repoVisible(): Promise<boolean> {
  try {
    await gh(`/repos/${websiteRepo()}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Every source file in the storefront, from the repo itself.
 *
 * This exists because the file map Nova worked from was hand-written, and a
 * hand-written map goes stale silently: it named `src/data/products.ts` and the
 * page routes correctly, but for anything in `src/components` it said "ask if
 * unsure of the exact file" — which, to an agent that has to emit a path,
 * means guess. Ask her to add a banner and she reaches for
 * `src/components/Banner.tsx`; the real files are `AnnouncementBar.tsx` and
 * `ActionBanner.tsx`, so the edit 404s before it starts.
 *
 * A real listing removes the guessing entirely, and can't drift out of date.
 */
export async function listRepoFiles(): Promise<string[]> {
  const data = (await gh(
    `/repos/${websiteRepo()}/git/trees/${encodeURIComponent(websiteBaseBranch())}?recursive=1`
  )) as { tree?: { path: string; type: string }[] };
  return (data.tree ?? [])
    .filter(
      (n) =>
        n.type === "blob" &&
        n.path.startsWith("src/") &&
        /\.(tsx?|css|json)$/.test(n.path) &&
        // API route handlers are plumbing, not content Nova edits.
        !n.path.startsWith("src/app/api/")
    )
    .map((n) => n.path)
    .sort();
}

/** Cached so a chat turn doesn't re-fetch the tree for every message. */
let treeCache: { at: number; files: string[] } | null = null;
const TREE_TTL_MS = 5 * 60_000;

export async function cachedRepoFiles(): Promise<string[]> {
  if (treeCache && Date.now() - treeCache.at < TREE_TTL_MS) return treeCache.files;
  const files = await listRepoFiles();
  treeCache = { at: Date.now(), files };
  return files;
}

/** Real paths that look like what was asked for — so a wrong guess comes back
 *  with the actual candidates instead of a bare 404. */
async function nearestPaths(missing: string): Promise<string[]> {
  const base = (missing.split("/").pop() ?? missing).replace(/\.(tsx?|css|json)$/, "");
  const needle = base.toLowerCase();
  if (!needle) return [];
  try {
    const files = await cachedRepoFiles();
    return files
      .filter((f) => {
        const name = (f.split("/").pop() ?? "").toLowerCase();
        return name.includes(needle) || needle.includes(name.replace(/\.(tsx?|css|json)$/, ""));
      })
      .slice(0, 6);
  } catch {
    return [];
  }
}

/** Read a file's text + blob sha from the base branch (or a given ref). */
export async function getFile(
  path: string,
  ref = websiteBaseBranch()
): Promise<{ content: string; sha: string }> {
  let data: { content?: string; sha: string };
  try {
    data = (await gh(
      `/repos/${websiteRepo()}/contents/${path}?ref=${encodeURIComponent(ref)}`
    )) as { content?: string; sha: string };
  } catch (err) {
    // A raw "404: Not Found" is the least useful thing we could report: it's
    // the same answer for a mistyped path, a missing branch, and a token that
    // can't see the repo. Say which one it actually is.
    if (err instanceof GitHubError && err.status === 404) {
      if (!(await repoVisible())) {
        throw new Error(
          `Can't see ${websiteRepo()} — GitHub returns 404 for a private repo the token has no access to. Check GITHUB_TOKEN in the hub's Vercel env still covers the storefront repo (contents + pull-request write).`
        );
      }
      const near = await nearestPaths(path);
      throw new Error(
        `${path} doesn't exist in ${websiteRepo()} on ${ref}.` +
          (near.length ? ` Did you mean: ${near.join(", ")}?` : "")
      );
    }
    throw err;
  }
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

/**
 * Every file a PR touches, with its diff — the input to the auto-merge policy.
 * The patch matters as much as the path: products.ts is an allowed file, but
 * only the diff can say whether this particular change moves a price.
 */
export async function listPrFiles(
  prNumber: number
): Promise<{ filename: string; patch?: string }[]> {
  const data = (await gh(
    `/repos/${websiteRepo()}/pulls/${prNumber}/files?per_page=100`
  )) as { filename: string; patch?: string }[];
  return data.map((f) => ({ filename: f.filename, patch: f.patch }));
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

/** Open PRs on Nova's branches — the sweep's worklist. */
export async function listOpenNovaPrs(): Promise<
  { number: number; title: string }[]
> {
  const data = (await gh(
    `/repos/${websiteRepo()}/pulls?state=open&per_page=50`
  )) as { number: number; title: string; head: { ref: string } }[];
  return data
    .filter((pr) => pr.head.ref.startsWith("nova/"))
    .map((pr) => ({ number: pr.number, title: pr.title }));
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
