import type { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";
import { prisma } from "../../../lib/prisma";

export const config = { api: { bodyParser: false } }; // Stripe needs raw body

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

function readRawBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const sig = req.headers["stripe-signature"] as string;
  const buf = await readRawBody(req);

  let evt: Stripe.Event;
  try {
    evt = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET as string);
  } catch (err: any) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (evt.type) {
      case "checkout.session.completed": {
        const s = evt.data.object as Stripe.Checkout.Session;
        const subId = typeof s.subscription === "string" ? s.subscription : s.subscription?.id;
        const custId = typeof s.customer === "string" ? s.customer : s.customer?.id;
        const userId = s.client_reference_id || null;

        if (userId && custId) {
          await prisma.user.update({
            where: { id: userId },
            data: { isPro: true, stripeCustomerId: custId, stripeSubscriptionId: subId || null },
          });
        } else if (s.customer_email) {
          await prisma.user.update({
            where: { email: s.customer_email.toLowerCase() },
            data: { isPro: true, stripeCustomerId: custId || undefined, stripeSubscriptionId: subId || null },
          });
        }
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = evt.data.object as Stripe.Subscription;
        const active = sub.status === "active" || sub.status === "trialing";
        const custId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

        await prisma.user.updateMany({
          where: { stripeCustomerId: custId },
          data: { isPro: active, stripeSubscriptionId: sub.id },
        });
        break;
      }
    }

    res.json({ received: true });
  } catch (e) {
    console.error("Stripe webhook handler error", e);
    res.status(500).end();
  }
}