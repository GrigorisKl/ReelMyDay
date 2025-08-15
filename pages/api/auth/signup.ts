// pages/api/auth/signup.ts
import type { NextApiRequest, NextApiResponse } from "next";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "../../../lib/prisma";
import { sendMail } from "../../../lib/mailer";

const APP_BASE_URL = process.env.APP_BASE_URL || "http://localhost:3000";
const OWNER_EMAIL = (process.env.OWNER_EMAIL || "grigoriskleanthous@gmail.com").toLowerCase();

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
const STRONG_PW = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });

  const name = (req.body?.name || "").toString().trim();
  const email = (req.body?.email || "").toString().trim().toLowerCase();
  const password = (req.body?.password || "").toString();
  const confirmPassword = (req.body?.confirmPassword || "").toString();

  // Basic validation
  if (!isValidEmail(email)) return res.status(400).json({ ok: false, error: "invalid_email" });
  if (!STRONG_PW.test(password)) {
    return res.status(400).json({
      ok: false,
      error: "weak_password",
      message: "Min 8 chars, include upper, lower, and a number.",
    });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ ok: false, error: "mismatch", message: "Passwords do not match." });
  }

  try {
    // Check if user exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ ok: false, error: "exists" });

    // Create user
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email,
        name: name || null,
        passwordHash,
        isPro: email === OWNER_EMAIL, // owner gets Pro automatically
      },
      select: { id: true, email: true },
    });

    // Create/replace email verification token (24h)
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Clear previous tokens for this identifier (avoid unique collisions)
    const identifier = `verify:${email}`;
    await prisma.verificationToken.deleteMany({ where: { identifier } });
    await prisma.verificationToken.create({
      data: { identifier, token, expires },
    });

    const verifyUrl = `${APP_BASE_URL}/auth/verify?token=${token}&email=${encodeURIComponent(email)}`;

    // Try send mail; if it fails, log but DO NOT crash the route
    let sent = true;
    try {
      await sendMail({
        to: email,
        subject: "Verify your ReplayMyDay email",
        html: `
          <p>Hi${name ? " " + name : ""},</p>
          <p>Thanks for signing up for ReplayMyDay. Please verify your email:</p>
          <p><a href="${verifyUrl}" target="_blank">Verify email</a></p>
          <p>This link expires in 24 hours.</p>
        `,
        text: `Verify your email: ${verifyUrl}`,
      });
    } catch (mailErr: any) {
      sent = false;
      console.error("SIGNUP_MAIL_FAIL", mailErr?.message || mailErr);
      // You can choose to return a 200 anyway so the UI shows a friendly message:
      // The token is stored; the user can request another verification later.
    }

    return res.status(200).json({
      ok: true,
      sent,
      // For debugging in dev only, never expose in production
      ...(process.env.NODE_ENV !== "production" ? { debugVerifyUrl: verifyUrl } : {}),
    });
  } catch (err: any) {
    console.error("SIGNUP_API_FAIL", err?.message || err);
    // Always return JSON so the client never tries to parse HTML
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}