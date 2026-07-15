"use client";

// ---------------------------------------------------------------------------
// OwnerNav — a single header link to the Strategy area, shown only to the
// accounting owner (Chris). Renders nothing for everyone else.
// ---------------------------------------------------------------------------
import { useEffect, useState } from "react";
import Link from "next/link";

export default function OwnerNav() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    fetch("/api/os/me")
      .then((r) => r.json())
      .then((d) => setShow(Boolean(d.isAccountingOwner)))
      .catch(() => {});
  }, []);

  if (!show) return null;

  return (
    <>
      <Link
        href="/review"
        className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
      >
        Review
      </Link>
      <Link
        href="/publish"
        className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
      >
        Publish
      </Link>
      <Link
        href="/org"
        className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
      >
        Org
      </Link>
      <Link
        href="/strategy"
        className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
      >
        Strategy
      </Link>
    </>
  );
}
