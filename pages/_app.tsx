import type { AppProps } from "next/app";
import { SessionProvider, signOut, useSession } from "next-auth/react";
import { Toaster } from "react-hot-toast";
import { AnimatePresence, motion } from "framer-motion";
import "@/styles/globals.css";
import Link from "next/link";
import { useRouter } from "next/router";
import { useState, useEffect } from "react";
import Head from "next/head";

export default function App({ Component, pageProps, router }: AppProps & any) {
  return (
    <SessionProvider session={pageProps?.session}>
      <Head>
        {/* SVG first (modern browsers) */}
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        {/* Fallbacks if you generated PNG/ICO */}
        <link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/icons/icon-16.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/icons/icon-180.png" />
        <link rel="manifest" href="/site.webmanifest" />{/* optional */}
        <meta name="theme-color" content="#ec4899" />
      </Head>      
      <div className="min-h-screen">
        <TopNav />
        <main className="mx-auto max-w-6xl px-4 pb-16">
          <AnimatePresence mode="wait">
            <motion.div
              key={router.route}
              initial={{ opacity: 0, y: 10, scale: 0.995 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.995 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="pt-6"
            >
              <Component {...pageProps} />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <Toaster position="top-center" />
    </SessionProvider>
  );
}

function TopNav() {
  const router = useRouter();
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);

  // Close mobile sheet on route change
  useEffect(() => {
    const close = () => setOpen(false);
    router.events.on("routeChangeStart", close);
    return () => router.events.off("routeChangeStart", close);
  }, [router.events]);

  const nav = [
    { href: "/studio",  label: "Editor"  },
    { href: "/renders", label: "Renders" },
    { href: "/pricing", label: "Pricing" },
    { href: "/privacy", label: "Privacy Policy" },
    { href: "/terms",   label: "Terms of Service" },
  ];

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-black/10 bg-white/50 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl h-14 px-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href="/studio" className="ml-1 text-lg font-bold">
              <span className="bg-gradient-to-r from-pink-500 via-orange-400 to-yellow-300 bg-clip-text text-transparent">
                ReelMyDay
              </span>
            </Link>

            {/* Desktop nav (>=768px) */}
            <nav className="ml-6 hidden md:flex items-center gap-4 text-sm">
              <NavLink href="/studio"  label="Editor"          current={router.pathname.startsWith("/studio")} />
              <NavLink href="/renders" label="Renders"         current={router.pathname.startsWith("/renders")} />
              <NavLink href="/pricing" label="Pricing"         current={router.pathname.startsWith("/pricing")} />
              <NavLink href="/privacy" label="Privacy Policy"  current={router.pathname.startsWith("/privacy")} />
              <NavLink href="/terms"   label="Terms of Service" current={router.pathname.startsWith("/terms")} />
            </nav>
          </div>

          {/* Desktop auth */}
          <div className="hidden md:flex items-center gap-3">
            {session ? (
              <>
                <span className="hidden sm:inline text-sm">{session.user?.name || session.user?.email}</span>
                <GlowButton
                  onClick={() => signOut({ callbackUrl: "/auth/signin", redirect: true })}
                  variant="ghost"
                >
                  Sign out
                </GlowButton>
              </>
            ) : (
              <Link className="underline underline-offset-4" href="/auth/signin">Sign in</Link>
            )}
          </div>

          {/* Mobile hamburger (below ~800px) */}
          <button
            aria-label="Open menu"
            onClick={() => setOpen(true)}
            className="
              md:hidden
              max-[799px]:inline-flex
              h-10 w-10 items-center justify-center rounded-xl
              hover:bg-black/5 transition
            "
          >
            <svg width="22" height="22" viewBox="0 0 24 24">
              <path fill="currentColor" d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z"/>
            </svg>
          </button>
        </div>
      </header>

      {/* Mobile sheet */}
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />

            {/* Bottom sheet */}
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
                    <svg width="20" height="20" viewBox="0 0 24 24">
                      <path fill="currentColor" d="m18.3 5.7-12.6 12.6 1.4 1.4 12.6-12.6zM6.1 5.7 4.7 7.1 17.3 19.7l1.4-1.4z"/>
                    </svg>
                  </button>
                </div>

                <nav className="px-2 pb-2">
                  {nav.map((it) => {
                    const active = router.pathname.startsWith(it.href);
                    return (
                      <Link
                        key={it.href}
                        href={it.href}
                        className={[
                          "flex items-center justify-between rounded-xl px-3 py-3 transition",
                          active ? "bg-white shadow-inner" : "hover:bg-white"
                        ].join(" ")}
                        onClick={() => setOpen(false)}
                      >
                        <span className="text-[15px]">{it.label}</span>
                        <svg width="18" height="18" viewBox="0 0 24 24" className="opacity-50">
                          <path fill="currentColor" d="M9 6l6 6-6 6"/>
                        </svg>
                      </Link>
                    );
                  })}

                  <div className="h-px my-2 bg-black/10" />

                  {session ? (
                    <button
                      onClick={() => { setOpen(false); signOut({ callbackUrl: "/auth/signin", redirect: true }); }}
                      className="w-full rounded-xl bg-pink-500 text-white px-3 py-3 font-medium hover:bg-pink-400 active:scale-[0.99] transition"
                    >
                      Sign out
                    </button>
                  ) : (
                    <Link
                      href="/auth/signin"
                      onClick={() => setOpen(false)}
                      className="block w-full text-center rounded-xl bg-pink-500 text-white px-3 py-3 font-medium hover:bg-pink-400 active:scale-[0.99] transition"
                    >
                      Sign in
                    </Link>
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

function NavLink({ href, label, current }: { href: string; label: string; current: boolean }) {
  return (
    <Link
      href={href}
      className={"relative px-2 py-1 rounded-md " + (current ? "text-black after:absolute after:inset-x-0 after:-bottom-1 after:h-0.5 after:bg-pink-500" : "text-black/70 hover:text-black")}
    >
      {label}
    </Link>
  );
}

function GlowButton({ children, onClick, type = "button", variant = "primary", disabled }:{ children: React.ReactNode; onClick?: ()=>void; type?: "button"|"submit"|"reset"; variant?: "primary"|"ghost"; disabled?: boolean }) {
  const base = "inline-flex items-center justify-center rounded-2xl px-4 py-2 text-sm font-semibold transition focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed";
  const styles = variant === "primary" ? "bg-pink-500 text-white hover:bg-pink-400 active:bg-pink-300 shadow-glowPink" : "bg-white/70 text-black hover:bg-white/90 border border-black/10";
  return (
    <motion.button type={type} onClick={onClick} disabled={disabled} className={base + " " + styles} whileHover={{ y: -1, scale: 1.01 }} whileTap={{ scale: 0.99 }} transition={{ type: "spring", stiffness: 400, damping: 26 }}>
      {children}
    </motion.button>
  );
}
