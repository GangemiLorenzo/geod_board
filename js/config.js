const CONFIG = {
    wallet: '',
    geodMint: '7JA5eZdCzztSfQbJvS8aVVxMFfd81Rs9VvwnocV1mKHu',
    usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    miners: [
        { id: 'E831CD2AC355', location: 'Italy' },
        { id: 'E831CD30C3BD', location: 'Italy' }
    ],
    heliusApiKey: '',
    coingeckoApiKey: '',
    refreshInterval: 60000,
    priceChartDays: 90,
    defaultChartDays: 90
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}
