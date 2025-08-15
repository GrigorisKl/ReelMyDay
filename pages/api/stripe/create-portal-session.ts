// pages/api/stripe/create-portal-session.ts
import type { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";
import { prisma } from "../../../lib/prisma";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const email = (req.body?.email || "").toString().trim().toLowerCase();
  if (!email) return res.status(401).json({ error: "not_signed_in" });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(404).json({ error: "user_not_found" });

  let customerId = user.stripeCustomerId || "";

  // Try to find existing Stripe customer by email
  if (!customerId) {
    const found = await stripe.customers.list({ email, limit: 1 });
    if (found.data.length) customerId = found.data[0].id;
  }
  // Create if still missing
  if (!customerId) {
    const created = await stripe.customers.create({ email });
    customerId = created.id;
  }
  // Persist for next time
  if (customerId && customerId !== user.stripeCustomerId) {
    await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } });
  }

  try {
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: process.env.STRIPE_SUCCESS_URL || "http://localhost:3000/pricing",
    });
    return res.json({ url: portal.url });
  } catch (e: any) {
    const msg: string = e?.message || "portal_error";
    // Common cause: Portal not enabled in Dashboard
    const hint = /No such configuration|is not enabled/i.test(msg)
      ? "portal_not_enabled"
      : "portal_error";
    console.error("PORTAL_ERROR", msg);
    return res.status(400).json({ error: hint, message: msg });
  }
}