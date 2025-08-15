import { getProviders, signIn } from "next-auth/react";
import type { GetServerSideProps } from "next";
import { useState } from "react";
import Link from "next/link";

type ProvidersMap = Record<string, { id: string; name: string }>;

export default function SignIn({ providers }: { providers: ProvidersMap }) {
  const hasGoogle = !!providers?.google;
  const hasCredentials = !!providers?.credentials;

  const [email, setEmail] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function doSignin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const result = await signIn("credentials", { email, password, redirect: false, callbackUrl: "/studio" });
    setBusy(false);
    if (result?.error) {
      if (result.error === "EmailNotVerified") setMsg("Please verify your email. We sent you a link.");
      else if (result.error === "InvalidCredentials") setMsg("Invalid email or password.");
      else setMsg("Sign-in failed. Try again.");
      return;
    }
    window.location.href = "/studio";
  }

  return (
    <main className="min-h-[70vh] grid place-items-center px-4">
      <div className="card w-full max-w-md p-6">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="mt-2 text-sm text-black/70">
          New here? <Link href="/auth/signup" className="underline">Create an account</Link>
        </p>

        <div className="mt-6 grid gap-3">
          {hasGoogle ? (
            <button onClick={() => signIn("google", { callbackUrl: "/studio" })} className="rounded-2xl bg-white text-black px-4 py-2 font-medium border border-black/10 hover:bg-white/90">
              Continue with Google
            </button>
          ) : (
            <button disabled className="rounded-2xl bg-white/60 text-black/60 px-4 py-2 font-medium border border-black/10">
              Continue with Google (not configured)
            </button>
          )}

          {hasCredentials && (
            <form className="grid gap-2" onSubmit={doSignin}>
              <input value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="Email" className="rounded-xl bg-white/70 border border-black/10 px-3 py-2 text-sm" />
              <div className="relative">
                <input type={showPw ? "text" : "password"} value={password} onChange={(e)=>setPassword(e.target.value)} placeholder="Password" className="w-full rounded-xl bg-white/70 border border-black/10 px-3 py-2 text-sm pr-10" />
                <button type="button" onClick={()=>setShowPw(v=>!v)} className="absolute right-2 top-1/2 -translate-y-1/2 opacity-70 hover:opacity-100">
                  {/* SVG eye icon (modern, crisp) */}
                  {showPw ? (
                    <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M12 6c5 0 9 3.5 10.5 6c-1 1.8-4.7 6-10.5 6S3 13.8 1.5 12C3 9.5 7 6 12 6m0 2c-3.7 0-6.7 2.3-8.1 4c1.1 1.3 4 4 8.1 4s7.1-2.7 8.1-4c-1.2-1.6-4.3-4-8.1-4m0 1.5A3.5 3.5 0 1 1 8.5 13A3.5 3.5 0 0 1 12 9.5Z"/></svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M2.1 3.51L3.5 2.1L21.9 20.5L20.5 21.9L17.6 19C16 19.64 14.1 20 12 20C6.2 20 2.5 15.8 1.5 14C1.95 13.22 3.03 11.84 4.62 10.65L2.1 3.51M8.46 9.37L9.9 12.8L13.34 14.24L8.46 9.37M12 6C17.8 6 21.5 10.2 22.5 12C22.2 12.51 21.55 13.37 20.6 14.33L19.16 12.9C19.8 12.33 20.32 11.73 20.7 11.2C19.58 9.93 16.63 8 12 8c-.56 0-1.1.03-1.62.09L9.2 6.9C10.1 6.62 11.05 6.46 12 6Z"/></svg>
                  )}
                </button>
              </div>

              {msg && <p className="text-xs text-red-600">{msg}</p>}
              <button type="submit" disabled={busy} className="mt-1 rounded-2xl bg-pink-500 text-white px-4 py-2 font-medium hover:bg-pink-400">
                Sign in
              </button>
            </form>
          )}
        </div>

        <p className="mt-4 text-xs text-black/70">
          <Link href="/auth/forgot" className="underline">Forgot password?</Link>
        </p>
      </div>
    </main>
  );
}

export const getServerSideProps: GetServerSideProps = async () => {
  const { getProviders } = await import("next-auth/react");
  const providers = (await getProviders()) || {};
  return { props: { providers } };
};