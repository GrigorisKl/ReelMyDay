import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "node:crypto";
import { prisma } from "../../../lib/prisma";
import { sendMail } from "../../../lib/mailer";

const APP_BASE_URL = process.env.APP_BASE_URL || "http://localhost:3000";
const RESET_TTL_MIN = 60;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const { email } = (req.body || {}) as { email?: string };
  const e = (email || "").toString().trim().toLowerCase();
  if (!e) return res.status(400).json({ ok: false, error: "missing_email" });

  const user = await prisma.user.findUnique({ where: { email: e } });
  // Always return OK to avoid email enumeration
  if (!user) return res.json({ ok: true });

  // wipe previous tokens for this email
  await prisma.passwordResetToken.deleteMany({ where: { email: e } });

  // create token (store hash if you prefer; using plain token here)
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + RESET_TTL_MIN * 60 * 1000);
  await prisma.passwordResetToken.create({
    data: { email: e, tokenHash: crypto.createHash("sha256").update(token).digest("hex"), expires },
  });

  const link = `${APP_BASE_URL}/auth/reset?token=${encodeURIComponent(token)}&email=${encodeURIComponent(e)}`;

  await sendMail({
    to: e,
    subject: "Reset your ReelMyDay password",
    html: `<p>We received a request to reset your password.</p>
           <p><a href="${link}" target="_blank">Reset password</a> (valid for ${RESET_TTL_MIN} minutes)</p>
           <p>If you didn’t request this, you can ignore this email.</p>`,
    text: `Reset your password: ${link}`,
  });

  return res.json({ ok: true });
}