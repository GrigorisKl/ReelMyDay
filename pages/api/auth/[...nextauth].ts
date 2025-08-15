import NextAuth, { type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "../../../lib/prisma";

const providers: NextAuthOptions["providers"] = [];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
    })
  );
}

providers.push(
  Credentials({
    name: "Email",
    credentials: { email: { label: "Email" }, password: { label: "Password", type: "password" } },
      async authorize(credentials) {
        const email = String(credentials?.email || "").toLowerCase().trim();
        const password = String(credentials?.password || "");
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.passwordHash) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        // Optional: require verification
        if (!user.emailVerified) {
          throw new Error("Email not verified");
        }

        return { id: user.id, name: user.name || "", email: user.email, image: user.image || null };
      },
  })
);

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  secret: process.env.NEXTAUTH_SECRET || "devsecret-local-please-change",
  session: { strategy: "jwt" },
  providers,
  pages: { signIn: "/auth/signin" },
  callbacks: {
    async jwt({ token, user }) { if (user) token.userId = (user as any).id ?? token.sub; return token; },
    async session({ session, token }) { if (token?.userId) (session as any).userId = token.userId; return session; },
  },
};

export default NextAuth(authOptions);