import type { NextApiRequest, NextApiResponse } from "next";
import * as nodemailer from "nodemailer";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const secure = String(port) === "465";

    if (!host || !user || !pass) {
      return res.status(200).json({ ok: false, mode: "jsonTransport (fallback)", note: "SMTP env missing" });
    }

    const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
    await transporter.verify(); // throws if it can’t connect/auth
    return res.status(200).json({ ok: true, mode: "smtp", host, port, from: process.env.SMTP_FROM });
  } catch (e: any) {
    return res.status(200).json({ ok: false, error: e?.message || String(e) });
  }
}