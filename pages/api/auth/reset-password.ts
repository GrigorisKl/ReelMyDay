import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../../../lib/prisma";

const STRONG_PW = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const { email, token, password, confirm } = (req.body || {}) as {
    email?: string; token?: string; password?: string; confirm?: string;
  };

  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized || !token || !password || !confirm) {
    return res.status(400).json({ ok: false, error: "missing_fields" });
  }
  if (password !== confirm) {
    return res.status(400).json({ ok: false, error: "mismatch" });
  }
  if (!STRONG_PW.test(password)) {
    return res.status(400).json({ ok: false, error: "weak_password" });
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  let rec = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!rec) rec = await prisma.passwordResetToken.findUnique({ where: { tokenHash: token } });
  if (!rec || rec.email.toLowerCase() !== normalized) {
    return res.status(400).json({ ok: false, error: "invalid_token" });
  }
  if (new Date(rec.expires).getTime() < Date.now()) {
    await prisma.passwordResetToken.delete({ where: { tokenHash: rec.tokenHash } });
    return res.status(400).json({ ok: false, error: "expired_token" });
  }

  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user) {
    await prisma.passwordResetToken.delete({ where: { tokenHash: rec.tokenHash } });
    return res.status(404).json({ ok: false, error: "user_not_found" });
  }

  const hash = await bcrypt.hash(password, 12);
  await prisma.user.update({ where: { email: normalized }, data: { passwordHash: hash } });
  await prisma.session.deleteMany({ where: { userId: user.id } });
  await prisma.passwordResetToken.delete({ where: { tokenHash: rec.tokenHash } });

  return res.json({ ok: true });
}