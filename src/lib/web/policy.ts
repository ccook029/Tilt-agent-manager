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

/**
 * Does this diff touch money?
 *
 * Nova may edit the catalogue's words but not its numbers. Prices in
 * products.ts take three shapes — `price: 135.0`, `comparePrice: 199`, and
 * `priceModifiers`, a NESTED map whose inner lines (`"70\"": 10`) don't contain
 * the word "price" at all — so keyword matching alone would wave the nested
 * ones straight through.
 *
 * The rule is therefore structural and deliberately blunt: in a catalogue file,
 * a changed line may not mention price, and may not add or remove a bare
 * numeric value. Copy, names, badges, colour names, image paths and true/false
 * flags are all strings or booleans, so they pass; anything numeric stops.
 *
 * It over-blocks a little — a genuine "6 colorways" copy edit lands on Chris —
 * and that's the right direction to be wrong in. A held PR costs one click; a
 * wrong price is a real transaction at the wrong number.
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

/** Catalogue files where the money rule applies. */
function isCatalogueFile(path: string): boolean {
  return /^src\/data\/.+\.ts$/.test(path);
}

/**
 * Is this diff the removal of one whole product, and nothing else?
 *
 * Deleting a discontinued product necessarily deletes its price lines, which
 * tripped the money rule and held every removal for a founder — but a removal
 * can't charge anyone a wrong amount, because there's nothing left to buy.
 * Chris's call: whole-product removals ship themselves.
 *
 * The shape is checked strictly, because "deletions with numbers in them" is
 * NOT safe in general — deleting a single priceModifiers line while leaving
 * its option in place silently changes what the customer pays. So all three
 * must hold:
 *   1. the diff ADDS nothing (a changed number is a delete+add pair);
 *   2. the deletions are ONE contiguous block (a product is one object;
 *      a second deletion elsewhere is a second change);
 *   3. that block contains a product identity line (id: "…"), i.e. an entire
 *      catalogue entry left, not lines plucked from inside one.
 * Anything that fails a condition falls back to the money rule and holds.
 */
export function isWholeProductRemoval(patch: string): boolean {
  let deletionRuns = 0;
  let inRun = false;
  let sawId = false;

  for (const line of patch.split("\n")) {
    if (/^(\+\+\+|---)/.test(line)) continue; // file headers, not changes
    if (line.startsWith("+")) return false; // condition 1
    if (line.startsWith("-")) {
      if (!inRun) {
        inRun = true;
        deletionRuns++;
      }
      if (/^\s*id:\s*["']/.test(line.slice(1))) sawId = true;
    } else {
      inRun = false; // context line or hunk header ends the run
    }
  }
  return deletionRuns === 1 && sawId; // conditions 2 and 3
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
 * The full verdict, over paths AND diffs. This is what the merge endpoint uses:
 * a path can be allowed while its diff still moves a price, and only the diff
 * can tell you that.
 *
 * A file with no patch (binary, or too large for GitHub to inline) is treated
 * as unreadable rather than harmless — an image is fine, but an unreadable
 * catalogue file is held.
 */
export function classifyPr(
  prFiles: { filename: string; patch?: string }[]
): ChangeVerdict {
  const byPath = classifyChange(prFiles.map((f) => f.filename));
  if (!byPath.autoMergeable) return byPath;

  for (const file of prFiles) {
    const path = file.filename.replace(/^\/+/, "");
    if (!isCatalogueFile(path)) continue;

    if (!file.patch) {
      return {
        autoMergeable: false,
        files: byPath.files,
        reason: `${path}'s diff couldn't be read, so it wasn't cleared for auto-merge`,
      };
    }
    if (touchesMoney(file.patch) && !isWholeProductRemoval(file.patch)) {
      return {
        autoMergeable: false,
        files: byPath.files,
        reason: `${path} changes a price or another number — prices always need a founder`,
      };
    }
  }
  return { autoMergeable: true, files: byPath.files };
}
