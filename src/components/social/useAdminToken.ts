"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "tilt_admin_token";

/**
 * Persists the admin token in localStorage so the founder types it once and the
 * review/approve actions across pages reuse it. Not security — just convenience;
 * the real gate is ADMIN_TOKEN checked server-side.
 */
export function useAdminToken() {
  const [token, setTokenState] = useState("");

  useEffect(() => {
    try {
      setTokenState(window.localStorage.getItem(KEY) ?? "");
    } catch {
      /* localStorage unavailable — non-fatal */
    }
  }, []);

  const setToken = useCallback((t: string) => {
    setTokenState(t);
    try {
      window.localStorage.setItem(KEY, t);
    } catch {
      /* ignore */
    }
  }, []);

  return { token, setToken };
}
