// pages/privacy.tsx
// TODO: Replace bracketed placeholders (name, address, processors) before going live.

import Link from "next/link";

export default function Privacy() {
  const lastUpdated = "August 15, 2025"; // update when you change this page

  return (
    <section className="mt-8">
      <div className="card p-6 max-w-3xl mx-auto leading-relaxed">
        <h1 className="text-3xl font-bold">Privacy Policy</h1>
        <p className="mt-1 text-black/70">Last updated: {lastUpdated}</p>

        <p className="mt-4">
          This Privacy Policy explains how <strong>ReelMyDay</strong> (“we”, “us”, “our”)
          collects, uses, and shares information about you when you use our website and services
          (the “Service”). By using ReelMyDay, you agree to the practices described here.
        </p>

        <hr className="my-6 border-black/10" />

        <h2 className="text-xl font-semibold">1) Who we are & how to contact us</h2>
        <p className="mt-2">
          Data controller: <strong>ReelMyDay</strong><br />
          Email: <a className="underline" href="mailto:grigoriskleanthous@gmail.com">grigoriskleanthous@gmail.com</a><br />
        </p>

        <h2 className="text-xl font-semibold mt-6">2) Information we collect</h2>
        <ul className="list-disc pl-6 mt-2 space-y-1">
          <li><strong>Account data</strong>: email, name (optional), password hash (never your plain password).</li>
          <li><strong>Media you upload</strong>: photos, videos, audio files you choose to upload to create reels.</li>
          <li><strong>Render metadata</strong>: project settings (duration, motion, audio choices), export counts and history tied to your account.</li>
          <li><strong>Usage & device data</strong>: basic logs (IP, timestamps, pages/actions) to keep the Service secure and reliable.</li>
          <li><strong>Cookies/local storage</strong>: for sign-in/session, preferences, and rate-limiting (no third-party ad cookies).</li>
          <li><strong>Payments</strong> (when enabled): processed by our payment provider; we don’t store full card details.</li>
        </ul>

        <h2 className="text-xl font-semibold mt-6">3) How we use your information</h2>
        <ul className="list-disc pl-6 mt-2 space-y-1">
          <li>Provide, maintain, and improve the Service (render reels, store your projects).</li>
          <li>Authenticate you, prevent abuse/fraud, and enforce our terms.</li>
          <li>Communicate with you (verification emails, password resets, service notices).</li>
          <li>Process payments and manage subscriptions (when enabled).</li>
          <li>Analytics to understand feature usage (only our own or privacy-respecting tools).</li>
        </ul>

        <h2 className="text-xl font-semibold mt-6">4) Legal bases (EEA/UK users)</h2>
        <ul className="list-disc pl-6 mt-2 space-y-1">
          <li><strong>Contract</strong>: to deliver the Service you requested.</li>
          <li><strong>Legitimate interests</strong>: security, preventing fraud, product analytics.</li>
          <li><strong>Consent</strong>: where required (e.g., marketing emails; optional features).</li>
          <li><strong>Legal obligation</strong>: to comply with applicable law or lawful requests.</li>
        </ul>

        <h2 className="text-xl font-semibold mt-6">5) How we share information</h2>
        <p className="mt-2">
          We don’t sell your personal information. We may share with service providers who help us
          run ReelMyDay, strictly under contract:
        </p>
        <ul className="list-disc pl-6 mt-2 space-y-1">
          <li><strong>Hosting & storage</strong>: e.g., <em>[Bluehost / Vercel / AWS S3]</em>.</li>
          <li><strong>Email delivery</strong>: e.g., <em>[Gmail (App Password), Resend/Mailgun/Postmark]</em>.</li>
          <li><strong>Payments</strong> (when enabled): e.g., <em>[Stripe]</em> (we don’t store full card numbers).</li>
          <li><strong>Analytics/telemetry</strong>: e.g., <em>[Plausible / PostHog (self-hosted) / none]</em>.</li>
        </ul>
        <p className="mt-2">
          We may disclose information if required by law, to protect rights/safety, or during a business transaction
          (merger, acquisition), with appropriate safeguards.
        </p>

        <h2 className="text-xl font-semibold mt-6">6) Content handling</h2>
        <ul className="list-disc pl-6 mt-2 space-y-1">
          <li>
            Uploaded media is used only to produce your reel. We do <strong>not</strong> use your media to train
            machine-learning models.
          </li>
          <li>
            We retain uploaded media only as needed to render and deliver your file. Rendered outputs and their links
            may be stored in your account until you delete them or request deletion.
          </li>
        </ul>

        <h2 className="text-xl font-semibold mt-6">7) International transfers</h2>
        <p className="mt-2">
          We may transfer data to countries outside your own. When we do, we use lawful transfer mechanisms such as
          Standard Contractual Clauses (EEA/UK users) and require our processors to protect your data appropriately.
        </p>

        <h2 className="text-xl font-semibold mt-6">8) Data retention</h2>
        <p className="mt-2">
          We keep information only as long as necessary for the purposes above, then either delete or anonymize it.
          You can ask us to delete your account and associated content at any time.
        </p>

        <h2 className="text-xl font-semibold mt-6">9) Your rights</h2>
        <p className="mt-2">
          Depending on where you live, you may have rights to access, correct, delete, or export your data; object to or
          restrict certain processing; and withdraw consent. To exercise these rights, contact{" "}
          <a className="underline" href="mailto:grigoriskleanthous@gmail.com">grigoriskleanthous@gmail.com</a>.
        </p>
        <p className="mt-2">
          California (CCPA/CPRA): we do not “sell” or “share” personal information for cross-context behavioral
          advertising. You can request access or deletion using the contact above.
        </p>

        <h2 className="text-xl font-semibold mt-6">10) Children’s privacy</h2>
        <p className="mt-2">
          ReelMyDay is not directed to children. Do not use the Service if you are under the age of 13 (or the
          minimum age in your jurisdiction without parental consent).
        </p>

        <h2 className="text-xl font-semibold mt-6">11) Security</h2>
        <p className="mt-2">
          We use reasonable technical and organizational measures (e.g., HTTPS in transit, access controls). No online
          service is 100% secure; please use a strong, unique password for your account.
        </p>

        <h2 className="text-xl font-semibold mt-6">12) Cookies</h2>
        <p className="mt-2">
          We use essential cookies/local storage for sign-in and preferences. If we add analytics/cookie banner, we’ll
          update this section.
        </p>

        <h2 className="text-xl font-semibold mt-6">13) Changes to this policy</h2>
        <p className="mt-2">
          We may update this policy from time to time. We’ll post the new date at the top and, if changes are material,
          notify you by email or in-app.
        </p>

        <h2 className="text-xl font-semibold mt-6">14) Contact</h2>
        <p className="mt-2">
          Questions or requests? Email{" "}
          <a className="underline" href="mailto:grigoriskleanthous@gmail.com">grigoriskleanthous@gmail.com</a>.
        </p>

        <div className="mt-6 text-sm text-black/60">
          <p>
            This page is provided for general information and does not constitute legal advice.
            Consider consulting counsel to ensure compliance with laws applicable to your business.
          </p>
          <p className="mt-2">
            Need Terms of Service too?{" "}
            <Link className="underline" href="/terms">See our Terms</Link>
          </p>
        </div>
      </div>
    </section>
  );
}