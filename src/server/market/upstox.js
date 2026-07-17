const API_BASE = "https://api.upstox.com/v2";
const LEGACY_KEYS = new Map([
  ["NSE:NIFTY 50", "NSE_INDEX|Nifty 50"],
  ["NSE:NIFTY BANK", "NSE_INDEX|Nifty Bank"],
  ["BSE:SENSEX", "BSE_INDEX|SENSEX"],
  ["NSE:RELIANCE", "NSE_EQ|INE002A01018"],
  ["NSE:SBIN", "NSE_EQ|INE062A01020"],
  ["NSE:TCS", "NSE_EQ|INE467B01029"],
  ["NSE:HDFCBANK", "NSE_EQ|INE040A01034"],
  ["NSE:ICICIBANK", "NSE_EQ|INE090A01021"],
  ["NSE:INFY", "NSE_EQ|INE009A01021"]
]);

function errorMessage(payload, fallback) {
  return payload?.errors?.[0]?.message || payload?.message || fallback;
}

function normalizeQuote(requestedInstrument, quote) {
  if (!quote) return null;
  const close = Number(quote.ohlc?.close || 0);
  const change = Number(quote.net_change ?? (close ? quote.last_price - close : 0));

  return {
    instrument: requestedInstrument,
    providerInstrument: quote.instrument_token || null,
    symbol: quote.symbol || null,
    last_price: Number(quote.last_price),
    change,
    percent_change: close ? Number(((change / close) * 100).toFixed(2)) : null,
    volume: quote.volume ?? null,
    oi: quote.oi ?? null,
    ohlc: quote.ohlc || null,
    depth: quote.depth || null,
    source: "upstox",
    timestamp: quote.timestamp || new Date().toISOString()
  };
}

export function createUpstoxProvider({ store }) {
  const resolvedLegacyKeys = new Map(LEGACY_KEYS);

  function session() {
    return store.getUpstoxSession();
  }

  function getAccessToken() {
    return process.env.UPSTOX_ACCESS_TOKEN || session()?.access_token || "";
  }

  async function authorizedFetch(url, options = {}) {
    const accessToken = getAccessToken();
    if (!accessToken) {
      throw new Error("Upstox is not connected. Add credentials and connect your Upstox account.");
    }

    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(options.headers || {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.status === "error") {
      throw new Error(errorMessage(payload, `Upstox request failed with ${response.status}.`));
    }
    return payload;
  }

  async function resolveInstrument(instrument) {
    if (instrument.includes("|")) return instrument;
    if (resolvedLegacyKeys.has(instrument)) return resolvedLegacyKeys.get(instrument);

    const [exchange, ...symbolParts] = instrument.split(":");
    const symbol = symbolParts.join(":").trim();
    if (!exchange || !symbol) {
      throw new Error(`Invalid Upstox instrument: ${instrument}`);
    }

    const url = new URL(`${API_BASE}/instruments/search`);
    url.searchParams.set("query", symbol);
    url.searchParams.set("exchanges", exchange);
    url.searchParams.set("records", "30");
    const payload = await authorizedFetch(url);
    const matches = Array.isArray(payload.data) ? payload.data : [];
    const exact = matches.find((item) => item.trading_symbol?.toUpperCase() === symbol.toUpperCase());
    const match = exact || matches[0];
    if (!match?.instrument_key) {
      throw new Error(`Could not map ${instrument} to an Upstox instrument key.`);
    }
    resolvedLegacyKeys.set(instrument, match.instrument_key);
    return match.instrument_key;
  }

  return {
    name: "upstox",
    async getQuotes(instruments) {
      const resolved = await Promise.all(
        instruments.map(async (instrument) => ({
          requested: instrument,
          key: await resolveInstrument(instrument)
        }))
      );
      const uniqueKeys = [...new Set(resolved.map((item) => item.key))];
      const quotesByInstrument = new Map();

      for (let index = 0; index < uniqueKeys.length; index += 500) {
        const url = new URL(`${API_BASE}/market-quote/quotes`);
        url.searchParams.set("instrument_key", uniqueKeys.slice(index, index + 500).join(","));
        const payload = await authorizedFetch(url);
        for (const quote of Object.values(payload.data || {})) {
          if (quote?.instrument_token) quotesByInstrument.set(quote.instrument_token, quote);
        }
      }

      return resolved
        .map((item) => normalizeQuote(item.requested, quotesByInstrument.get(item.key)))
        .filter(Boolean);
    },
    async status() {
      const currentSession = session();
      return {
        provider: "upstox",
        configured: Boolean(process.env.UPSTOX_API_KEY && process.env.UPSTOX_API_SECRET),
        connected: Boolean(getAccessToken()),
        user: currentSession?.user_name || currentSession?.user_id || null,
        mode: "Upstox live market data"
      };
    }
  };
}
