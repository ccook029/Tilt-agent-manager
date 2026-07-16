import Link from "next/link";

/**
 * Tilt logo — the real wordmark used across HQ (/images/tilt-logo.png),
 * inverted to white for dark backgrounds (matches the main header treatment).
 */
export function Logo({ height = 34 }: { height?: number }) {
  return (
    <Link href="/" aria-label="Tilt Hockey — home" style={{ display: "inline-flex" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/tilt-logo.png"
        alt="Tilt Hockey"
        height={height}
        style={{
          height,
          width: "auto",
          display: "block",
          filter: "invert(1) brightness(2)",
        }}
      />
    </Link>
  );
}
