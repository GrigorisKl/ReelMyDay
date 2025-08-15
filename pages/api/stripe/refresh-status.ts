// pages/api/stripe/refresh-status.ts
import type { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";
import { prisma } from "../../../lib/prisma";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const email = (req.body?.email || "").toString().trim().toLowerCase();
  if (!email) return res.status(400).json({ ok: false, error: "missing_email" });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(404).json({ ok: false, error: "user_not_found" });

  try {
    // find or create Stripe customer
    let customerId = user.stripeCustomerId || "";
    if (!customerId) {
      const found = await stripe.customers.list({ email, limit: 1 });
      if (found.data.length) customerId = found.data[0].id;
    }
    if (!customerId) {
      const created = await stripe.customers.create({ email });
      customerId = created.id;
    }
    if (customerId !== user.stripeCustomerId) {
      await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } });
    }

    // get latest subscription
    const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 1 });
    const sub = subs.data[0];
    const active = !!sub && (sub.status === "active" || sub.status === "trialing");

    await prisma.user.update({
      where: { id: user.id },
      data: { isPro: active, stripeSubscriptionId: sub?.id || null },
    });

    return res.json({ ok: true, isPro: active, subStatus: sub?.status || null });
  } catch (e: any) {
    console.error("REFRESH_STATUS_ERROR", e?.message || e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}