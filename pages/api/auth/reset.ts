import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "node:crypto";
import { prisma } from "../../../lib/prisma";
import { sendMailSafe } from "../../../lib/mailer";

const RESET_TTL_MIN = 60; // token valid for 60 minutes

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const { email } = (req.body || {}) as { email?: string };
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return res.status(400).json({ ok: false, error: "missing_email" });

  // Check user exists (don’t leak in response)
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user) return res.json({ ok: true });

  // Invalidate old tokens
  await prisma.passwordResetToken.deleteMany({ where: { email: normalized } });

  // Create a new token (store hash; send raw)
  const raw = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
  const expires = new Date(Date.now() + RESET_TTL_MIN * 60 * 1000);

  await prisma.passwordResetToken.create({
    data: { email: normalized, tokenHash, expires },
  });

  const base = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const resetUrl = `${base}/reset?token=${encodeURIComponent(raw)}&email=${encodeURIComponent(normalized)}`;

  await sendMailSafe({
    to: normalized,
    subject: "Reset your ReelMyDay password",
    html: `<p>We received a request to reset your password.</p>
           <p><a href="${resetUrl}">Click here to set a new password</a> (valid for ${RESET_TTL_MIN} minutes).</p>
           <p>If you didn’t request this, you can ignore this email.</p>`,
    text: `Reset your password: ${resetUrl}`,
  });

  return res.json({ ok: true });
}