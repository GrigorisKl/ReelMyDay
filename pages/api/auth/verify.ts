import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../lib/prisma";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = String(req.query.token || req.body?.token || "");
  const email = String(req.query.email || req.body?.email || "").toLowerCase().trim();
  if (!token || !email) return res.status(400).json({ ok: false, error: "missing" });

  const rec = await prisma.verificationToken.findUnique({ where: { token } });
  if (!rec || rec.identifier !== `verify:${email}`) {
    return res.status(400).json({ ok: false, error: "invalid_token" });
  }
  if (new Date(rec.expires).getTime() < Date.now()) {
    await prisma.verificationToken.delete({ where: { token } });
    return res.status(400).json({ ok: false, error: "expired_token" });
  }

  await prisma.user.update({
    where: { email },
    data: { emailVerified: new Date() },
  });
  await prisma.verificationToken.delete({ where: { token } });

  // Redirect to sign-in with a success flag, or just JSON OK
  if (req.method === "GET") {
    const base = process.env.APP_BASE_URL || "http://localhost:3000";
    return res.redirect(302, `${base}/auth/signin?verified=1`);
  }
  return res.json({ ok: true });
}