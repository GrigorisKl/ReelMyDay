import Link from "next/link";
import { useSession } from "next-auth/react";
import { useState } from "react";

export default function Pricing() {
  const { data: session } = useSession();
  const ownerEmail = "grigoriskleanthous@gmail.com";
  const isOwner = (session?.user?.email || "").toLowerCase() === ownerEmail.toLowerCase();
  const isPro = isOwner || ((session?.user as any)?.isPro === true);
  const email = (session?.user?.email || "").toLowerCase();
  const [loading, setLoading] = useState<"sub"|"manage" | null>(null);

  async function onSubscribe() {
    if (!email) return (window.location.href = "/auth/signin");
    setLoading("sub");
    try {
      const r = await fetch("/api/stripe/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const j = await r.json();
      if (j?.url) window.location.href = j.url;
      else alert(j?.error || "Could not start checkout.");
    } catch (e: any) {
      alert("Could not start checkout.");
    } finally {
      setLoading(null);
    }
  }

  async function onManage() {
    if (!email) return (window.location.href = "/auth/signin");
    setLoading("manage");
    try {
      const r = await fetch("/api/stripe/create-portal-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const j = await r.json();
      if (j?.url) window.location.href = j.url;
      else alert(j?.error || "Could not open billing portal.");
    } catch (e: any) {
      alert("Could not open billing portal.");
    } finally {
      setLoading(null);
    }
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
              {isOwner && (
                <span className="text-xs rounded-full bg-green-100 px-2 py-1 text-green-700">
                  You’re Pro (owner)
                </span>
              )}
            </div>
            <ul className="mt-3 space-y-2 text-sm">
              <li>• <strong>Unlimited exports</strong></li>
              <li>• Everything in Free</li>
              <li>• Per-user render history</li>
              <li>• Self-serve billing portal</li>
            </ul>

            <div className="mt-4">
              {isPro ? (
                <button
                  onClick={onManage}
                  disabled={loading === "manage"}
                  className="inline-flex items-center rounded-2xl bg-white/70 px-4 py-2 font-medium text-black border border-black/10 hover:bg-white/90 active:scale-[0.99]"
                >
                  {loading === "manage" ? "Opening…" : "Manage subscription"}
                </button>
              ) : (
                <button
                  onClick={onSubscribe}
                  disabled={loading === "sub"}
                  className="inline-flex items-center rounded-2xl bg-pink-500 px-4 py-2 font-medium text-white hover:bg-pink-400 active:scale-[0.99]"
                >
                  {loading === "sub" ? "Redirecting…" : "Subscribe"}
                </button>
              )}
              {!isPro && (
                <p className="mt-2 text-xs text-black/50">
                  Local build note: subscribing requires Stripe setup.
                </p>
              )}
            </div>
          </div>
        </div>
        <p className="mt-6 text-xs text-black/50">
          Need help with billing? <Link href="/privacy" className="underline underline-offset-4">Privacy</Link> • <Link href="/terms" className="underline underline-offset-4">Terms</Link>
        </p>
      </div>
    </section>
  );
}