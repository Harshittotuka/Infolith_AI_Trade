# AI Trade Alerts

A modern local web app for stock, share, NIFTY, SENSEX, futures, and option alerts. It runs immediately with simulated prices, then switches to real Upstox quotes after you add your API credentials.

Supported alert metrics: last traded price, absolute change, percent change, volume, and open interest when the selected market-data provider returns those fields.

## Quick Start

```powershell
npm install
Copy-Item .env.example .env
npm start
```

Open `http://localhost:5175`.

## Upstox Setup

1. Create an app in the Upstox developer console.
2. Register `http://localhost:5175/auth/upstox/callback` as its redirect URL.
3. Copy `.env.example` to `.env`.
4. Add `UPSTOX_API_KEY` and `UPSTOX_API_SECRET`, then set `MARKET_PROVIDER=upstox`.
5. Start the app and click **Connect Upstox**.

Upstox access tokens normally expire at 3:30 AM on the following day, so the interactive login may need to be repeated daily. A manually generated token can also be placed in `UPSTOX_ACCESS_TOKEN`.

The picker searches the official Upstox NSE and BSE instrument catalogs, so it is not restricted to the small popular-instrument list shown before a search.

## Alert Channels

Email uses SMTP. Telegram sends instant mobile notifications through a bot. SMS supports Twilio and MSG91. MSG91 in India normally needs approved DLT templates, so configure the Flow/template before relying on live SMS alerts.

The **Channels** tab shows a separate health state for every delivery method:

- **Not configured**: required `.env` values are missing.
- **Ready to test**: credentials were detected, but delivery has not been confirmed in the current app session.
- **Verified**: the provider accepted a real test request; confirm the message arrived at its destination.
- **Needs attention**: the most recent delivery test failed and displays the provider error.

Secrets never reach the dashboard. Only masked destinations, provider names, and readiness states are returned by the status API. Restart the app after changing `.env`, then use **Send real test** for each configured channel.

This app does not place trades. It only watches conditions and notifies you. Keep it running on an always-on machine or server if alerts must continue when your laptop is closed.
