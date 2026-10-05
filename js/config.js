const CONFIG = {
    wallet: '',
    geodMint: '7JA5eZdCzztSfQbJvS8aVVxMFfd81Rs9VvwnocV1mKHu',
    usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    miners: [
        { id: 'E831CD2AC355', location: 'Italy' },
        { id: 'E831CD30C3BD', location: 'Italy' }
    ],
    investment: {
        amountEUR: 1765,
        description: '2 miners (€920 + €845)',
        // Money added later from other sources; shown separately because it
        // is split between the partners differently from the miners.
        deposits: [
            // Arrived on the Solana wallet; the matching incoming USDC transfer
            // is labelled as this deposit in the transactions list.
            { label: 'From HNT profits', amountUSD: 1155, chain: 'solana' }
        ]
    },
    polygon: {
        // Old wallet, used until the move to Solana on 19 Sep 2025.
        wallet: '0xb248dbe3be3ab0cc8d6dc0fef836502d62c1fd95',
        snapshotUrl: 'data/polygon-history.json',
        geodContract: '0xac0f66379a6d7801d7726d5a943356a172549adb',
        usdContracts: {
            '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359': 'USDC',
            '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': 'USDC',
            '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': 'USDT'
        },
        bridgeAddress: '0x2006b44684b2a579466fc04fabc5a535946bc7ab',
        migratedAt: 1758286508
    },
    heliusApiKey: '',
    coingeckoApiKey: '',
    refreshInterval: 60000,
    activityRefreshInterval: 300000,
    priceChartDays: 90,
    defaultChartDays: 90
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}
