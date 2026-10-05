# GEOD Mining Dashboard

A static web dashboard for monitoring GEOD mining operations. Features Neo-Industrial design with real-time price tracking, portfolio value, and mining rewards.

## Features

- **Live GEOD Price** - Current price and 24h change from DexScreener
- **Portfolio Value** - Total GEOD holdings with USD conversion
- **Chart** - Portfolio value over time with GEOD mined per day/week (optional price line)
- **Transactions** - Plain-language list of mining rewards, buys, sells, deposits and transfers, each linked to Solscan/Polygonscan as proof
- **Investment Summary** - Money put in vs. what the wallet is worth today, total GEOD mined, and how it is split between partners
- **Polygon History** - An old Polygon wallet can be included; its history is read live from Blockscout's public API and cached in the browser
- **Auto-Refresh** - Updates every 60 seconds

## Quick Start

### 1. Get API Keys

**Helius (Required - for Solana data)**
1. Go to https://dev.helius.xyz/
2. Sign up for a free account
3. Create a new API key
4. Free tier: 1M credits/month

**CoinGecko (Required - for price chart)**
1. Go to https://www.coingecko.com/en/api/pricing
2. Sign up for free "Analyst" tier
3. Get your API key (starts with `CG-`)
4. Free tier: 50 calls/minute

### 2. Access the Dashboard

All settings travel in the link, so nothing personal is stored in the repo. Open `setup.html`, fill in the JSON and press "Crea link": it produces `index.html?c=...`, where `c` is the settings JSON encoded as URL-safe base64.

```json
{
  "wallet": "SOLANA_WALLET",
  "helius": "HELIUS_KEY",
  "coingecko": "COINGECKO_KEY",
  "polygonWallet": "0x... (optional, old Polygon wallet)",
  "miners": [{ "id": "MINER_ID", "location": "Italia" }],
  "investment": {
    "amountEUR": 1000,
    "description": "2 miner (500 € + 500 €)",
    "partners": ["Name1", "Name2"],
    "deposits": [
      { "label": "Da profitti X", "source": "X", "amountUSD": 100, "chain": "solana",
        "split": { "Name1": 50, "Name2": 50 } }
    ]
  }
}
```

Only `wallet`, `helius` and `coingecko` are required. The older form `?wallet=...&helius=...&coingecko=...` still works and shows the dashboard without the personal sections.

Base64 is an encoding, not encryption: anyone with the link can read its contents, so share it only with the people who should see it.

### 3. Bookmark the URL

Save the full URL (with all parameters) as a bookmark for easy access. You'll need the complete URL every time you visit.

## Run Locally

```bash
# Start a local server
python3 -m http.server 8000

# Then open with your parameters
open "http://localhost:8000/?wallet=YOUR_WALLET&helius=YOUR_KEY&coingecko=YOUR_KEY"
```

## Deploy to GitHub Pages

1. Create a new GitHub repository
2. Push all files:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```
3. Go to repository Settings → Pages
4. Source: Deploy from a branch
5. Branch: `main`, folder: `/ (root)`
6. Save
7. Your dashboard will be live at:
   ```
   https://YOUR_USERNAME.github.io/YOUR_REPO/?wallet=xxx&helius=xxx&coingecko=xxx
   ```

## Security

- **No API keys or personal data in source code** - Wallets, keys, amounts and partner splits are passed in the link
- **Safe to publish publicly** - Share your repo without exposing your keys
- **Share the full URL privately** - Only share the URL with parameters to trusted friends
- **Regenerate if compromised** - You can always regenerate keys at Helius/CoinGecko

## File Structure

```
geod_board/
├── index.html          # Main dashboard page
├── setup.html          # Builds the dashboard link from a settings JSON
├── css/
│   └── style.css       # Neo-Industrial styling
├── js/
│   ├── config.js       # Public constants (token mints, contracts)
│   ├── api.js          # CoinGecko, Helius & Blockscout API clients
│   ├── utils.js        # Formatting helpers
│   └── app.js          # Main application logic
└── README.md           # This file
```

## Limitations

- **Miner Stats**: Real-time miner status requires GEODNET Console login. This dashboard shows static miner info with a link to the official console.
- **Rate Limits**: Free tier APIs have rate limits. If you hit them, wait and refresh.

## License

MIT
