export type ContentBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: readonly string[] };

export type ContentSection = {
  id: string;
  title: string;
  blocks: readonly ContentBlock[];
};

export type CtaLink = {
  href: string;
  label: string;
  variant?: "primary" | "secondary" | "tertiary";
};

export const PUBLIC_BETA_DISCLAIMER =
  "WanderBharat is currently in public beta. Itineraries are for planning assistance only. Please verify routes, bookings, costs, weather, permits, opening hours, and safety conditions before travelling.";

export const aboutContent = {
  meta: {
    title: "About",
    description:
      "WanderBharat is an India-first trip planner that turns your dates, budget, and pace into a practical day-by-day itinerary.",
    canonical: "/about",
  },
  eyebrow: "About WanderBharat",
  title: "Travel planning, made for India",
  intro:
    "WanderBharat is built for the way people travel across India: by region, by road, by rail, with family, with friends, and on real budgets. We turn your trip preferences into day-by-day plans that are practical and easy to use.",
  sections: [
    {
      id: "why",
      title: "Why we built this",
      blocks: [
        {
          type: "paragraph",
          text: "Planning in India often means juggling blogs, maps, and scattered notes. Most plans either look great on paper or fit real travel constraints - rarely both.",
        },
        {
          type: "paragraph",
          text: "We built WanderBharat to bridge that gap: a planner that understands routes, pace, and budget, so your itinerary is useful in the real world.",
        },
      ],
    },
    {
      id: "what-we-do",
      title: "What WanderBharat does today",
      blocks: [
        {
          type: "list",
          items: [
            "Builds day-by-day itineraries from your destination, duration, budget, and pace.",
            "Uses map-aware sequencing so city order is practical, not random.",
            "Shows estimated travel times and planning assumptions clearly.",
            "Provides budget estimates with transparent, trip-level context.",
            "Saves generated itineraries for signed-in users.",
          ],
        },
      ],
    },
    {
      id: "what-we-do-not-do",
      title: "What we do not do",
      blocks: [
        {
          type: "paragraph",
          text: "WanderBharat does not book hotels, flights, trains, buses, or cabs, and we do not process payments. We are a planning tool, not a booking platform.",
        },
      ],
    },
    {
      id: "beta-note",
      title: "Public beta status",
      blocks: [
        {
          type: "paragraph",
          text: "WanderBharat is currently in public beta. The planner is usable today, but we are actively improving coverage, cost models, and overall reliability based on real feedback.",
        },
      ],
    },
  ] as const satisfies readonly ContentSection[],
  ctas: [
    { href: "/plan", label: "Plan my trip", variant: "primary" },
    { href: "/faq", label: "Read FAQ", variant: "secondary" },
    { href: "/contact", label: "Submit a query", variant: "tertiary" },
  ] as const satisfies readonly CtaLink[],
} as const;

export type FaqItem = {
  id: string;
  category: "Using the planner" | "Beta and estimates" | "Account and data";
  question: string;
  answer: string;
};

export const faqItems: readonly FaqItem[] = [
  {
    id: "what-is-wanderbharat",
    category: "Using the planner",
    question: "What is WanderBharat?",
    answer:
      "WanderBharat is an India-first trip planner. You share your destination, duration, budget, pace, and preferences, and it generates a day-by-day itinerary.",
  },
  {
    id: "public-beta",
    category: "Beta and estimates",
    question: "Is WanderBharat in beta?",
    answer:
      "Yes. WanderBharat is in public beta. Core planning works, but we are still improving destination coverage and recommendation quality.",
  },
  {
    id: "how-plans-are-generated",
    category: "Using the planner",
    question: "How are itineraries generated?",
    answer:
      "We use a map-aware planning engine that considers region, trip length, budget, pace, group size, and your travel preferences to produce a practical route and schedule.",
  },
  {
    id: "booking-support",
    category: "Using the planner",
    question: "Can I book hotels or transport on WanderBharat?",
    answer:
      "No. WanderBharat does not handle bookings or payments. You should book directly with your preferred providers.",
  },
  {
    id: "budget-accuracy",
    category: "Beta and estimates",
    question: "How accurate are budget estimates?",
    answer:
      "Budgets are directional estimates based on your input and available data. Actual spend can vary by season, availability, and your booking choices.",
  },
  {
    id: "time-accuracy",
    category: "Beta and estimates",
    question: "Are travel times exact?",
    answer:
      "No. Travel times are estimates and can change due to traffic, road work, weather, and local conditions.",
  },
  {
    id: "what-to-verify",
    category: "Beta and estimates",
    question: "What should I verify before travelling?",
    answer:
      "Please verify bookings, weather, route conditions, permit requirements, attraction opening hours, and local safety advisories before your trip.",
  },
  {
    id: "sign-in-required",
    category: "Account and data",
    question: "Do I need to sign in to use the planner?",
    answer:
      "You can generate trips as a guest. Sign-in is useful if you want itineraries saved to your account.",
  },
  {
    id: "google-sign-in",
    category: "Account and data",
    question: "Do you support Google sign-in?",
    answer:
      "Yes. If enabled on your account, Google sign-in is used to help you access saved itineraries securely.",
  },
  {
    id: "saved-trips",
    category: "Account and data",
    question: "Where can I find my saved itineraries?",
    answer:
      "Signed-in users can view saved itineraries from the My Trips page.",
  },
  {
    id: "delete-data",
    category: "Account and data",
    question: "How do I request data deletion?",
    answer:
      "Send a deletion request to {CONTACT_TO_EMAIL} from your account email. We aim to process requests within 14 days.",
  },
  {
    id: "support",
    category: "Account and data",
    question: "How can I report issues or suggestions?",
    answer:
      "Use the contact page or write to {CONTACT_TO_EMAIL} with details. Feedback during beta directly shapes the roadmap.",
  },
];

export const contactContent = {
  meta: {
    title: "Contact",
    description:
      "Send WanderBharat your questions, feedback, and issue reports. We usually reply within two business days.",
    canonical: "/contact",
  },
  eyebrow: "Contact",
  title: "Submit your query",
  intro:
    "Questions, bug reports, partnership requests, or destination suggestions - we read every message and respond as quickly as we can during beta.",
  supportEmailPlaceholder: "{CONTACT_TO_EMAIL}",
  responseTime: "Typical response time: 2 business days",
  form: {
    fields: {
      name: "Your name",
      email: "Email address",
      queryType: "Query type",
      destinationOrRegion: "Destination or region (optional)",
      tripDates: "Trip dates (optional)",
      numberOfPeople: "Number of people (optional)",
      budget: "Budget (optional)",
      message: "Your message",
      consent:
        "I agree to the Privacy Policy and Terms of Use and consent to being contacted about this query.",
    },
    queryTypeOptions: [
      { value: "Trip help", label: "Trip help" },
      { value: "Destination request", label: "Destination request" },
      { value: "Bug report", label: "Bug report" },
      { value: "Partnership", label: "Partnership" },
      { value: "General", label: "General" },
    ],
    placeholders: {
      destinationOrRegion: "Example: Sikkim, Meghalaya, or Leh-Ladakh",
      tripDates: "Example: 10-16 Jun 2026",
      numberOfPeople: "Example: 4",
      budget: "Example: INR 40,000 to 60,000",
      message: "Share details so we can help you quickly.",
    },
    submitLabel: "Send query",
    privacyNote:
      "We use your query details only to support your request and improve WanderBharat. We do not sell personal data.",
    states: {
      idle: "Share what you need, and include trip context so we can help faster.",
      submitting: "Sending your query...",
      success: "Thanks! Your query has been received.",
      error:
        "We could not send your query right now. Please try again or email {CONTACT_TO_EMAIL}.",
      rateLimited:
        "Too many attempts in a short time. Please wait a few minutes before trying again.",
    },
  },
} as const;

export const privacyPolicyMeta = {
  title: "Privacy Policy",
  description:
    "How WanderBharat collects, uses, stores, and handles account, planning, and query data in public beta.",
  canonical: "/privacy",
  effectiveDate: "{EFFECTIVE_DATE}",
} as const;

export const privacyPolicySections: readonly ContentSection[] = [
  {
    id: "who-we-are",
    title: "1. Who we are",
    blocks: [
      {
        type: "paragraph",
        text: "WanderBharat is operated by {OPERATOR_NAME} from {OPERATOR_LOCATION}. Contact us at {CONTACT_TO_EMAIL} for privacy requests.",
      },
    ],
  },
  {
    id: "data-we-collect",
    title: "2. Data we collect",
    blocks: [
      {
        type: "list",
        items: [
          "Trip planning preferences (destination, budget, pace, group size, dates, and related inputs).",
          "Account data when you sign in, including Google profile basics if enabled.",
          "Messages you send through the contact form or support email inbox.",
          "Basic technical logs needed for reliability and security.",
          "If analytics is added later, we will update this policy before enabling it.",
        ],
      },
    ],
  },
  {
    id: "how-we-use-data",
    title: "3. How we use data",
    blocks: [
      {
        type: "list",
        items: [
          "Generate itineraries and show planning results.",
          "Store and retrieve saved trips for signed-in users.",
          "Respond to support and product feedback queries.",
          "Maintain service quality, security, and reliability.",
        ],
      },
    ],
  },
  {
    id: "services-and-processors",
    title: "4. Services and processors",
    blocks: [
      {
        type: "paragraph",
        text: "WanderBharat uses third-party infrastructure such as Firebase Authentication, Firestore, and map/hotel-data providers to run the service. These providers process data on our behalf under their own terms.",
      },
    ],
  },
  {
    id: "cookies",
    title: "5. Cookies and sessions",
    blocks: [
      {
        type: "paragraph",
        text: "We use session mechanisms required for sign-in and core product functionality. We do not run advertising trackers.",
      },
    ],
  },
  {
    id: "query-data",
    title: "6. Contact/query data",
    blocks: [
      {
        type: "paragraph",
        text: "When you email us, we process your name, email, message, and context to handle support, bug reports, and product improvements.",
      },
    ],
  },
  {
    id: "retention",
    title: "7. Data retention",
    blocks: [
      {
        type: "paragraph",
        text: "We keep data only as long as needed for product operation, support, and legal obligations. You may request deletion at any time via {CONTACT_TO_EMAIL}.",
      },
    ],
  },
  {
    id: "deletion-rights",
    title: "8. Deletion requests",
    blocks: [
      {
        type: "paragraph",
        text: "To request account or data deletion, email {CONTACT_TO_EMAIL} from your account email address. We aim to process verified requests within 14 days.",
      },
    ],
  },
  {
    id: "security",
    title: "9. Security",
    blocks: [
      {
        type: "paragraph",
        text: "We use practical technical and administrative safeguards. No system is perfectly secure, but we continuously improve controls appropriate for a beta-stage product.",
      },
    ],
  },
  {
    id: "changes",
    title: "10. Changes to this policy",
    blocks: [
      {
        type: "paragraph",
        text: "We may update this policy as WanderBharat evolves. We will update the effective date whenever material changes are made.",
      },
    ],
  },
];

export const termsMeta = {
  title: "Terms of Use",
  description:
    "Terms that govern use of WanderBharat, including planning-assistance disclaimers and limitation of liability.",
  canonical: "/terms",
  effectiveDate: "{EFFECTIVE_DATE}",
} as const;

export const termsSections: readonly ContentSection[] = [
  {
    id: "acceptance",
    title: "1. Acceptance",
    blocks: [
      {
        type: "paragraph",
        text: "By using WanderBharat, you agree to these Terms of Use. If you do not agree, please do not use the service.",
      },
    ],
  },
  {
    id: "service-scope",
    title: "2. Service scope",
    blocks: [
      {
        type: "paragraph",
        text: "WanderBharat provides travel-planning assistance for trips within India. It is not a booking or transaction platform.",
      },
    ],
  },
  {
    id: "public-beta",
    title: "3. Public beta",
    blocks: [
      {
        type: "paragraph",
        text: "The service is offered in public beta. Features, availability, and outputs may change as we improve the product.",
      },
    ],
  },
  {
    id: "no-bookings",
    title: "4. No bookings or payments",
    blocks: [
      {
        type: "paragraph",
        text: "WanderBharat does not book hotels, flights, trains, buses, or cabs, and does not process payments.",
      },
    ],
  },
  {
    id: "planning-disclaimer",
    title: "5. Planning-assistance disclaimer",
    blocks: [
      {
        type: "paragraph",
        text: `${PUBLIC_BETA_DISCLAIMER} Outputs are not a substitute for official advisories, provider terms, or your own judgment.`,
      },
    ],
  },
  {
    id: "user-responsibility",
    title: "6. User responsibilities",
    blocks: [
      {
        type: "list",
        items: [
          "Provide accurate planning inputs.",
          "Review plan outputs before acting on them.",
          "Verify all third-party booking details independently.",
          "Use the service lawfully and responsibly.",
        ],
      },
    ],
  },
  {
    id: "accounts",
    title: "7. Accounts and access",
    blocks: [
      {
        type: "paragraph",
        text: "If you use sign-in features, you are responsible for your account activity and for keeping access credentials secure.",
      },
    ],
  },
  {
    id: "third-party-services",
    title: "8. Third-party services",
    blocks: [
      {
        type: "paragraph",
        text: "WanderBharat relies on external infrastructure and data providers. We are not responsible for third-party availability, pricing, policy changes, or booking outcomes.",
      },
    ],
  },
  {
    id: "limitation-of-liability",
    title: "9. Limitation of liability",
    blocks: [
      {
        type: "paragraph",
        text: "To the extent permitted by law, WanderBharat is not liable for indirect or consequential losses arising from use of planning outputs. Travel decisions remain the user's responsibility.",
      },
    ],
  },
  {
    id: "updates",
    title: "10. Updates to terms",
    blocks: [
      {
        type: "paragraph",
        text: "We may update these terms over time. Continued use after updates means you accept the revised terms.",
      },
    ],
  },
  {
    id: "governing-law",
    title: "11. Governing law",
    blocks: [
      {
        type: "paragraph",
        text: "These terms are governed by the laws of India, with jurisdiction in courts located in {GOVERNING_LAW_STATE}.",
      },
    ],
  },
  {
    id: "contact",
    title: "12. Contact",
    blocks: [
      {
        type: "paragraph",
        text: "For legal or terms-related questions, contact {CONTACT_TO_EMAIL}.",
      },
    ],
  },
];

export const betaBannerContent = {
  homepage: {
    eyebrow: "Public beta",
    title: "WanderBharat is now in public beta",
    body: PUBLIC_BETA_DISCLAIMER,
    links: [
      { href: "/faq#public-beta", label: "Read beta FAQ" },
      { href: "/contact", label: "Submit feedback" },
    ],
  },
  planner: {
    eyebrow: "Beta notice",
    body: PUBLIC_BETA_DISCLAIMER,
    link: { href: "/faq#what-to-verify", label: "What to verify" },
  },
} as const;

export const footerLinks = {
  columns: [
    {
      title: "Product",
      links: [
        { href: "/plan", label: "Plan a trip" },
        { href: "/#destinations", label: "Destinations" },
        { href: "/#how-it-works", label: "How it works" },
        { href: "/trips", label: "My trips" },
      ],
    },
    {
      title: "Company",
      links: [
        { href: "/about", label: "About" },
        { href: "/faq", label: "FAQ" },
        { href: "/contact", label: "Contact" },
      ],
    },
    {
      title: "Legal",
      links: [
        { href: "/privacy", label: "Privacy Policy" },
        { href: "/terms", label: "Terms of Use" },
      ],
    },
  ],
  tagline:
    "A map-aware trip planner for India. Day-by-day itineraries built around your pace and budget.",
  betaNote:
    "Public beta: WanderBharat itineraries are for planning assistance only. Please verify key travel details before travelling.",
  copyright:
    "© {year} WanderBharat. Thoughtfully planned trips across India.",
  badges: ["Made in India", "Public beta"],
} as const;

export function replaceLaunchTokens(
  text: string,
  values: Record<string, string>,
): string {
  return text.replace(/\{([A-Z0-9_]+)\}/g, (_, key: string) => {
    return values[key] ?? `{${key}}`;
  });
}
