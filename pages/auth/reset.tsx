import { useRouter } from "next/router";
import React, { useMemo, useState } from "react";

const STRONG_PW = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

export default function ResetPasswordPage() {
  const router = useRouter();
  const email = String(router.query.email || "");
  const token = String(router.query.token || "");

  const [pw, setPw] = useState("");
  const [cpw, setCpw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showCpw, setShowCpw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const pwOk = useMemo(() => STRONG_PW.test(pw), [pw]);
  const match = useMemo(() => pw === cpw && cpw.length > 0, [pw, cpw]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pwOk || !match) return;

    setErr("");
    setBusy(true);
    try {
      const r = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, token, password: pw, confirm: cpw }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        const code = j?.error || "unknown";
        const map: Record<string, string> = {
          missing_fields: "Please fill in both fields.",
          mismatch: "Passwords do not match.",
          weak_password: "Use at least 8 chars with upper, lower, and a number.",
          invalid_token: "This reset link is invalid.",
          expired_token: "This reset link has expired. Please request a new one.",
          user_not_found: "Account not found.",
          unknown: "Could not reset password.",
        };
        setErr(map[code] || "Could not reset password.");
        return;
      }
      router.replace("/auth/signin?reset=1");
    } catch {
      setErr("Could not reset password.");
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || !email || !token || !pwOk || !match;

  return (
    <section className="mt-8">
      <div className="card p-6 max-w-md mx-auto">
        <h1 className="text-2xl font-bold">Reset password</h1>

        <form className="mt-4 grid gap-3" onSubmit={onSubmit}>
          {/* New password */}
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              className="w-full rounded-xl border px-3 py-2 pr-10"
              placeholder="New password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              aria-invalid={!pwOk && pw.length > 0}
              required
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 opacity-70 hover:opacity-100"
              aria-label={showPw ? "Hide password" : "Show password"}
            >
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M12 6c5 0 9 3.5 10.5 6c-1 1.8-4.7 6-10.5 6S3 13.8 1.5 12C3 9.5 7 6 12 6m0 2c-3.7 0-6.7 2.3-8.1 4c1.1 1.3 4 4 8.1 4s7.1-2.7 8.1-4c-1.2-1.6-4.3-4-8.1-4m0 1.5A3.5 3.5 0 1 1 8.5 13A3.5 3.5 0 0 1 12 9.5Z"
                />
              </svg>
            </button>
            <p
              className={`mt-1 text-xs ${
                pw.length === 0 ? "text-black/50" : pwOk ? "text-green-600" : "text-red-600"
              }`}
            >
              Must be at least 8 characters and include upper, lower, and a number.
            </p>
          </div>

          {/* Confirm password */}
          <div className="relative">
            <input
              type={showCpw ? "text" : "password"}
              className="w-full rounded-xl border px-3 py-2 pr-10"
              placeholder="Confirm password"
              value={cpw}
              onChange={(e) => setCpw(e.target.value)}
              aria-invalid={!match && cpw.length > 0}
              required
            />
            <button
              type="button"
              onClick={() => setShowCpw((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 opacity-70 hover:opacity-100"
              aria-label={showCpw ? "Hide confirm password" : "Show confirm password"}
            >
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M12 6c5 0 9 3.5 10.5 6c-1 1.8-4.7 6-10.5 6S3 13.8 1.5 12C3 9.5 7 6 12 6m0 2c-3.7 0-6.7 2.3-8.1 4c1.1 1.3 4 4 8.1 4s7.1-2.7 8.1-4c-1.2-1.6-4.3-4-8.1-4m0 1.5A3.5 3.5 0 1 1 8.5 13A3.5 3.5 0 0 1 12 9.5Z"
                />
              </svg>
            </button>
            {!match && cpw.length > 0 && (
              <p className="mt-1 text-xs text-red-600">Passwords do not match.</p>
            )}
          </div>

          {err && <p className="text-sm text-red-600">{err}</p>}

          <button
            type="submit"
            disabled={disabled}
            className="rounded-2xl bg-pink-500 px-4 py-2 font-medium text-white hover:bg-pink-400 disabled:opacity-50"
          >
            {busy ? "Changing..." : "Change password"}
          </button>
        </form>
      </div>
    </section>
  );
}