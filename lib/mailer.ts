// lib/mailer.ts
import nodemailer, { type Transporter } from "nodemailer";

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_SECURE, // "true" | "false" (optional)
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
} = process.env;

let transporter: Transporter | null = null;

function buildTransporter(): Transporter | null {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.warn(
      "MAILER_WARN: missing SMTP envs (SMTP_HOST/SMTP_USER/SMTP_PASS). Emails will be skipped."
    );
    return null;
  }
  const port = Number(SMTP_PORT || 465);
  const secure =
    typeof SMTP_SECURE === "string" ? SMTP_SECURE !== "false" : port === 465;

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

function getTransporter(): Transporter | null {
  if (transporter) return transporter;
  transporter = buildTransporter();
  return transporter;
}

export type MailParams = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
};

/** Preferred: never throws; returns ok/error. */
export async function sendMailSafe(
  { to, subject, html, text }: MailParams
): Promise<{ ok: boolean; error?: string }> {
  try {
    const t = getTransporter();
    if (!t) return { ok: false, error: "smtp_not_configured" };

    await t.sendMail({
      from: SMTP_FROM || SMTP_USER || "no-reply@localhost",
      to,
      subject,
      html,
      text: text || (html ? html.replace(/<[^>]+>/g, " ") : ""),
    });
    return { ok: true };
  } catch (e: any) {
    console.error("MAILER_FAIL", e?.message || e);
    return { ok: false, error: e?.message || "mailer_error" };
  }
}

/**
 * Compatibility wrapper for older code that imports `sendMail`.
 * Same params, returns Promise<void>, swallows errors.
 */
export async function sendMail(p: MailParams): Promise<void> {
  await sendMailSafe(p); // ignore result to preserve void signature
}