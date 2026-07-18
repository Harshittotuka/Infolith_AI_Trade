import protobuf from "protobufjs";
import WebSocket from "ws";

const AUTHORIZE_URL = "https://api.upstox.com/v3/feed/market-data-feed/authorize";

const PROTO_SOURCE = `
syntax = "proto3";
package com.upstox.marketdatafeederv3udapi.rpc.proto;

message LTPC { double ltp = 1; int64 ltt = 2; int64 ltq = 3; double cp = 4; }
message MarketLevel { repeated Quote bidAskQuote = 1; }
message MarketOHLC { repeated OHLC ohlc = 1; }
message Quote { int64 bidQ = 1; double bidP = 2; int64 askQ = 3; double askP = 4; }
message OptionGreeks { double delta = 1; double theta = 2; double gamma = 3; double vega = 4; double rho = 5; }
message OHLC { string interval = 1; double open = 2; double high = 3; double low = 4; double close = 5; int64 vol = 6; int64 ts = 7; }
enum Type { initial_feed = 0; live_feed = 1; market_info = 2; }
message MarketFullFeed { LTPC ltpc = 1; MarketLevel marketLevel = 2; OptionGreeks optionGreeks = 3; MarketOHLC marketOHLC = 4; double atp = 5; int64 vtt = 6; double oi = 7; double iv = 8; double tbq = 9; double tsq = 10; }
message IndexFullFeed { LTPC ltpc = 1; MarketOHLC marketOHLC = 2; }
message FullFeed { oneof FullFeedUnion { MarketFullFeed marketFF = 1; IndexFullFeed indexFF = 2; } }
message FirstLevelWithGreeks { LTPC ltpc = 1; Quote firstDepth = 2; OptionGreeks optionGreeks = 3; int64 vtt = 4; double oi = 5; double iv = 6; }
message Feed { oneof FeedUnion { LTPC ltpc = 1; FullFeed fullFeed = 2; FirstLevelWithGreeks firstLevelWithGreeks = 3; } RequestMode requestMode = 4; }
enum RequestMode { ltpc = 0; full_d5 = 1; option_greeks = 2; full_d30 = 3; }
enum MarketStatus { PRE_OPEN_START = 0; PRE_OPEN_END = 1; NORMAL_OPEN = 2; NORMAL_CLOSE = 3; CLOSING_START = 4; CLOSING_END = 5; }
message MarketInfo { map<string, MarketStatus> segmentStatus = 1; }
message FeedResponse { Type type = 1; map<string, Feed> feeds = 2; int64 currentTs = 3; MarketInfo marketInfo = 4; }
`;

const FeedResponse = protobuf.parse(PROTO_SOURCE).root.lookupType(
  "com.upstox.marketdatafeederv3udapi.rpc.proto.FeedResponse"
);

const RECONNECT_MIN_MS = 2000;
const RECONNECT_MAX_MS = 30000;

function num(value) {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function extractLtpc(feed) {
  if (feed.ltpc) return feed.ltpc;
  if (feed.fullFeed?.marketFF?.ltpc) return feed.fullFeed.marketFF.ltpc;
  if (feed.fullFeed?.indexFF?.ltpc) return feed.fullFeed.indexFF.ltpc;
  if (feed.firstLevelWithGreeks?.ltpc) return feed.firstLevelWithGreeks.ltpc;
  return null;
}

function extractOhlc(feed) {
  const list =
    feed.fullFeed?.marketFF?.marketOHLC?.ohlc ||
    feed.fullFeed?.indexFF?.marketOHLC?.ohlc ||
    [];
  const daily = list.find((item) => item.interval === "1d" || item.interval === "day");
  const source = daily || list[list.length - 1];
  if (!source) return null;
  return {
    open: num(source.open),
    high: num(source.high),
    low: num(source.low),
    close: num(source.close)
  };
}

function feedToQuote(instrument, feed) {
  const ltpc = extractLtpc(feed);
  if (!ltpc) return null;

  const marketFF = feed.fullFeed?.marketFF;
  const lastPrice = num(ltpc.ltp);
  const close = num(ltpc.cp);
  const change = close ? lastPrice - close : 0;
  const ohlc = extractOhlc(feed) || (close ? { open: close, high: lastPrice, low: lastPrice, close } : null);

  return {
    instrument,
    providerInstrument: null,
    symbol: null,
    last_price: lastPrice,
    change: Number(change.toFixed(2)),
    percent_change: close ? Number(((change / close) * 100).toFixed(2)) : null,
    volume: marketFF ? num(marketFF.vtt) : null,
    oi: marketFF ? num(marketFF.oi) : null,
    ohlc,
    depth: null,
    source: "upstox-feed",
    timestamp: ltpc.ltt ? new Date(num(ltpc.ltt)).toISOString() : new Date().toISOString()
  };
}

export function createUpstoxFeed({ getAccessToken, resolveInstrument, mode, onQuote, onStatus, onError }) {
  const feedMode = mode || process.env.UPSTOX_FEED_MODE || "full";

  let socket = null;
  let started = false;
  let connected = false;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let guidCounter = 0;

  // requested alert instrument -> resolved upstox key, and the reverse.
  const requestedToKey = new Map();
  const keyToRequested = new Map();
  let desiredKeys = new Set();
  let subscribedKeys = new Set();

  function setStatus(patch) {
    onStatus?.({ connected, subscribed: subscribedKeys.size, mode: feedMode, ...patch });
  }

  function nextGuid() {
    guidCounter += 1;
    return `signaldesk-${guidCounter}`;
  }

  function send(message) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(Buffer.from(JSON.stringify(message)));
    return true;
  }

  function subscribe(keys) {
    if (keys.length === 0) return;
    send({ guid: nextGuid(), method: "sub", data: { mode: feedMode, instrumentKeys: keys } });
  }

  function unsubscribe(keys) {
    if (keys.length === 0) return;
    send({ guid: nextGuid(), method: "unsub", data: { instrumentKeys: keys } });
  }

  function syncSubscriptions() {
    if (!connected) return;
    const desired = desiredKeys;
    const toAdd = [...desired].filter((key) => !subscribedKeys.has(key));
    const toRemove = [...subscribedKeys].filter((key) => !desired.has(key));
    subscribe(toAdd);
    unsubscribe(toRemove);
    subscribedKeys = new Set(desired);
    setStatus({});
  }

  function handleMessage(raw) {
    let decoded;
    try {
      decoded = FeedResponse.toObject(FeedResponse.decode(raw), { longs: Number, defaults: true });
    } catch (error) {
      onError?.(new Error(`Failed to decode market feed message: ${error.message}`));
      return;
    }

    const feeds = decoded.feeds || {};
    for (const [key, feed] of Object.entries(feeds)) {
      const requested = keyToRequested.get(key) || key;
      const quote = feedToQuote(requested, feed);
      if (quote) onQuote?.(quote);
    }
  }

  function scheduleReconnect() {
    if (!started || reconnectTimer) return;
    const delay = Math.min(RECONNECT_MIN_MS * 2 ** reconnectAttempts, RECONNECT_MAX_MS);
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect().catch((error) => {
        onError?.(error);
        scheduleReconnect();
      });
    }, delay);
  }

  async function authorize() {
    const accessToken = getAccessToken();
    if (!accessToken) throw new Error("Upstox is not connected. Cannot start the live market feed.");

    const response = await fetch(AUTHORIZE_URL, {
      headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` }
    });
    const payload = await response.json().catch(() => ({}));
    const uri = payload?.data?.authorized_redirect_uri || payload?.data?.authorizedRedirectUri;
    if (!response.ok || !uri) {
      throw new Error(payload?.errors?.[0]?.message || payload?.message || "Failed to authorize the Upstox market feed.");
    }
    return uri;
  }

  async function connect() {
    if (!started) return;
    const wssUrl = await authorize();

    socket = new WebSocket(wssUrl, { followRedirects: true });
    socket.binaryType = "nodebuffer";

    socket.on("open", () => {
      connected = true;
      reconnectAttempts = 0;
      subscribedKeys = new Set();
      syncSubscriptions();
      setStatus({});
    });

    socket.on("message", (data) => {
      handleMessage(data instanceof Buffer ? data : Buffer.from(data));
    });

    socket.on("error", (error) => {
      onError?.(new Error(`Market feed socket error: ${error.message}`));
    });

    socket.on("close", () => {
      connected = false;
      socket = null;
      setStatus({});
      scheduleReconnect();
    });
  }

  return {
    get connected() {
      return connected;
    },
    status() {
      return { connected, subscribed: subscribedKeys.size, mode: feedMode, started };
    },
    async setInstruments(instruments) {
      const unique = [...new Set(instruments)];
      for (const instrument of unique) {
        if (requestedToKey.has(instrument)) continue;
        try {
          const key = await resolveInstrument(instrument);
          requestedToKey.set(instrument, key);
          keyToRequested.set(key, instrument);
        } catch (error) {
          onError?.(new Error(`Could not map ${instrument} for the live feed: ${error.message}`));
        }
      }
      desiredKeys = new Set(
        unique.map((instrument) => requestedToKey.get(instrument)).filter(Boolean)
      );
      syncSubscriptions();
    },
    async start() {
      if (started) return;
      started = true;
      try {
        await connect();
      } catch (error) {
        onError?.(error);
        scheduleReconnect();
      }
    },
    stop() {
      started = false;
      connected = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (socket) {
        socket.removeAllListeners();
        socket.close();
        socket = null;
      }
      subscribedKeys = new Set();
    }
  };
}
