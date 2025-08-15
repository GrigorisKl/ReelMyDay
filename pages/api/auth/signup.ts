// pages/api/auth/signup.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../lib/prisma";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { sendMail } from "../../../lib/mailer";

const OWNER_EMAIL = (process.env.OWNER_EMAIL || "").trim().toLowerCase();
const APP_BASE_URL = process.env.APP_BASE_URL || "http://localhost:3000";

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
const STRONG_PW = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const { name, email, password, confirmPassword } = (req.body || {}) as {
    name?: string; email?: string; password?: string; confirmPassword?: string;
  };

  const e = (email || "").toString().trim().toLowerCase();
  const p = (password || "").toString();
  const cp = (confirmPassword || "").toString();

  if (!isValidEmail(e)) return res.status(400).json({ ok: false, error: "invalid_email" });
  if (!STRONG_PW.test(p)) {
    return res.status(400).json({
      ok: false,
      error: "weak_password",
      message: "Min 8 chars, include upper, lower, and a number.",
    });
  }
  if (p !== cp) return res.status(400).json({ ok: false, error: "mismatch", message: "Passwords do not match." });

  const exists = await prisma.user.findUnique({ where: { email: e } });
  if (exists) return res.status(409).json({ ok: false, error: "exists" });

  const hash = await bcrypt.hash(p, 12);
  const user = await prisma.user.create({
    data: {
      email: e,
      name: (name || "").toString().trim() || null,
      passwordHash: hash,
      isPro: e === OWNER_EMAIL, // owner gets Pro
    },
  });

  // Create verification token (24h)
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await prisma.verificationToken.create({
    data: { identifier: `verify:${e}`, token, expires },
  });

  const link = `${APP_BASE_URL}/auth/verify?token=${encodeURIComponent(token)}&email=${encodeURIComponent(e)}`;

  await sendMail({
    to: user.email!,
    subject: "Verify your ReelMyDay email",
    html: `<p>Welcome to ReelMyDay!</p>
           <p><a href="${link}" target="_blank" rel="noopener">Click here to verify your email</a> (valid for 24 hours).</p>`,
    text: `Verify your email: ${link}`,
  });

  return res.json({ ok: true });
}