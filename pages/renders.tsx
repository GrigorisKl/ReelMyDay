// pages/renders.tsx
import fs from "fs";
import path from "path";
import type { GetServerSideProps, GetServerSidePropsContext } from "next";
import Link from "next/link";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "./api/auth/[...nextauth]";

type RenderItem = { url: string; createdAt: string; itemsCount: number };

// Discriminated union for props
type SignedOutProps = { signedOut: true };
type SignedInProps  = { signedOut: false; items: RenderItem[] };
type Props = SignedOutProps | SignedInProps;

// Type guard to narrow to the signed-in branch
function hasItems(p: Props): p is SignedInProps {
  return p.signedOut === false && Array.isArray((p as any).items);
}

export default function Renders(props: Props) {
  if (!hasItems(props)) {
    // Signed-out UI
    return (
      <section className="mt-8">
        <div className="card p-6">
          <h1 className="text-2xl font-bold">Your Reels</h1>
          <p className="mt-2 text-black/70">Please sign in to view your private reels.</p>
          <div className="mt-4">
            <Link
              href="/api/auth/signin"
              className="inline-block rounded-2xl bg-pink-500 text-white px-4 py-2 font-medium hover:bg-pink-400"
            >
              Sign in
            </Link>
          </div>
        </div>
      </section>
    );
  }

  // From here on, TS knows props has `items`
  const files = props.items;

  return (
    <section className="mt-8">
      <div className="card p-6">
        <h1 className="text-2xl font-bold">Your Reels</h1>
        {files.length === 0 ? (
          <p className="mt-2 text-black/70">No reels yet. Create one in the Studio.</p>
        ) : (
          <ul className="mt-4 grid gap-3">
            {files.map((f) => (
              <li key={f.url} className="rounded-xl bg-white/70 border border-black/10 p-3">
                <video src={f.url} className="w-full h-64 object-cover rounded-lg" controls />
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-xs text-black/60">
                    {new Date(f.createdAt).toLocaleString()} • {f.itemsCount} items
                  </p>
                  <div className="flex gap-2">
                    <a className="underline underline-offset-4" href={f.url} download>
                      Download
                    </a>
                    <Link className="underline underline-offset-4" href={f.url} target="_blank">
                      Open
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = async (
  ctx: GetServerSidePropsContext
) => {
  const session = (await getServerSession(ctx.req, ctx.res, authOptions as any)) as Session | null;
  const email = session?.user?.email || null;

  if (!email) {
    return { props: { signedOut: true } };
  }

  const dataPath = path.join(process.cwd(), "data", "renders.json");
  let items: RenderItem[] = [];
  try {
    if (fs.existsSync(dataPath)) {
      const all = JSON.parse(fs.readFileSync(dataPath, "utf8") || "[]") as any[];
      items = all
        .filter((r) => String(r.email).toLowerCase() === email.toLowerCase())
        .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
    }
  } catch {
    // ignore parse/IO errors — fall back to empty list
  }

  return { props: { signedOut: false, items } };
};