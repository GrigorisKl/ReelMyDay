// pages/pricing.tsx
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import React, { useEffect, useState } from "react";

export default function Pricing() {
  const { data: session } = useSession();
  const router = useRouter();

  const ownerEmail = "grigoriskleanthous@gmail.com";
  const userEmail = (session?.user?.email || "").toLowerCase();
  const isOwner = userEmail === ownerEmail.toLowerCase();

  const [isProLocal, setIsProLocal] = useState<boolean>(isOwner || Boolean((session as any)?.user?.isPro));

  // helper: ask server to sync Pro status by email (works even if session_id confirm fails)
  async function refreshStatus(email: string) {
    if (!email) return;
    try {
      const r = await fetch("/api/stripe/refresh-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const j = await r.json();
      if (j?.ok) setIsProLocal(Boolean(j.isPro));
    } catch {}
  }

  // Confirm checkout via session_id; if it fails, fall back to refresh-status
  useEffect(() => {
    const sid = typeof router.query.session_id === "string" ? router.query.session_id : "";
    const ok = router.query.status === "success" && sid;
    if (!ok) return;

    (async () => {
      try {
        const r = await fetch("/api/stripe/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sid }),
        });
        const j = await r.json().catch(() => ({}));
        if (j?.ok) {
          setIsProLocal(true);
        } else {
          await refreshStatus(userEmail);
        }
      } finally {
        // clean URL so we don’t re-run on refresh
        router.replace("/pricing", undefined, { shallow: true });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.query.session_id, router.query.status]);

  // Also, when a signed-in non-Pro user lands here, try to sync from Stripe once
  useEffect(() => {
    if (userEmail && !isProLocal) refreshStatus(userEmail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail]);

  async function onSubscribe(email: string) {
    if (!email) { router.push("/auth/signin?next=/pricing"); return; }
    try {
      const r = await fetch("/api/stripe/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const j = await r.json();
      if (j?.url) window.location.href = j.url;
      else alert("Could not start checkout.");
    } catch { alert("Could not start checkout."); }
  }

  async function onManage(email: string) {
    if (!email) { router.push("/auth/signin?next=/pricing"); return; }
    try {
      const r = await fetch("/api/stripe/create-portal-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const j = await r.json();
      if (j?.url) window.location.href = j.url;
      else alert("Could not open billing portal: " + (j?.error || "unknown"));
    } catch { alert("Could not open billing portal."); }
  }

  return (
    <section className="mt-8">
      <div className="card p-6">
        <h1 className="text-3xl font-bold">Pricing</h1>
        <p className="mt-1 text-black/70">
          First export is free. Then <strong>$5/month</strong> for unlimited reels.
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {/* Free */}
          <div className="rounded-2xl border border-black/10 bg-white/70 p-5">
            <h3 className="text-xl font-semibold">Free</h3>
            <ul className="mt-3 space-y-2 text-sm">
              <li>• Full editor access (no watermark)</li>
              <li>• Smooth Ken-Burns on photos (no stretch) + blurred background fill</li>
              <li>• Mix photos & videos</li>
              <li>• Keep original video audio <em>or</em> upload your own MP3</li>
              <li>• 1080×1920 vertical output</li>
              <li>• <strong>1 export total</strong> (sign-in required at export)</li>
            </ul>
          </div>

          {/* Pro */}
          <div className="rounded-2xl border border-pink-300 bg-pink-50 p-5 shadow-[0_0_0_3px_rgba(236,72,153,0.1)]">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold">Pro – $5/mo</h3>
              {isProLocal && (
                <span className="text-xs rounded-full bg-green-100 px-2 py-1 text-green-700">
                  You’re Pro
                </span>
              )}
            </div>
            <ul className="mt-3 space-y-2 text-sm">
              <li>• <strong>Unlimited exports</strong></li>
              <li>• Everything in Free</li>
              <li>• Per-user render history</li>
              <li>• Future: Stripe billing & self-serve cancel (coming soon)</li>
            </ul>

            <div className="mt-4">
              {!isProLocal ? (
                <button
                  onClick={() => onSubscribe(userEmail)}
                  className="inline-flex items-center rounded-2xl bg-pink-500 px-4 py-2 font-medium text-white hover:bg-pink-400 active:scale-[0.99]"
                >
                  Subscribe
                </button>
              ) : (
                <button
                  onClick={() => onManage(userEmail)}
                  className="inline-flex items-center rounded-2xl bg-pink-500 px-4 py-2 font-medium text-white hover:bg-pink-400 active:scale-[0.99]"
                >
                  Manage subscription
                </button>
              )}
              <p className="mt-2 text-xs text-black/50">Local build note: subscribing requires Stripe setup.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}