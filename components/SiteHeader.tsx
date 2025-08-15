// components/SiteHeader.tsx
import Link from "next/link";
import { useRouter } from "next/router";
import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSession, signIn, signOut } from "next-auth/react";

const Brand = () => (
  <Link href="/" className="select-none inline-flex items-center gap-2">
    {/* Wordmark with insta-like gradient text (matches your theme) */}
    <span className="text-2xl font-extrabold bg-gradient-to-r from-amber-400 via-pink-500 to-indigo-500 bg-clip-text text-transparent drop-shadow-sm">
      ReelMyDay
    </span>
  </Link>
);

type Item = { href: string; label: string; exact?: boolean };
const NAV_ITEMS: Item[] = [
  { href: "/studio", label: "Studio" },
  { href: "/renders", label: "Renders" },
  { href: "/pricing", label: "Pricing" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

function useActivePath() {
  const router = useRouter();
  return (href: string, exact?: boolean) =>
    exact ? router.pathname === href : router.pathname.startsWith(href);
}

function DesktopNav() {
  const isActive = useActivePath();
  return (
    <nav className="hidden md:flex items-center gap-4 ml-6">
      {NAV_ITEMS.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          className={[
            "px-3 py-2 rounded-xl transition-all",
            isActive(it.href, it.exact)
              ? "underline underline-offset-4 decoration-2"
              : "hover:bg-white/70 hover:shadow-sm"
          ].join(" ")}
        >
          {it.label}
        </Link>
      ))}
    </nav>
  );
}

function AuthButtons() {
  const { data: session, status } = useSession();
  const authed = !!session?.user?.email;

  if (status === "loading") {
    return (
      <div className="h-9 w-[96px] rounded-xl bg-black/5 animate-pulse" />
    );
  }

  return authed ? (
    <div className="flex items-center gap-2">
      <button
        onClick={() => signOut({ callbackUrl: "/" })}
        className="px-3 py-2 rounded-xl bg-pink-500 text-white hover:bg-pink-400 active:scale-[0.98] transition"
      >
        Sign out
      </button>
    </div>
  ) : (
    <div className="flex items-center gap-2">
      <button
        onClick={() => signIn()}
        className="px-3 py-2 rounded-xl bg-pink-500 text-white hover:bg-pink-400 active:scale-[0.98] transition"
      >
        Sign in
      </button>
    </div>
  );
}

export default function SiteHeader() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const isActive = useActivePath();
  const { data: session } = useSession();
  const authed = !!session?.user?.email;

  // Close the mobile menu on route change
  useEffect(() => {
    const close = () => setOpen(false);
    router.events.on("routeChangeStart", close);
    return () => router.events.off("routeChangeStart", close);
  }, [router.events]);

  const items = useMemo(() => NAV_ITEMS, []);

  return (
    <>
      <header className="sticky top-0 z-40">
        <div className="mx-auto max-w-6xl px-4 pt-4">
          <div className="card flex items-center justify-between px-4 py-3">
            <div className="flex items-center">
              <Brand />
              <DesktopNav />
            </div>
            <div className="hidden md:block">
              <AuthButtons />
            </div>
            {/* Mobile hamburger */}
            <button
              aria-label="Open menu"
              onClick={() => setOpen(true)}
              className="md:hidden inline-flex h-10 w-10 items-center justify-center rounded-xl hover:bg-black/5 transition"
            >
              {/* hamburger icon */}
              <svg width="22" height="22" viewBox="0 0 24 24">
                <path fill="currentColor" d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z"/>
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile menu (slide-in) */}
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            {/* Panel */}
            <motion.aside
              className="fixed bottom-0 left-0 right-0 z-50 mx-auto max-w-lg px-4 pb-6"
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 32 }}
            >
              <div className="rounded-2xl border border-black/10 bg-white/90 shadow-xl">
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="font-semibold">Menu</span>
                  <button
                    aria-label="Close menu"
                    onClick={() => setOpen(false)}
                    className="h-10 w-10 inline-flex items-center justify-center rounded-xl hover:bg-black/5"
                  >
                    {/* X icon */}
                    <svg width="20" height="20" viewBox="0 0 24 24">
                      <path fill="currentColor" d="m18.3 5.7-12.6 12.6 1.4 1.4 12.6-12.6zM6.1 5.7 4.7 7.1 17.3 19.7l1.4-1.4z"/>
                    </svg>
                  </button>
                </div>

                <nav className="px-2 pb-2">
                  {items.map((it) => (
                    <Link
                      key={it.href}
                      href={it.href}
                      className={[
                        "flex items-center justify-between rounded-xl px-3 py-3 transition",
                        isActive(it.href, it.exact)
                          ? "bg-white shadow-inner"
                          : "hover:bg-white"
                      ].join(" ")}
                      onClick={() => setOpen(false)}
                    >
                      <span className="text-[15px]">{it.label}</span>
                      {/* chevron */}
                      <svg width="18" height="18" viewBox="0 0 24 24" className="opacity-50">
                        <path fill="currentColor" d="M9 6l6 6-6 6"/>
                      </svg>
                    </Link>
                  ))}

                  <div className="h-px my-2 bg-black/10" />

                  {/* Auth row */}
                  {authed ? (
                    <button
                      onClick={() => { setOpen(false); signOut({ callbackUrl: "/" }); }}
                      className="w-full rounded-xl bg-pink-500 text-white px-3 py-3 font-medium hover:bg-pink-400 active:scale-[0.99] transition"
                    >
                      Sign out
                    </button>
                  ) : (
                    <button
                      onClick={() => { setOpen(false); signIn(); }}
                      className="w-full rounded-xl bg-pink-500 text-white px-3 py-3 font-medium hover:bg-pink-400 active:scale-[0.99] transition"
                    >
                      Sign in
                    </button>
                  )}
                </nav>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}