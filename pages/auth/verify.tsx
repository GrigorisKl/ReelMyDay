import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";

export default function Verify() {
  const r = useRouter();
  const { token, email } = r.query;
  const [msg, setMsg] = useState("Verifying…");

  useEffect(() => {
    async function go() {
      if (!token || !email) return;
      const res = await fetch("/api/auth/verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email }),
      });
      if (res.ok) setMsg("Email verified! You can sign in now.");
      else setMsg("Verification failed or expired.");
    }
    go();
  }, [token, email]);

  return (
    <main className="min-h-[70vh] grid place-items-center">
      <div className="card p-6 w-full max-w-md text-center">
        <p>{msg}</p>
        <div className="mt-3"><Link className="underline" href="/auth/signin">Go to sign in</Link></div>
      </div>
    </main>
  );
}