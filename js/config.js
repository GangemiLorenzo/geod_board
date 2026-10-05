// Public constants only. Everything personal (wallets, API keys, miners,
// investment and how it is split) comes from the "c" link parameter: a
// base64-encoded JSON, see setup.html and the README.
const CONFIG = {
    wallet: '',
    heliusApiKey: '',
    coingeckoApiKey: '',
    geodMint: '7JA5eZdCzztSfQbJvS8aVVxMFfd81Rs9VvwnocV1mKHu',
    usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    miners: [],
    investment: null,
    polygon: {
        wallet: '',
        geodContract: '0xac0f66379a6d7801d7726d5a943356a172549adb',
        usdContracts: {
            '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359': 'USDC',
            '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': 'USDC',
            '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': 'USDT'
        },
        // GEODNET's Polygon → Solana migration bridge.
        bridgeAddress: '0x2006b44684b2a579466fc04fabc5a535946bc7ab'
    },
    refreshInterval: 60000,
    activityRefreshInterval: 300000,
    priceChartDays: 90,
    defaultChartDays: 90
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}
