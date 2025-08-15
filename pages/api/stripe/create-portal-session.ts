import type { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";
import { prisma } from "../../../lib/prisma";

const sk = process.env.STRIPE_SECRET_KEY || "";
const stripe = new Stripe(sk);

const BASE = process.env.APP_BASE_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
const RETURN_URL = `${BASE}/pricing?manage=1`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    if (!sk || !(sk.startsWith("sk_live_") || sk.startsWith("sk_test_"))) {
      return res.status(500).json({ ok: false, error: "stripe_secret_missing" });
    }

    const email = (req.body?.email || "").toString().trim().toLowerCase();
    if (!email) return res.status(401).json({ ok: false, error: "no_email" });

    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) user = await prisma.user.create({ data: { email } });

    let customerId = user.stripeCustomerId || undefined;
    if (customerId) {
      try { await stripe.customers.retrieve(customerId); }
      catch { customerId = undefined; }
    }
    if (!customerId) {
      const found = await stripe.customers.list({ email, limit: 1 });
      if (found.data[0]) {
        customerId = found.data[0].id;
      } else {
        const created = await stripe.customers.create({ email, metadata: { appUserId: user.id } });
        customerId = created.id;
      }
      await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } });
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: RETURN_URL,
    });

    return res.json({ ok: true, url: portal.url });
  } catch (e: any) {
    const msg = e?.message || "portal_error";
    const hint = /not enabled|No such configuration/i.test(msg) ? "portal_not_enabled" : "portal_failed";
    console.error("STRIPE_PORTAL_ERROR:", msg);
    return res.status(400).json({ ok: false, error: hint, detail: msg });
  }
}