import type { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";
import { prisma } from "../../../lib/prisma";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const email = (req.body?.email || "").toString().trim().toLowerCase();
  if (!email) return res.status(401).json({ error: "not_signed_in" });

  const PRICE = process.env.STRIPE_PRICE_ID;
  if (!PRICE || PRICE === "price_xxx") {
    return res.status(500).json({ error: "price_not_configured" });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(404).json({ error: "user_not_found" });

  // Ensure Stripe customer
  let customerId = user.stripeCustomerId || undefined;
  if (!customerId) {
    const customer = await stripe.customers.create({ email });
    customerId = customer.id;
    await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } });
  }

  // success URL + session_id placeholder
  const successBase = process.env.STRIPE_SUCCESS_URL || "http://localhost:3000/pricing";
  const u = new URL(successBase);
  u.searchParams.set("status", "success");
  u.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: PRICE, quantity: 1 }],
    success_url: u.toString(),
    cancel_url: process.env.STRIPE_CANCEL_URL || "http://localhost:3000/pricing?status=cancel",
    client_reference_id: user.id,
  });

  return res.json({ url: session.url });
}