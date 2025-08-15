import Link from "next/link";
export default function NotFound() {
  return (
    <main className="grid min-h-[70vh] place-items-center px-4">
      <div className="card w-full max-w-lg p-8 text-center">
        <h1 className="text-2xl font-bold">Page not found</h1>
        <p className="mt-2 text-black/70">The page you’re looking for doesn’t exist.</p>
        <div className="mt-4 flex justify-center gap-3">
          <Link href="/studio" className="rounded-xl bg-pink-500 text-white px-4 py-2 font-semibold hover:bg-pink-400">Go to Editor</Link>
          <Link href="/auth/signin" className="rounded-xl bg-white/80 border border-black/10 px-4 py-2">Sign in</Link>
        </div>
      </div>
    </main>
  );
}
