import type { Metadata } from "next";
import Link from "next/link";

import ContactForm from "@/components/contact/ContactForm";
import {
  contactContent,
  replaceLaunchTokens,
  betaBannerContent,
} from "@/lib/content/launchContent";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({
  title: "Contact Support",
  description:
    "Send support questions, bug reports, partnership requests, or feedback to WanderBharat. We usually reply within two business days during public beta.",
  path: contactContent.meta.canonical,
});

export default function ContactPage() {
  const supportEmail = process.env.CONTACT_TO_EMAIL ?? "chakrabortyaritra.2002@gmail.com";
  const isProduction = process.env.NODE_ENV === "production";
  const hasContactFormConfig = Boolean(
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() &&
      process.env.TURNSTILE_SECRET_KEY?.trim() &&
      process.env.RESEND_API_KEY?.trim() &&
      process.env.CONTACT_FROM_EMAIL?.trim(),
  );
  const isContactFormAvailable = !isProduction || hasContactFormConfig;

  return (
    <section className="mt-10 md:mt-14 max-w-4xl">
      <header className="max-w-3xl">
        <p className="eyebrow">{contactContent.eyebrow}</p>
        <h1 className="mt-3 text-4xl md:text-[3rem] font-bold leading-[1.06] tracking-tight text-[var(--color-ink-900)]">
          {contactContent.title}
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-[var(--color-ink-600)]">
          {contactContent.intro}
        </p>
      </header>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
        {isContactFormAvailable ? (
          <ContactForm supportEmail={supportEmail} content={contactContent.form} />
        ) : (
          <div className="card p-6 sm:p-7 border-red-200 bg-red-50/60">
            <p className="text-sm font-semibold text-red-900">
              Contact form is temporarily unavailable.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-red-800">
              Please email{" "}
              <a
                href={`mailto:${supportEmail}`}
                className="font-semibold underline underline-offset-2"
              >
                {supportEmail}
              </a>{" "}
              and we will get back to you as soon as possible.
            </p>
          </div>
        )}

        <aside className="card p-6 sm:p-7">
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--color-brand-700)]">
            Query support
          </p>
          <h2 className="mt-3 text-xl font-bold text-[var(--color-ink-900)]">
            Reach us directly
          </h2>
          <p className="mt-3 text-[var(--color-ink-600)] leading-relaxed">
            Email:{" "}
            <a
              href={`mailto:${supportEmail}`}
              className="font-semibold text-[var(--color-ink-800)] underline-offset-2 hover:underline"
            >
              {supportEmail}
            </a>
          </p>
          <p className="mt-2 text-[var(--color-ink-600)] leading-relaxed">
            {contactContent.responseTime}
          </p>
          <p className="mt-2 text-[var(--color-ink-600)] leading-relaxed">
            Form submissions are delivered to this inbox.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-[var(--color-ink-600)]">
            {replaceLaunchTokens(contactContent.form.privacyNote, {
              CONTACT_TO_EMAIL: supportEmail,
            })}
          </p>

          <div className="mt-6 rounded-xl border border-[var(--hairline)] bg-[var(--color-sand-50)] p-4">
            <p className="text-sm font-semibold text-[var(--color-ink-800)]">
              Public beta reminder
            </p>
            <p className="mt-1 text-sm leading-relaxed text-[var(--color-ink-600)]">
              {betaBannerContent.planner.body}
            </p>
            <Link
              href={betaBannerContent.planner.link.href}
              className="mt-3 inline-flex text-sm font-semibold text-[var(--color-ink-800)] underline-offset-2 hover:underline"
            >
              {betaBannerContent.planner.link.label}
            </Link>
          </div>
        </aside>
      </div>
    </section>
  );
}
