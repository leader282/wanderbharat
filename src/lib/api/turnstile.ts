const TURNSTILE_VERIFY_ENDPOINT =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const TURNSTILE_CONFIGURATION_ERROR_CODES = new Set([
  "missing-input-secret",
  "invalid-input-secret",
]);

type TurnstileFailureReason =
  | "turnstile_not_configured"
  | "turnstile_missing_token"
  | "turnstile_verification_failed";

export type TurnstileVerificationResult =
  | {
      ok: true;
      bypassed: boolean;
    }
  | {
      ok: false;
      status: number;
      error: TurnstileFailureReason;
      message: string;
      errorCodes: string[];
    };

type VerifyTurnstileInput = {
  token: string | undefined;
  clientIp: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
};

type ParsedTurnstileResponse = {
  success: boolean;
  errorCodes: string[];
};

export async function verifyTurnstileToken({
  token,
  clientIp,
  env = process.env,
  fetchImpl = fetch,
}: VerifyTurnstileInput): Promise<TurnstileVerificationResult> {
  const isProduction = env.NODE_ENV === "production";
  const secretKey = env.TURNSTILE_SECRET_KEY?.trim();
  const siteKey = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  const normalizedToken = token?.trim();

  if (!isProduction && (!secretKey || !siteKey)) {
    return {
      ok: true,
      bypassed: true,
    };
  }

  if (!secretKey) {
    return {
      ok: false,
      status: 503,
      error: "turnstile_not_configured",
      message:
        "Contact submissions are temporarily unavailable. Please try again later.",
      errorCodes: [],
    };
  }

  if (!normalizedToken) {
    return {
      ok: false,
      status: 400,
      error: "turnstile_missing_token",
      message: "Please complete the security check and try again.",
      errorCodes: [],
    };
  }

  const requestBody = new URLSearchParams();
  requestBody.set("secret", secretKey);
  requestBody.set("response", normalizedToken);
  if (clientIp !== "unknown") {
    requestBody.set("remoteip", clientIp);
  }

  let response: Response;
  try {
    response = await fetchImpl(TURNSTILE_VERIFY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: requestBody.toString(),
      cache: "no-store",
    });
  } catch {
    return buildVerificationServiceErrorResult();
  }

  if (!response.ok) {
    return buildVerificationServiceErrorResult();
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return buildVerificationServiceErrorResult();
  }

  const parsedResponse = parseTurnstileResponse(payload);
  if (!parsedResponse) {
    return buildVerificationServiceErrorResult();
  }

  if (!parsedResponse.success) {
    if (parsedResponse.errorCodes.some((code) => TURNSTILE_CONFIGURATION_ERROR_CODES.has(code))) {
      return {
        ok: false,
        status: 503,
        error: "turnstile_not_configured",
        message:
          "Contact submissions are temporarily unavailable. Please try again later.",
        errorCodes: parsedResponse.errorCodes,
      };
    }

    return buildVerificationFailedResult(parsedResponse.errorCodes);
  }

  return {
    ok: true,
    bypassed: false,
  };
}

function buildVerificationFailedResult(errorCodes: string[]): TurnstileVerificationResult {
  return {
    ok: false,
    status: 400,
    error: "turnstile_verification_failed",
    message: "Please complete the security check and try again.",
    errorCodes,
  };
}

function buildVerificationServiceErrorResult(): TurnstileVerificationResult {
  return {
    ok: false,
    status: 502,
    error: "turnstile_verification_failed",
    message:
      "We could not verify the security check right now. Please try again.",
    errorCodes: [],
  };
}

function parseTurnstileResponse(payload: unknown): ParsedTurnstileResponse | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidate = payload as {
    success?: unknown;
    "error-codes"?: unknown;
  };

  if (typeof candidate.success !== "boolean") {
    return null;
  }

  const errorCodes = Array.isArray(candidate["error-codes"])
    ? candidate["error-codes"].filter((value): value is string => typeof value === "string")
    : [];

  return {
    success: candidate.success,
    errorCodes,
  };
}
