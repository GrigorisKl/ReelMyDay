import type { AppProps } from "next/app";
import { SessionProvider, signOut, useSession } from "next-auth/react";
import { Toaster } from "react-hot-toast";
import { AnimatePresence, motion } from "framer-motion";
import "@/styles/globals.css";
import Link from "next/link";
import { useRouter } from "next/router";

export default function App({ Component, pageProps, router }: AppProps & any) {
  return (
    <SessionProvider session={pageProps?.session}>
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
  return (
    <header className="sticky top-0 z-40 border-b border-black/10 bg-white/50 backdrop-blur-xl">
      <div className="mx-auto max-w-6xl h-14 px-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/studio" className="ml-1 text-lg font-bold">
            <span className="bg-gradient-to-r from-pink-500 via-orange-400 to-yellow-300 bg-clip-text text-transparent">ReelMyDay</span>
          </Link>
          <nav className="ml-6 hidden md:flex items-center gap-4 text-sm">
            <NavLink href="/studio" label="Editor" current={router.pathname.startsWith("/studio")} />
            <NavLink href="/renders" label="Renders" current={router.pathname.startsWith("/renders")} />
            <NavLink href="/pricing" label="Pricing" current={router.pathname.startsWith("/pricing")} />
            <NavLink href="/privacy" label="Privacy Policy" current={router.pathname.startsWith("/privacy")} />
            <NavLink href="/terms" label="Terms of Service" current={router.pathname.startsWith("/terms")} />
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {session ? (
            <>
              <span className="hidden sm:inline text-sm">{session.user?.name || session.user?.email}</span>
              <GlowButton onClick={() => signOut({ callbackUrl: "/auth/signin", redirect: true })} variant="ghost">Sign out</GlowButton>
            </>
          ) : (
            <Link className="underline underline-offset-4" href="/auth/signin">Sign in</Link>
          )}
        </div>
      </div>
    </header>
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
