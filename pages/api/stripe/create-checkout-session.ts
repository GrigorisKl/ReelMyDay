import type { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";
import { prisma } from "../../../lib/prisma";

const sk = process.env.STRIPE_SECRET_KEY || "";
// Let the SDK use its bundled API version (no apiVersion field)
const stripe = new Stripe(sk);

const PRICE = process.env.STRIPE_PRICE_ID || "";
const BASE  =
  process.env.APP_BASE_URL ||
  process.env.NEXTAUTH_URL ||
  "http://localhost:3000";

const SUCCESS_URL = process.env.STRIPE_SUCCESS_URL || `${BASE}/pricing?status=success`;
const CANCEL_URL  = process.env.STRIPE_CANCEL_URL  || `${BASE}/pricing?status=cancel`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    if (!sk || !(sk.startsWith("sk_live_") || sk.startsWith("sk_test_"))) {
      return res.status(500).json({ ok: false, error: "stripe_secret_missing" });
    }
    if (!PRICE || !PRICE.startsWith("price_")) {
      return res.status(500).json({ ok: false, error: "bad_price_id" });
    }

    const email = (req.body?.email || "").toString().trim().toLowerCase();
    if (!email) return res.status(401).json({ ok: false, error: "no_email" });

    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) user = await prisma.user.create({ data: { email } });

    // Ensure customer exists in the current Stripe mode (live/test)
    let customerId = user.stripeCustomerId || undefined;
    if (customerId) {
      try { await stripe.customers.retrieve(customerId); }
      catch { customerId = undefined; }
    }
    if (!customerId) {
      const cust = await stripe.customers.create({ email, metadata: { appUserId: user.id } });
      customerId = cust.id;
      await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: PRICE, quantity: 1 }],
      success_url: SUCCESS_URL,
      cancel_url: CANCEL_URL,
      allow_promotion_codes: true,
      automatic_tax: { enabled: false },
      client_reference_id: user.id,
    });

    return res.json({ ok: true, url: session.url });
  } catch (err: any) {
    console.error("STRIPE_CHECKOUT_ERROR:", err?.message || err);
    return res.status(400).json({ ok: false, error: "checkout_failed", detail: err?.message || "unknown" });
  }
}