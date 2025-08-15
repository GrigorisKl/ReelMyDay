// pages/api/auth/signup.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../lib/prisma";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { sendMailSafe } from "../../../lib/mailer";

const OWNER_EMAIL = (process.env.OWNER_EMAIL || "").trim().toLowerCase();
const APP_BASE_URL =
  process.env.APP_BASE_URL ||
  process.env.NEXTAUTH_URL ||
  "http://localhost:3000";

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
// min 8, 1 upper, 1 lower, 1 number
const STRONG_PW = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const { name, email, password, confirmPassword } = (req.body || {}) as {
      name?: string;
      email?: string;
      password?: string;
      confirmPassword?: string;
    };

    const e = String(email || "").trim().toLowerCase();
    const p = String(password || "");
    const cp = String(confirmPassword || "");

    if (!isValidEmail(e)) {
      return res.status(400).json({ ok: false, error: "invalid_email" });
    }
    if (!STRONG_PW.test(p)) {
      return res.status(400).json({
        ok: false,
        error: "weak_password",
        message: "Min 8 chars, include upper, lower, and a number.",
      });
    }
    if (p !== cp) {
      return res.status(400).json({ ok: false, error: "mismatch" });
    }

    const exists = await prisma.user.findUnique({ where: { email: e } });
    if (exists) {
      return res.status(409).json({ ok: false, error: "exists" });
    }

    // create user
    const hash = await bcrypt.hash(p, 12);
    const user = await prisma.user.create({
      data: {
        email: e,
        name: String(name || "").trim() || null,
        passwordHash: hash,
        isPro: e === OWNER_EMAIL,
      },
    });

    // verification token (24h)
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.verificationToken.create({
      data: { identifier: `verify:${e}`, token, expires },
    });

    const link = `${APP_BASE_URL}/auth/verify?token=${token}&email=${encodeURIComponent(
      e
    )}`;

    // fire-and-never-throw email
    const mail = await sendMailSafe({
      to: e,
      subject: "Verify your ReplayMyDay email",
      html: `<p>Click to verify your email:</p>
             <p><a href="${link}">Verify email</a></p>
             <p>This link expires in 24 hours.</p>`,
      text: `Verify your email: ${link}`,
    });

    return res.status(200).json({
      ok: true,
      email: user.email,
      mailOk: mail.ok === true,
    });
  } catch (err: any) {
    console.error("SIGNUP_500", err?.message || err);
    return res
      .status(500)
      .json({ ok: false, error: "server_error", message: err?.message || "" });
  }
}