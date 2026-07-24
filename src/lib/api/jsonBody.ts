export type JsonBodyReadResult =
  | {
      ok: true;
      body: unknown;
    }
  | {
      ok: false;
      status: 400 | 413;
      error: "invalid_json" | "payload_too_large";
      message: string;
    };

export async function readJsonBodyWithLimit(
  request: Request,
  maxBytes: number,
): Promise<JsonBodyReadResult> {
  const declaredLength = readDeclaredContentLength(request);
  if (declaredLength !== null && declaredLength > maxBytes) {
    return payloadTooLarge();
  }

  let raw = "";
  let bytesRead = 0;

  if (request.body) {
    const decoder = new TextDecoder();
    const reader = request.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytesRead += value.byteLength;
        if (bytesRead > maxBytes) {
          await reader.cancel();
          return payloadTooLarge();
        }
        raw += decoder.decode(value, { stream: true });
      }
      raw += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  }

  try {
    return {
      ok: true,
      body: JSON.parse(raw),
    };
  } catch {
    return {
      ok: false,
      status: 400,
      error: "invalid_json",
      message: "Request body must be valid JSON.",
    };
  }
}

function readDeclaredContentLength(request: Request): number | null {
  const header = request.headers.get("content-length");
  if (!header) return null;

  const parsed = Number.parseInt(header, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function payloadTooLarge(): JsonBodyReadResult {
  return {
    ok: false,
    status: 413,
    error: "payload_too_large",
    message: "Request payload is too large.",
  };
}
