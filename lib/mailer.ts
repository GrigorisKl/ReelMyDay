// lib/mailer.ts
import nodemailer, { type Transporter } from "nodemailer";

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
} = process.env;

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error("SMTP env vars missing (SMTP_HOST, SMTP_USER, SMTP_PASS).");
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT ?? 465),
    secure: String(SMTP_SECURE ?? "true") !== "false", // default true
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

export type MailParams = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
};

export async function sendMail({ to, subject, html, text }: MailParams): Promise<void> {
  const t = getTransporter();
  await t.sendMail({
    from: SMTP_FROM || SMTP_USER, // safe default
    to,
    subject,
    html,
    text,
  });
}