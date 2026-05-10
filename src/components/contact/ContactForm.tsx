"use client";

import type { FormEvent, ReactNode, SVGProps } from "react";
import { useMemo, useState } from "react";
import Script from "next/script";

type QueryTypeOption = {
  value: string;
  label: string;
};

type ContactFormContent = {
  fields: {
    name: string;
    email: string;
    queryType: string;
    destinationOrRegion: string;
    tripDates: string;
    numberOfPeople: string;
    budget: string;
    message: string;
    consent: string;
  };
  queryTypeOptions: readonly QueryTypeOption[];
  placeholders: {
    destinationOrRegion: string;
    tripDates: string;
    numberOfPeople: string;
    budget: string;
    message: string;
  };
  submitLabel: string;
  states: {
    idle: string;
    submitting: string;
    success: string;
    error: string;
    rateLimited: string;
  };
};

type ContactFormProps = {
  supportEmail: string;
  content: ContactFormContent;
};

type FormState = {
  name: string;
  email: string;
  queryType: string;
  destinationOrRegion: string;
  tripDates: string;
  numberOfPeople: string;
  budget: string;
  message: string;
  consent: boolean;
  company: string;
};

type VisibleFormField = Exclude<keyof FormState, "company">;
type FormErrorState = Partial<Record<VisibleFormField, string>>;
type ContactApiResponse = {
  message?: string;
  fieldErrors?: Record<string, string[]>;
};

type SubmitState = "idle" | "submitting" | "success" | "error";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_OPTIONAL_FIELD_LENGTH = 120;
const MAX_NAME_LENGTH = 120;
const MAX_NUMBER_OF_PEOPLE = 30;
const MIN_NUMBER_OF_PEOPLE = 1;
const MIN_MESSAGE_LENGTH = 20;
const MAX_MESSAGE_LENGTH = 4000;
const TURNSTILE_DEV_BYPASS_MESSAGE =
  "Turnstile is not configured locally. Spam checks are bypassed in development only.";
const TURNSTILE_UNAVAILABLE_MESSAGE =
  "Contact submissions are temporarily unavailable. Please try again later.";
const TURNSTILE_REQUIRED_MESSAGE =
  "Please complete the security check before sending your query.";

declare global {
  interface Window {
    turnstile?: {
      reset: (widgetId?: string | HTMLElement) => void;
    };
  }
}

const FORM_FIELDS: readonly VisibleFormField[] = [
  "name",
  "email",
  "queryType",
  "destinationOrRegion",
  "tripDates",
  "numberOfPeople",
  "budget",
  "message",
  "consent",
] as const;

export default function ContactForm({ supportEmail, content }: ContactFormProps) {
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";
  const isDevelopment = process.env.NODE_ENV !== "production";
  const isTurnstileEnabled = turnstileSiteKey.length > 0;
  const isProductionTurnstileMisconfigured = !isDevelopment && !isTurnstileEnabled;

  const initialState = useMemo<FormState>(
    () => ({
      name: "",
      email: "",
      queryType: content.queryTypeOptions[0]?.value ?? "",
      destinationOrRegion: "",
      tripDates: "",
      numberOfPeople: "",
      budget: "",
      message: "",
      consent: false,
      company: "",
    }),
    [content.queryTypeOptions],
  );

  const [form, setForm] = useState<FormState>(initialState);
  const [errors, setErrors] = useState<FormErrorState>({});
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [serverMessage, setServerMessage] = useState<string | null>(null);

  const statusMessage = getStatusMessage(
    submitState,
    content.states,
    supportEmail,
    serverMessage,
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitState === "submitting") {
      return;
    }
    const formElement = event.currentTarget;

    setSubmitState("idle");
    setServerMessage(null);

    const nextErrors = validate(form);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const turnstileToken = readTurnstileToken(formElement);
    if (isProductionTurnstileMisconfigured) {
      setSubmitState("error");
      setServerMessage(TURNSTILE_UNAVAILABLE_MESSAGE);
      return;
    }

    if (isTurnstileEnabled && !turnstileToken) {
      setSubmitState("error");
      setServerMessage(TURNSTILE_REQUIRED_MESSAGE);
      return;
    }

    setErrors({});
    setSubmitState("submitting");

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          queryType: form.queryType,
          destinationOrRegion: form.destinationOrRegion.trim(),
          tripDates: form.tripDates.trim(),
          numberOfPeople: form.numberOfPeople.trim(),
          budget: form.budget.trim(),
          message: form.message.trim(),
          consent: form.consent,
          company: form.company,
          turnstileToken: turnstileToken || undefined,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | ContactApiResponse
        | null;

      if (!response.ok) {
        const apiFieldErrors = normalizeFieldErrors(payload);
        if (Object.keys(apiFieldErrors).length > 0) {
          setErrors(apiFieldErrors);
        }

        if (response.status === 429) {
          setServerMessage(content.states.rateLimited);
        } else {
          setServerMessage(
            payload?.message ??
              content.states.error.replace("{CONTACT_TO_EMAIL}", supportEmail),
          );
        }
        setSubmitState("error");
        if (isTurnstileEnabled) {
          resetTurnstileWidget();
        }
        return;
      }

      setSubmitState("success");
      setServerMessage(payload?.message ?? null);
      setForm(initialState);
      if (isTurnstileEnabled) {
        resetTurnstileWidget();
      }
    } catch {
      setSubmitState("error");
      setServerMessage(
        content.states.error.replace("{CONTACT_TO_EMAIL}", supportEmail),
      );
      if (isTurnstileEnabled) {
        resetTurnstileWidget();
      }
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card p-6 sm:p-7" noValidate>
      <div className="space-y-5">
        <FormField
          label={content.fields.name}
          error={errors.name}
          htmlFor="contact-name"
          required
        >
          <input
            id="contact-name"
            name="name"
            type="text"
            className="input"
            autoComplete="name"
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? "contact-name-error" : undefined}
          />
        </FormField>

        <FormField
          label={content.fields.email}
          error={errors.email}
          htmlFor="contact-email"
          required
        >
          <input
            id="contact-email"
            name="email"
            type="email"
            className="input"
            autoComplete="email"
            value={form.email}
            onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "contact-email-error" : undefined}
          />
        </FormField>

        <FormField
          label={content.fields.queryType}
          error={errors.queryType}
          htmlFor="contact-query-type"
          required
        >
          <select
            id="contact-query-type"
            name="queryType"
            className="input"
            value={form.queryType}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, queryType: event.target.value }))
            }
            aria-invalid={Boolean(errors.queryType)}
            aria-describedby={
              errors.queryType ? "contact-query-type-error" : undefined
            }
          >
            {content.queryTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </FormField>

        <div className="grid gap-5 md:grid-cols-2">
          <FormField
            label={content.fields.destinationOrRegion}
            error={errors.destinationOrRegion}
            htmlFor="contact-destination-region"
          >
            <input
              id="contact-destination-region"
              name="destinationOrRegion"
              type="text"
              className="input"
              placeholder={content.placeholders.destinationOrRegion}
              value={form.destinationOrRegion}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  destinationOrRegion: event.target.value,
                }))
              }
              aria-invalid={Boolean(errors.destinationOrRegion)}
              aria-describedby={
                errors.destinationOrRegion
                  ? "contact-destination-region-error"
                  : undefined
              }
            />
          </FormField>

          <FormField
            label={content.fields.tripDates}
            error={errors.tripDates}
            htmlFor="contact-trip-dates"
          >
            <input
              id="contact-trip-dates"
              name="tripDates"
              type="text"
              className="input"
              placeholder={content.placeholders.tripDates}
              value={form.tripDates}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, tripDates: event.target.value }))
              }
              aria-invalid={Boolean(errors.tripDates)}
              aria-describedby={
                errors.tripDates ? "contact-trip-dates-error" : undefined
              }
            />
          </FormField>

          <FormField
            label={content.fields.numberOfPeople}
            error={errors.numberOfPeople}
            htmlFor="contact-number-of-people"
          >
            <input
              id="contact-number-of-people"
              name="numberOfPeople"
              type="number"
              min={MIN_NUMBER_OF_PEOPLE}
              max={MAX_NUMBER_OF_PEOPLE}
              inputMode="numeric"
              className="input"
              placeholder={content.placeholders.numberOfPeople}
              value={form.numberOfPeople}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, numberOfPeople: event.target.value }))
              }
              aria-invalid={Boolean(errors.numberOfPeople)}
              aria-describedby={
                errors.numberOfPeople ? "contact-number-of-people-error" : undefined
              }
            />
          </FormField>

          <FormField label={content.fields.budget} error={errors.budget} htmlFor="contact-budget">
            <input
              id="contact-budget"
              name="budget"
              type="text"
              className="input"
              placeholder={content.placeholders.budget}
              value={form.budget}
              onChange={(event) => setForm((prev) => ({ ...prev, budget: event.target.value }))}
              aria-invalid={Boolean(errors.budget)}
              aria-describedby={errors.budget ? "contact-budget-error" : undefined}
            />
          </FormField>
        </div>

        <FormField
          label={content.fields.message}
          error={errors.message}
          htmlFor="contact-message"
          required
        >
          <textarea
            id="contact-message"
            name="message"
            className="input min-h-32 resize-y"
            placeholder={content.placeholders.message}
            value={form.message}
            onChange={(event) => setForm((prev) => ({ ...prev, message: event.target.value }))}
            aria-invalid={Boolean(errors.message)}
            aria-describedby={errors.message ? "contact-message-error" : undefined}
          />
        </FormField>

        <div className="hidden" aria-hidden>
          <label htmlFor="contact-company">Company</label>
          <input
            id="contact-company"
            name="company"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={form.company}
            onChange={(event) => setForm((prev) => ({ ...prev, company: event.target.value }))}
          />
        </div>

        {isTurnstileEnabled ? (
          <div className="space-y-2">
            <Script
              src="https://challenges.cloudflare.com/turnstile/v0/api.js"
              strategy="afterInteractive"
              async
              defer
            />
            <div className="overflow-x-auto">
              <div
                className="cf-turnstile"
                data-sitekey={turnstileSiteKey}
                data-action="contact_form_submit"
              />
            </div>
            <p className="text-xs text-[var(--color-ink-600)]">
              This site is protected by Cloudflare Turnstile.
            </p>
          </div>
        ) : isDevelopment ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {TURNSTILE_DEV_BYPASS_MESSAGE}
          </p>
        ) : (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {TURNSTILE_UNAVAILABLE_MESSAGE}
          </p>
        )}

        <div>
          <label className="flex items-start gap-2 text-sm text-[var(--color-ink-700)]">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-[var(--color-ink-900)]"
              checked={form.consent}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, consent: event.target.checked }))
              }
            />
            <span>{content.fields.consent}</span>
          </label>
          {errors.consent ? (
            <p className="mt-2 text-xs font-medium text-red-700">{errors.consent}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-6 space-y-4">
        {submitState === "success" || submitState === "error" ? (
          <StatusBanner state={submitState} message={statusMessage} />
        ) : null}

        <button
          type="submit"
          className="btn-primary"
          disabled={
            submitState === "submitting" ||
            isProductionTurnstileMisconfigured ||
            !form.consent
          }
          aria-busy={submitState === "submitting"}
        >
          {submitState === "submitting" ? (
            <>
              <Spinner />
              <span>{content.states.submitting}</span>
            </>
          ) : (
            content.submitLabel
          )}
        </button>
      </div>
    </form>
  );
}

function StatusBanner({
  state,
  message,
}: {
  state: "success" | "error";
  message: string;
}) {
  if (state === "success") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
      >
        <CheckIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-600" />
        <div className="flex-1">
          <p className="font-semibold">Query sent successfully</p>
          <p className="mt-1 leading-relaxed text-emerald-800">{message}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
    >
      <WarnIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
      <div className="flex-1">
        <p className="font-semibold">We couldn&apos;t send your query</p>
        <p className="mt-1 leading-relaxed text-red-800">{message}</p>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function WarnIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    </svg>
  );
}

function FormField({
  label,
  htmlFor,
  error,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-2 block text-sm font-semibold text-[var(--color-ink-800)]"
      >
        {label}
        {required ? <span className="ml-1 text-[var(--color-brand-700)]">*</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="mt-2 text-xs font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function validate(form: FormState): FormErrorState {
  const nextErrors: FormErrorState = {};

  if (!form.name.trim()) {
    nextErrors.name = "Please enter your name.";
  } else if (form.name.trim().length > MAX_NAME_LENGTH) {
    nextErrors.name = `Name cannot exceed ${MAX_NAME_LENGTH} characters.`;
  }

  if (!form.email.trim()) {
    nextErrors.email = "Please enter an email address.";
  } else if (!EMAIL_PATTERN.test(form.email.trim())) {
    nextErrors.email = "Please enter a valid email address.";
  }

  if (!form.queryType.trim()) {
    nextErrors.queryType = "Please choose a query type.";
  }

  if (form.destinationOrRegion.trim().length > MAX_OPTIONAL_FIELD_LENGTH) {
    nextErrors.destinationOrRegion = `Please keep this under ${MAX_OPTIONAL_FIELD_LENGTH} characters.`;
  }

  if (form.tripDates.trim().length > MAX_OPTIONAL_FIELD_LENGTH) {
    nextErrors.tripDates = `Please keep this under ${MAX_OPTIONAL_FIELD_LENGTH} characters.`;
  }

  if (form.budget.trim().length > MAX_OPTIONAL_FIELD_LENGTH) {
    nextErrors.budget = `Please keep this under ${MAX_OPTIONAL_FIELD_LENGTH} characters.`;
  }

  const normalizedPeople = form.numberOfPeople.trim();
  if (normalizedPeople) {
    if (!/^\d+$/.test(normalizedPeople)) {
      nextErrors.numberOfPeople = "Please enter a valid number of people.";
    } else {
      const parsedPeople = Number.parseInt(normalizedPeople, 10);
      if (
        parsedPeople < MIN_NUMBER_OF_PEOPLE ||
        parsedPeople > MAX_NUMBER_OF_PEOPLE
      ) {
        nextErrors.numberOfPeople = `Please enter a value between ${MIN_NUMBER_OF_PEOPLE} and ${MAX_NUMBER_OF_PEOPLE}.`;
      }
    }
  }

  const messageLength = form.message.trim().length;
  if (!form.message.trim()) {
    nextErrors.message = "Please enter your message.";
  } else if (messageLength < MIN_MESSAGE_LENGTH) {
    nextErrors.message = `Message must be at least ${MIN_MESSAGE_LENGTH} characters.`;
  } else if (messageLength > MAX_MESSAGE_LENGTH) {
    nextErrors.message = `Message cannot exceed ${MAX_MESSAGE_LENGTH} characters.`;
  }

  if (!form.consent) {
    nextErrors.consent = "Please accept the terms to continue.";
  }

  return nextErrors;
}

function normalizeFieldErrors(payload: ContactApiResponse | null): FormErrorState {
  if (!payload?.fieldErrors) {
    return {};
  }

  const normalized: FormErrorState = {};
  for (const field of FORM_FIELDS) {
    const fieldMessages = payload.fieldErrors[field];
    if (!fieldMessages || fieldMessages.length === 0) {
      continue;
    }
    normalized[field] = fieldMessages[0];
  }

  return normalized;
}

function readTurnstileToken(formElement: HTMLFormElement): string {
  const formData = new FormData(formElement);
  const token = formData.get("cf-turnstile-response");
  return typeof token === "string" ? token.trim() : "";
}

function resetTurnstileWidget(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.turnstile?.reset();
  } catch {
    // Ignore widget reset failures and rely on server-side validation.
  }
}

function getStatusMessage(
  state: SubmitState,
  copy: ContactFormContent["states"],
  supportEmail: string,
  overrideMessage: string | null,
): string {
  if (overrideMessage) {
    return overrideMessage;
  }

  switch (state) {
    case "submitting":
      return copy.submitting;
    case "success":
      return copy.success;
    case "error":
      return copy.error.replace("{CONTACT_TO_EMAIL}", supportEmail);
    case "idle":
    default:
      return copy.idle;
  }
}
