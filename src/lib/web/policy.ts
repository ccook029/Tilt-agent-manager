// ---------------------------------------------------------------------------
// web/policy.ts — what Nova is allowed to ship to the live store by herself.
//
// Nova opens a PR for any change. This decides which of those she may also
// MERGE without Chris looking, and the rule is blast radius: words, images and
// merchandising data can go on their own; anything that can take an order,
// charge a card, or move money cannot.
//
// Two lists, and DENY always wins. The deny list is the real safety property —
// adding a path to the allowlist can never accidentally open up checkout,
// because a denied path stays denied even if some future allow rule matches it.
//
// Pure and tested: this is the one place where "can an agent change the live
// storefront unattended" is decided, so it should be readable in one sitting
// and provable without a network call.
// ---------------------------------------------------------------------------

/**
 * Content and merchandising Nova owns outright. Deliberately a short, explicit
 * list of real files rather than a broad glob — `src/app/**` would sweep in the
 * checkout page, and `src/data/**` would sweep in access codes and stock orders.
 */
const ALLOW: RegExp[] = [
  // Product catalogue: copy, prices, badges, in-stock flags — Nova's charter.
  /^src\/data\/products\.ts$/,
  // Stick colourways and imagery maps.
  /^src\/data\/stickColors\.ts$/,
  /^src\/data\/stickImages\.ts$/,
  // Static assets and crawler-facing text files.
  /^public\/images\/.+/,
  /^public\/llms\.txt$/,
  /^public\/robots\.txt$/,
];

/**
 * Never auto-merged, whatever else matches. These are the paths where a change
 * that compiles can still lose money, break an order, or expose data.
 */
const DENY: RegExp[] = [
  // Anything server-side: API routes, webhooks, business logic, middleware.
  /^src\/app\/api\//,
  /^src\/lib\//,
  /^src\/middleware\.ts$/,
  // Database and infrastructure.
  /^supabase\//,
  /^\.github\//,
  /^(package(-lock)?\.json|next\.config\.[jt]s|vercel\.json|tsconfig\.json)$/,
  // Belt and braces: any path that mentions money or auth, wherever it lives.
  /(checkout|payment|stripe|webhook|auth|admin|coupon|partner|price-|pricing)/i,
];

export interface PathVerdict {
  path: string;
  autoMergeable: boolean;
  /** Why not, in words a founder can act on. */
  reason?: string;
}

export function classifyPath(path: string): PathVerdict {
  const clean = path.replace(/^\/+/, "");

  const denied = DENY.find((re) => re.test(clean));
  if (denied) {
    return {
      path: clean,
      autoMergeable: false,
      reason: "touches order, payment, or server-side code",
    };
  }
  if (ALLOW.some((re) => re.test(clean))) {
    return { path: clean, autoMergeable: true };
  }
  return {
    path: clean,
    autoMergeable: false,
    reason: "outside the content and merchandising Nova ships on her own",
  };
}

export interface ChangeVerdict {
  autoMergeable: boolean;
  /** Every file the PR touches, each with its own verdict. */
  files: PathVerdict[];
  /** One sentence explaining a refusal. */
  reason?: string;
}

/**
 * A change is auto-mergeable only if EVERY file it touches is. One denied file
 * holds the whole PR for review — a change that edits product copy and a
 * checkout helper is a checkout change.
 */
export function classifyChange(paths: string[]): ChangeVerdict {
  const files = paths.map(classifyPath);
  if (files.length === 0) {
    return { autoMergeable: false, files, reason: "the PR changes no files" };
  }
  const blocked = files.filter((f) => !f.autoMergeable);
  if (blocked.length === 0) return { autoMergeable: true, files };

  return {
    autoMergeable: false,
    files,
    reason: `${blocked[0].path} ${blocked[0].reason}${
      blocked.length > 1 ? ` (and ${blocked.length - 1} more)` : ""
    }`,
  };
}
