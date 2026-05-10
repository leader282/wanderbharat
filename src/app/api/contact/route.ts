import { NextResponse } from "next/server";

import {
  contactSubmissionSchema,
  flattenContactFieldErrors,
} from "@/lib/api/contactValidation";
import {
  type TurnstileVerificationResult,
  verifyTurnstileToken,
} from "@/lib/api/turnstile";
import {
  sendContactEmail,
  type SendContactEmailResult,
} from "@/lib/email/contactMailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CONTENT_LENGTH_BYTES = 25_000;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;

const rateLimitWindowByClientIp = new Map<string, number[]>();

type RateLimitDecision =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      retryAfterSeconds: number;
    };

interface ContactRouteDependencies {
  checkRateLimit: (request: Request) => RateLimitDecision;
  verifyTurnstileToken: (
    token: string | undefined,
    clientIp: string,
  ) => Promise<TurnstileVerificationResult>;
  sendContactEmail: (body: Parameters<typeof sendContactEmail>[0]) => Promise<SendContactEmailResult>;
}

const defaultDependencies: ContactRouteDependencies = {
  checkRateLimit: checkContactRateLimit,
  verifyTurnstileToken: (token, clientIp) =>
    verifyTurnstileToken({
      token,
      clientIp,
    }),
  sendContactEmail: (body) => sendContactEmail(body),
};

export async function handleContactRequest(
  request: Request,
  deps: ContactRouteDependencies = defaultDependencies,
) {
  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = contentLengthHeader
    ? Number.parseInt(contentLengthHeader, 10)
    : null;

  if (
    contentLength !== null &&
    Number.isFinite(contentLength) &&
    contentLength > MAX_CONTENT_LENGTH_BYTES
  ) {
    return NextResponse.json(
      {
        error: "payload_too_large",
        message: "Request payload is too large.",
      },
      { status: 413 },
    );
  }

  const rateLimitDecision = deps.checkRateLimit(request);
  if (!rateLimitDecision.allowed) {
    return NextResponse.json(
      {
        error: "rate_limited",
        message: "Too many submissions. Please try again shortly.",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimitDecision.retryAfterSeconds),
        },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: "invalid_json",
        message: "Request body must be valid JSON.",
      },
      { status: 400 },
    );
  }

  const parsed = contactSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_input",
        message: "Please correct the highlighted fields.",
        fieldErrors: flattenContactFieldErrors(parsed.error),
      },
      { status: 400 },
    );
  }

  if (parsed.data.company && parsed.data.company.trim().length > 0) {
    return NextResponse.json(
      {
        ok: true,
        message: "Thanks. Your query has been received.",
      },
      { status: 202 },
    );
  }

  const clientIp = getClientIpAddress(request);
  const turnstileResult = await deps.verifyTurnstileToken(
    parsed.data.turnstileToken,
    clientIp,
  );
  if (!turnstileResult.ok) {
    return NextResponse.json(
      {
        error: turnstileResult.error,
        message: turnstileResult.message,
      },
      { status: turnstileResult.status },
    );
  }

  const sendResult = await deps.sendContactEmail(parsed.data);
  if (!sendResult.ok) {
    if (sendResult.reason === "missing_config") {
      return NextResponse.json(
        {
          error: "contact_unavailable",
          message:
            "Contact submissions are temporarily unavailable. Please try again later.",
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      {
        error: "delivery_failed",
        message:
          "We could not send your query right now. Please try again in a few minutes.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      message: "Thanks. Your query has been sent successfully.",
    },
    { status: 201 },
  );
}

export async function POST(request: Request) {
  return handleContactRequest(request);
}

function checkContactRateLimit(
  request: Request,
  nowMs: number = Date.now(),
): RateLimitDecision {
  const clientIp = getClientIpAddress(request);
  const windowStartMs = nowMs - RATE_LIMIT_WINDOW_MS;

  const existingWindow = rateLimitWindowByClientIp.get(clientIp) ?? [];
  const recentRequests = existingWindow.filter(
    (timestamp) => timestamp >= windowStartMs,
  );

  if (recentRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
    const oldestInWindow = recentRequests[0];
    const retryAfterMs = Math.max(RATE_LIMIT_WINDOW_MS - (nowMs - oldestInWindow), 1_000);
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1_000),
    };
  }

  recentRequests.push(nowMs);
  rateLimitWindowByClientIp.set(clientIp, recentRequests);
  trimExpiredRateLimitEntries(windowStartMs);

  return { allowed: true };
}

function trimExpiredRateLimitEntries(windowStartMs: number): void {
  for (const [ip, timestamps] of rateLimitWindowByClientIp.entries()) {
    const recent = timestamps.filter((timestamp) => timestamp >= windowStartMs);
    if (recent.length === 0) {
      rateLimitWindowByClientIp.delete(ip);
      continue;
    }
    rateLimitWindowByClientIp.set(ip, recent);
  }
}

function getClientIpAddress(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp?.trim()) {
    return realIp.trim();
  }

  return "unknown";
}
