# GEOD Mining Dashboard

A static web dashboard for monitoring GEOD mining operations. Features Neo-Industrial design with real-time price tracking, portfolio value, and mining rewards.

## Features

- **Live GEOD Price** - Current price and 24h change from DexScreener
- **Portfolio Value** - Total GEOD holdings with USD conversion
- **Combined Chart** - Price index, portfolio index, and daily rewards in one view
- **Mining Rewards** - Daily GEOD rewards with bar chart visualization
- **Transactions** - Plain-language list of mining rewards (grouped per day), buys, sells and transfers, each linked to Solscan as proof
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

The dashboard requires URL parameters to configure your wallet and API keys:

```
https://your-username.github.io/geod_board/?wallet=YOUR_WALLET&helius=YOUR_HELIUS_KEY&coingecko=YOUR_COINGECKO_KEY
```

**Example:**
```
https://your-username.github.io/geod_board/?wallet=3RZWX21zh9ez3WgHDVX9FbhCv6eUmSsfo6heTegWT6HJ&helius=fb0bd728-xxxx&coingecko=CG-xxxx
```

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

- **No API keys in source code** - Keys are passed via URL parameters
- **Safe to publish publicly** - Share your repo without exposing your keys
- **Share the full URL privately** - Only share the URL with parameters to trusted friends
- **Regenerate if compromised** - You can always regenerate keys at Helius/CoinGecko

## File Structure

```
geod_board/
├── index.html          # Main dashboard page
├── css/
│   └── style.css       # Neo-Industrial styling
├── js/
│   ├── config.js       # Configuration defaults (empty keys)
│   ├── api.js          # CoinGecko & Helius API clients
│   ├── utils.js        # Formatting helpers
│   └── app.js          # Main application logic
└── README.md           # This file
```

## Limitations

- **Miner Stats**: Real-time miner status requires GEODNET Console login. This dashboard shows static miner info with a link to the official console.
- **Rate Limits**: Free tier APIs have rate limits. If you hit them, wait and refresh.

## License

MIT
