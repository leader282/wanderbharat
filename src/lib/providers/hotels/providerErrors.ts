export class ProviderDisabledError extends Error {
  readonly code = "provider_disabled";

  constructor(message = "Hotel provider is disabled.") {
    super(message);
    this.name = "ProviderDisabledError";
  }
}

export class ProviderTimeoutError extends Error {
  readonly code = "provider_timeout";
  readonly endpoint: string;
  readonly timeout_ms: number;

  constructor(args: { endpoint: string; timeoutMs: number }) {
    super(
      `Hotel provider request timed out for ${args.endpoint} after ${args.timeoutMs}ms.`,
    );
    this.name = "ProviderTimeoutError";
    this.endpoint = args.endpoint;
    this.timeout_ms = args.timeoutMs;
  }
}

export class ProviderResponseError extends Error {
  readonly code: string;
  readonly endpoint: string;
  readonly status: number | null;

  constructor(args: {
    code: string;
    endpoint: string;
    status?: number | null;
    message: string;
  }) {
    super(args.message);
    this.name = "ProviderResponseError";
    this.code = args.code;
    this.endpoint = args.endpoint;
    this.status = args.status ?? null;
  }
}
