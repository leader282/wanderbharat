import LiteApiTestConsole from "@/app/admin/liteapi-test/LiteApiTestConsole";
import { resolveLiteApiProviderConfig } from "@/lib/providers/hotels/liteApiConfig";

export default function AdminLiteApiTestPage() {
  const config = resolveLiteApiProviderConfig();

  return (
    <LiteApiTestConsole
      defaults={{
        countryCode: "IN",
        radiusMeters: 5_000,
        adults: 2,
        rooms: 1,
        currency: "INR",
        guestNationality: "IN",
        maxResults: config.maxResults,
        checkinDate: buildFutureIsoDate(14),
        checkoutDate: buildFutureIsoDate(15),
      }}
      providerStatus={{
        enabledFlag: config.enabled,
        apiKeyPresent: Boolean(config.apiKey),
        available: config.enabled && Boolean(config.apiKey),
        timeoutMs: config.timeoutMs,
      }}
    />
  );
}

function buildFutureIsoDate(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}
