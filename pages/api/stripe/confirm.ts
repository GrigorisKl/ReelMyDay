// pages/api/stripe/confirm.ts
import type { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";
import { prisma } from "../../../lib/prisma";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const { sessionId } = req.body || {};
  if (!sessionId) return res.status(400).json({ ok: false, error: "missing_session" });

  try {
    const s = await stripe.checkout.sessions.retrieve(String(sessionId), {
      expand: ["subscription", "customer"],
    });

    // Consider "complete" OR paid OR active/trialing subscription as success
    const sub =
      (typeof s.subscription === "object" && s.subscription) || null;
    const subActive = sub ? (sub.status === "active" || sub.status === "trialing") : false;
    const paid = s.payment_status === "paid" || s.status === "complete";

    if (!(paid || subActive)) {
      return res.status(200).json({
        ok: false,
        state: s.status,
        payment: s.payment_status,
        sub: sub?.status ?? null,
      });
    }

    const email = (s.customer_details?.email || s.customer_email || "").toLowerCase();
    const clientRefId = s.client_reference_id || null;
    const custId = typeof s.customer === "string" ? s.customer : s.customer?.id || undefined;
    const subId = typeof s.subscription === "string" ? s.subscription : s.subscription?.id || undefined;

    // Update the user row – prefer the user id from client_reference_id
    if (clientRefId) {
      await prisma.user.update({
        where: { id: clientRefId },
        data: { isPro: true, stripeCustomerId: custId, stripeSubscriptionId: subId },
      });
    } else if (email) {
      await prisma.user.update({
        where: { email },
        data: { isPro: true, stripeCustomerId: custId, stripeSubscriptionId: subId },
      });
    } else {
      return res.status(200).json({ ok: false, error: "no_user_match" });
    }

    return res.json({ ok: true });
  } catch (e: any) {
    console.error("CONFIRM_ERROR", e?.message || e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}