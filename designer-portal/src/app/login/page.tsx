"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, passcode }),
      });
      if (res.ok) {
        router.replace("/");
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Login failed — try again.");
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-tilt-black p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-4">
          <Image
            src="/brand/tilt-logo.png"
            alt="TILT"
            width={200}
            height={53}
            priority
            className="h-auto w-48"
          />
          <h1 className="font-display text-2xl font-bold uppercase tracking-wider text-white">
            Design Portal
          </h1>
        </div>

        <form
          onSubmit={submit}
          className="rounded-2xl border border-tilt-line bg-tilt-panel p-6 shadow-[0_0_60px_rgba(0,191,255,0.07)]"
        >
          <label
            htmlFor="email"
            className="mb-2 block text-sm font-medium text-neutral-300"
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            autoFocus
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mb-4 w-full rounded-lg border border-tilt-line bg-tilt-black px-3 py-2.5 text-base text-white placeholder-neutral-500 outline-none transition-colors duration-200 focus:border-tilt-cyan"
            placeholder="you@example.com"
          />
          <label
            htmlFor="passcode"
            className="mb-2 block text-sm font-medium text-neutral-300"
          >
            Password
          </label>
          <input
            id="passcode"
            type="password"
            autoComplete="current-password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            className="mb-4 w-full rounded-lg border border-tilt-line bg-tilt-black px-3 py-2.5 text-base text-white placeholder-neutral-500 outline-none transition-colors duration-200 focus:border-tilt-cyan"
            placeholder="Enter your password"
          />
          {error && (
            <p role="alert" className="mb-4 text-sm text-red-400">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || passcode.length === 0}
            className="w-full cursor-pointer rounded-lg bg-tilt-cyan px-4 py-2.5 font-display text-lg font-bold uppercase tracking-wider text-black transition-colors duration-200 hover:bg-[#33ccff] disabled:cursor-default disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Enter"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-neutral-500">
          Don&apos;t be a sheep.
        </p>
      </div>
    </main>
  );
}
