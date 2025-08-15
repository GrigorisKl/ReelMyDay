import { useState } from "react";
import Link from "next/link";

export default function Forgot() {
  const [email, setEmail] = useState("");
  const [ok, setOk] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/auth/request-reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    setOk(true); // Always show success (don’t leak whether the email exists)
  }

  return (
    <main className="min-h-[70vh] grid place-items-center px-4">
      <div className="card w-full max-w-md p-6">
        <h1 className="text-2xl font-semibold">Forgot password</h1>
        {ok ? (
          <p className="mt-2 text-sm">If that email exists, we sent a reset link.</p>
        ) : (
          <form onSubmit={submit} className="mt-4 grid gap-2">
            <input value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="Your email" className="rounded-xl bg-white/70 border border-black/10 px-3 py-2 text-sm" />
            <button className="rounded-2xl bg-pink-500 text-white px-4 py-2 font-medium hover:bg-pink-400">Send reset link</button>
          </form>
        )}
        <p className="mt-4 text-xs"><Link href="/auth/signin" className="underline">Back to sign in</Link></p>
      </div>
    </main>
  );
}