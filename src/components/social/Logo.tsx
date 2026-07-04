import Link from "next/link";

/**
 * Tilt logo. Renders the asset at /brand/tilt-logo.svg (a placeholder wordmark
 * until the real file is dropped in — see public/brand/README.md). Swap the
 * `src` here if you add a PNG instead.
 */
export function Logo({ height = 34 }: { height?: number }) {
  return (
    <Link href="/" aria-label="Tilt Hockey — home" style={{ display: "inline-flex" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/tilt-logo.svg"
        alt="Tilt Hockey"
        height={height}
        style={{ height, width: "auto", display: "block" }}
      />
    </Link>
  );
}
