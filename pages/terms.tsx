// pages/terms.tsx
// TODO: Replace bracketed placeholders (business name, address, governing law) before going live.

import Link from "next/link";

export default function Terms() {
  const lastUpdated = "August 15, 2025"; // update whenever you change this page

  return (
    <section className="mt-8">
      <div className="card p-6 max-w-3xl mx-auto leading-relaxed">
        <h1 className="text-3xl font-bold">Terms of Service</h1>
        <p className="mt-1 text-black/70">Last updated: {lastUpdated}</p>

        <p className="mt-4">
          Welcome to <strong>ReelMyDay</strong> (the “Service”). These Terms of Service (the “Terms”) form
          a legally binding agreement between you and <strong>Grigoris Kleanthous</strong> (“we”, “us”, “our”).
          By accessing or using the Service, you agree to these Terms.
        </p>

        <hr className="my-6 border-black/10" />

        <h2 className="text-xl font-semibold">1) Eligibility & Accounts</h2>
        <ul className="list-disc pl-6 mt-2 space-y-1">
          <li>You must be at least 13 years old (or the age of digital consent in your country).</li>
          <li>You must provide accurate information, keep your credentials secure, and promptly update any changes.</li>
          <li>We may suspend or terminate accounts for violations of these Terms or suspected abuse.</li>
        </ul>

        <h2 className="text-xl font-semibold mt-6">2) The Service</h2>
        <ul className="list-disc pl-6 mt-2 space-y-1">
          <li>Create short vertical reels from photos and/or videos, with optional MP3 audio and basic motion effects.</li>
          <li>Free plan includes full editor access and <strong>1 export total</strong> per account.</li>
          <li>Pro plan ($5/month) offers <strong>unlimited exports</strong> (fair-use; see Section 8).</li>
          <li>Technical limits (e.g., file size/duration/format) and rate limits may apply and can change as we improve the Service.</li>
          <li>We may update, suspend, or discontinue features with reasonable notice where practicable.</li>
        </ul>

        <h2 className="text-xl font-semibold mt-6">3) Subscriptions & Billing</h2>
        <p className="mt-2">
          When enabled, paid subscriptions will be processed by our payment provider (e.g., Stripe).
          By starting a subscription, you authorize recurring charges until you cancel.
        </p>
        <ul className="list-disc pl-6 mt-2 space-y-1">
          <li><strong>Auto-renewal:</strong> Monthly plans renew automatically unless canceled before the next billing date.</li>
          <li><strong>Cancellation:</strong> You can cancel anytime; access remains through the end of the current billing period.</li>
          <li><strong>Refunds:</strong> Except where required by law, charges are non-refundable and we don’t provide prorated refunds for partial months.</li>
          <li>
            <strong>EEA/UK consumers:</strong> By starting a subscription and requesting immediate access to digital content,
            you acknowledge that your right of withdrawal may be lost once performance begins.
          </li>
        </ul>

        <h2 className="text-xl font-semibold mt-6">4) Your Content & License to Us</h2>
        <ul className="list-disc pl-6 mt-2 space-y-1">
          <li>You retain all rights to media you upload and reels you export.</li>
          <li>
            You grant us a limited, non-exclusive, revocable license to host, process, and render your content solely to
            provide the Service to you (e.g., generate your reel, store your project/renders, and deliver downloads).
          </li>
          <li>
            You represent and warrant that you own or have necessary rights to the content you upload (including music),
            and that your use does not infringe any third-party rights or violate applicable laws.
          </li>
        </ul>

        <h2 className="text-xl font-semibold mt-6">5) Prohibited Conduct</h2>
        <ul className="list-disc pl-6 mt-2 space-y-1">
          <li>Uploading illegal content, malware, or content that is defamatory, hateful, or sexually exploitative of minors.</li>
          <li>Violating others’ intellectual property or publicity/privacy rights.</li>
          <li>Attempting to interfere with, abuse, or bypass Service limits, or reverse-engineering our software.</li>
          <li>Reselling or providing the Service to third parties without our prior written consent.</li>
        </ul>

        <h2 className="text-xl font-semibold mt-6">6) Intellectual Property</h2>
        <p className="mt-2">
          The Service (including software, UI, trademarks, and branding) is owned by us or our licensors and protected by
          intellectual property laws. Except for your content, all rights not expressly granted are reserved.
        </p>

        <h2 className="text-xl font-semibold mt-6">7) DMCA & Copyright Complaints</h2>
        <p className="mt-2">
          If you believe content on the Service infringes your copyright, email{" "}
          <a className="underline" href="mailto:grigoriskleanthous@gmail.com">grigoriskleanthous@gmail.com</a> with:
          (i) your contact details, (ii) a description and location (URL) of the infringing material, (iii) a statement
          that you have a good-faith belief the use is unauthorized, and (iv) a statement under penalty of perjury that
          your notice is accurate and that you are the rights holder or authorized to act. We may remove content and/or
          terminate repeat infringers as appropriate.
        </p>

        <h2 className="text-xl font-semibold mt-6">8) Fair Use & Limits</h2>
        <p className="mt-2">
          Pro “unlimited” exports are subject to reasonable and non-excessive use. We may throttle or restrict accounts that
          materially impact system stability or appear to automate bulk use inconsistent with individual creator workflows.
        </p>

        <h2 className="text-xl font-semibold mt-6">9) Privacy</h2>
        <p className="mt-2">
          Your use is governed by our <Link className="underline" href="/privacy">Privacy Policy</Link>, which explains
          what we collect, how we use it, and your choices.
        </p>

        <h2 className="text-xl font-semibold mt-6">10) Disclaimers</h2>
        <p className="mt-2">
          The Service is provided “as is” and “as available.” To the fullest extent permitted by law, we disclaim all
          warranties, express or implied, including merchantability, fitness for a particular purpose, and non-infringement.
          We do not guarantee uninterrupted or error-free operation, or that files will be perpetually available.
        </p>

        <h2 className="text-xl font-semibold mt-6">11) Limitation of Liability</h2>
        <p className="mt-2">
          To the extent permitted by law, we are not liable for any indirect, incidental, special, consequential, or
          punitive damages, or any loss of profits, revenues, data, or goodwill. Our aggregate liability for any claim
          relating to the Service is limited to the greater of (i) the amount you paid us in the 3 months preceding the
          claim, or (ii) EUR 50.
        </p>

        <h2 className="text-xl font-semibold mt-6">12) Indemnity</h2>
        <p className="mt-2">
          You agree to indemnify and hold harmless us and our affiliates from any claims, damages, liabilities, and
          expenses (including reasonable legal fees) arising from your content or your breach of these Terms.
        </p>

        <h2 className="text-xl font-semibold mt-6">13) Changes to These Terms</h2>
        <p className="mt-2">
          We may update these Terms from time to time. Material changes will be notified via the Service or email.
          Continued use after changes become effective constitutes acceptance of the updated Terms.
        </p>

        <h2 className="text-xl font-semibold mt-6">14) Governing Law & Disputes</h2>
        <p className="mt-2">
          These Terms are governed by the laws of <strong>[Cyprus]</strong>, without regard to conflict of laws rules.
          Courts of <strong>[Cyprus]</strong> shall have exclusive jurisdiction, unless applicable law provides otherwise
          for consumers. If you are a consumer in the EEA/UK, you also retain any mandatory rights you have under your
          local laws.
        </p>

        <h2 className="text-xl font-semibold mt-6">15) Contact</h2>
        <p className="mt-2">
          <strong>Grigoris Kleanthous</strong><br />
          {/* Optional: add address on a Contact/Imprint page if required in your jurisdiction */}
          Email: <a className="underline" href="mailto:grigoriskleanthous@gmail.com">grigoriskleanthous@gmail.com</a>
        </p>

        <div className="mt-6 text-sm text-black/60">
          <p>
            This page is provided for general information and does not constitute legal advice.
            Consider consulting counsel to ensure compliance with laws applicable to your business.
          </p>
        </div>
      </div>
    </section>
  );
}