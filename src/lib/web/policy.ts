// ---------------------------------------------------------------------------
// web/policy.ts — what Nova is allowed to ship to the live store by herself.
//
// Nova opens a PR for any change. This decides which of those she may also
// MERGE without Chris looking, and the rule is blast radius: catalogue data,
// words and images can go on their own (a merged price change is labelled
// loudly, never held — retired as a gate 2026-08-12 since every publish
// already rides a founder's approve click); code that can take an order or
// charge a card cannot.
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
  // Announcement bar copy. The bar used to be JSX inside a component, which
  // made "put the drop up" a code change Nova couldn't ship — so a one-sentence
  // promo was a developer task and, in practice, didn't happen. It's a headline,
  // a line of copy and an on-site link: the same blast radius as product copy,
  // which is already here.
  /^src\/data\/announcements\.ts$/,
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

/**
 * Does this diff touch money?
 *
 * RETIRED AS A GATE (2026-08-12, Chris's call): every published change already
 * passes through a founder's approve click, so holding the PR a second time
 * for a number bought little and cost the flow-through he wanted. What
 * survives is the LABEL — a merged price change is announced as a price change
 * in the HQ signal and the PR body, never silently. The one honest caveat,
 * stated when the rule was retired: the approve click happens on Nova's
 * DESCRIBED change, and the diff is generated after it — this label is the
 * only thing watching the artifact itself.
 *
 * Detection is structural because prices take three shapes — `price: 135.0`,
 * `comparePrice: 199`, and `priceModifiers`, a nested map whose inner lines
 * (`"70\"": 10`) never contain the word "price": a changed line that mentions
 * price, or adds/removes a bare numeric value, counts.
 */
export function touchesMoney(patch: string): boolean {
  for (const line of patch.split("\n")) {
    // Only added/removed lines; context lines and hunk headers are unchanged.
    if (!/^[+-]/.test(line) || /^(\+\+\+|---)/.test(line)) continue;
    const body = line.slice(1);

    if (/price/i.test(body)) return true;
    // key: 135.0   |   "70\"": 10   |   a bare 24.99 in an array
    if (/:\s*-?\d+(\.\d+)?\s*,?\s*$/.test(body)) return true;
    if (/^\s*-?\d+(\.\d+)?\s*,?\s*$/.test(body)) return true;
  }
  return false;
}

/** Catalogue files where the price LABEL applies. */
function isCatalogueFile(path: string): boolean {
  return /^src\/data\/.+\.ts$/.test(path);
}

/**
 * Does this change move any number in the catalogue? Not a gate — the callers
 * use it to label a merged price change loudly (HQ signal, PR body) so it can
 * never ship silently. A catalogue file whose diff can't be read counts as a
 * price change for labelling: unreadable is not the same as harmless.
 */
export function changesPrices(
  prFiles: { filename: string; patch?: string }[]
): boolean {
  return prFiles.some((f) => {
    const path = f.filename.replace(/^\/+/, "");
    if (!isCatalogueFile(path)) return false;
    return !f.patch || touchesMoney(f.patch);
  });
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

/**
 * The full verdict. Since the price rule was retired this is path rules only —
 * kept as the callers' single entry point (rather than collapsing into
 * classifyChange) so a future diff-level rule has one place to come back to,
 * and so `changesPrices` labelling naturally rides alongside it.
 */
export function classifyPr(
  prFiles: { filename: string; patch?: string }[]
): ChangeVerdict {
  return classifyChange(prFiles.map((f) => f.filename));
}
