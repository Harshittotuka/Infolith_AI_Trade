import { gunzipSync } from "node:zlib";

const CATALOG_URLS = [
  "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz",
  "https://assets.upstox.com/market-quote/instruments/exchange/BSE.json.gz"
];
const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;

export const DEFAULT_INSTRUMENTS = [
  { key: "NSE_INDEX|Nifty 50", symbol: "NIFTY", name: "Nifty 50", type: "Index", exchange: "NSE" },
  { key: "NSE_INDEX|Nifty Bank", symbol: "BANKNIFTY", name: "Nifty Bank", type: "Index", exchange: "NSE" },
  { key: "BSE_INDEX|SENSEX", symbol: "SENSEX", name: "SENSEX", type: "Index", exchange: "BSE" },
  { key: "NSE_EQ|INE002A01018", symbol: "RELIANCE", name: "Reliance Industries", type: "Equity", exchange: "NSE" },
  { key: "NSE_EQ|INE062A01020", symbol: "SBIN", name: "State Bank of India", type: "Equity", exchange: "NSE" },
  { key: "NSE_EQ|INE467B01029", symbol: "TCS", name: "Tata Consultancy Services", type: "Equity", exchange: "NSE" },
  { key: "NSE_EQ|INE040A01034", symbol: "HDFCBANK", name: "HDFC Bank", type: "Equity", exchange: "NSE" },
  { key: "NSE_EQ|INE090A01021", symbol: "ICICIBANK", name: "ICICI Bank", type: "Equity", exchange: "NSE" },
  { key: "NSE_EQ|INE009A01021", symbol: "INFY", name: "Infosys", type: "Equity", exchange: "NSE" }
];

let catalogPromise = null;
let catalogLoadedAt = 0;

function instrumentType(item) {
  if (item.instrument_type === "INDEX") return "Index";
  if (item.instrument_type === "FUT") return "Future";
  if (item.instrument_type === "CE") return "Call option";
  if (item.instrument_type === "PE") return "Put option";
  return "Equity";
}

function normalizeInstrument(item) {
  return {
    key: item.instrument_key,
    symbol: item.trading_symbol || item.short_name || item.name,
    name: item.name || item.short_name || item.trading_symbol,
    type: instrumentType(item),
    exchange: item.exchange,
    segment: item.segment,
    expiry: item.expiry || null,
    strike: item.strike_price ?? null
  };
}

async function downloadCatalog() {
  const responses = await Promise.all(CATALOG_URLS.map((url) => fetch(url)));
  const failed = responses.find((response) => !response.ok);
  if (failed) {
    throw new Error(`Upstox instrument catalog returned ${failed.status}.`);
  }

  const lists = await Promise.all(
    responses.map(async (response) => {
      const compressed = Buffer.from(await response.arrayBuffer());
      return JSON.parse(gunzipSync(compressed).toString("utf8"));
    })
  );

  const seen = new Set();
  const catalog = [];
  for (const item of lists.flat()) {
    if (!item.instrument_key || !item.trading_symbol || seen.has(item.instrument_key)) continue;
    seen.add(item.instrument_key);
    catalog.push(normalizeInstrument(item));
  }
  catalogLoadedAt = Date.now();
  return catalog;
}

async function getCatalog() {
  if (!catalogPromise || Date.now() - catalogLoadedAt > CATALOG_TTL_MS) {
    catalogPromise = downloadCatalog().catch((error) => {
      catalogPromise = null;
      throw error;
    });
  }
  return catalogPromise;
}

function searchScore(instrument, query) {
  const symbol = instrument.symbol.toLowerCase();
  const name = instrument.name.toLowerCase();
  if (symbol === query || name === query) return 0;
  if (symbol.startsWith(query)) return 1;
  if (name.startsWith(query)) return 2;
  if (symbol.includes(query)) return 3;
  if (name.includes(query)) return 4;
  return 5;
}

export async function searchInstruments(query) {
  const normalized = String(query || "").trim().toLowerCase();
  if (!normalized) return DEFAULT_INSTRUMENTS;

  let catalog;
  try {
    catalog = await getCatalog();
  } catch {
    catalog = DEFAULT_INSTRUMENTS;
  }

  const terms = normalized.split(/\s+/).filter(Boolean);
  return catalog
    .filter((instrument) => {
      const haystack = [
        instrument.symbol,
        instrument.name,
        instrument.key,
        instrument.type,
        instrument.exchange,
        instrument.segment
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return terms.every((term) => haystack.includes(term));
    })
    .sort((left, right) => searchScore(left, normalized) - searchScore(right, normalized))
    .slice(0, 30);
}
