"use client";

// ---------------------------------------------------------------------------
// /login — the Tilt OS front door for staff (docs/OS_LOGIN_DESIGN.md).
// Email + password go to /api/os/login (which proxies to the tiltweb staff
// directory when configured, or accepts the shared passcode fallback).
// ---------------------------------------------------------------------------
import { Suspense, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    params.get("error") === "sso" ? "Sign-in link expired — log in below." : null
  );
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/os/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Sign-in failed.");
        return;
      }
      const next = params.get("next");
      router.push(next && next.startsWith("/") ? next : "/dashboard");
      router.refresh();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <div className="w-full max-w-sm rounded-2xl border border-gray-800/80 bg-[#101010]/90 backdrop-blur p-8">
        <div className="flex flex-col items-center gap-3 mb-8">
          <Image
            src="/images/tilt-shield.png"
            alt="Tilt"
            width={64}
            height={77}
            priority
          />
          <h1 className="font-semibold text-xl tracking-wide">
            Tilt <span className="text-[#00d6ff]">OS</span>
          </h1>
          <p className="text-sm text-gray-500 text-center">
            Staff sign-in — one login for HQ, the Design Studio, and every
            Tilt tool.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@tilthockey.com"
              autoComplete="email"
              className="w-full rounded-lg bg-[#0a0a0a] border border-gray-800 px-3 py-2 text-sm focus:border-[#00d6ff] focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-gray-600">
              Leave blank to use the shared staff passcode.
            </p>
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="w-full rounded-lg bg-[#0a0a0a] border border-gray-800 px-3 py-2 text-sm focus:border-[#00d6ff] focus:outline-none"
            />
          </div>

          {error && (
            <p className="text-sm text-red-400 border border-red-900/60 bg-red-950/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-[#00d6ff] text-black font-semibold py-2 text-sm hover:bg-[#33e0ff] transition-colors disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
