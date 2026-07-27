const App = {
    state: {
        price: null,
        change24h: null,
        geodBalance: null,
        usdcBalance: null,
        portfolioValue: null,
        chartDays: 90,
        datasets: {
            price: true,
            portfolio: true,
            rewards: true
        },
        rawData: {
            prices: [],
            portfolios: []
        },
        isLoading: false,
        error: null,
        refreshTimer: null,
        configError: null
    },

    chart: null,

    parseUrlParams() {
        const params = new URLSearchParams(window.location.search);
        
        const wallet = params.get('wallet');
        const helius = params.get('helius');
        const coingecko = params.get('coingecko');
        
        const missing = [];
        if (!wallet) missing.push('wallet');
        if (!helius) missing.push('helius');
        if (!coingecko) missing.push('coingecko');
        
        if (missing.length > 0) {
            this.state.configError = `Missing URL parameters: ${missing.join(', ')}`;
            return false;
        }
        
        CONFIG.wallet = wallet;
        CONFIG.heliusApiKey = helius;
        CONFIG.coingeckoApiKey = coingecko;
        
        API.heliusRpcUrl = `https://mainnet.helius-rpc.com/?api-key=${CONFIG.heliusApiKey}`;
        API.heliusApiUrl = `https://api.helius.xyz/v0/addresses/${CONFIG.wallet}/transactions?api-key=${CONFIG.heliusApiKey}`;
        
        return true;
    },

    showConfigError() {
        const main = document.querySelector('.main');
        main.innerHTML = `
            <div class="config-error">
                <h2>⚠ Configuration Required</h2>
                <p>${this.state.configError}</p>
                <p class="config-help">Add the following parameters to your URL:</p>
                <code>?wallet=YOUR_WALLET&helius=YOUR_HELIUS_KEY&coingecko=YOUR_COINGECKO_KEY</code>
                <div class="config-example">
                    <p>Example:</p>
                    <code>?wallet=3RZWX21zh9ez3WgHDVX9FbhCv6eUmSsfo6heTegWT6HJ&helius=fb0bd728-xxxx&coingecko=CG-xxxx</code>
                </div>
            </div>
        `;
        this.setStatus('error', 'CONFIG ERROR');
    },

    async init() {
        if (!this.parseUrlParams()) {
            this.showConfigError();
            return;
        }
        
        this.bindEvents();
        this.initChart();
        this.renderLegend();
        await this.refresh();
        this.loadChartData(this.state.chartDays);
        this.startAutoRefresh();
    },

    bindEvents() {
        document.querySelectorAll('.tf-btn-cb').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const days = parseInt(e.target.dataset.days);
                document.querySelectorAll('.tf-btn-cb').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.loadChartData(days);
            });
        });
    },

    renderLegend() {
        const container = document.getElementById('chart-legend');
        container.innerHTML = `
            <div class="legend-item price ${this.state.datasets.price ? '' : 'disabled'}" data-dataset="price">
                <div class="legend-color"></div>
                <span class="legend-label">PRICE INDEX</span>
            </div>
            <div class="legend-item portfolio ${this.state.datasets.portfolio ? '' : 'disabled'}" data-dataset="portfolio">
                <div class="legend-color"></div>
                <span class="legend-label">PORTFOLIO INDEX</span>
            </div>
            <div class="legend-item rewards ${this.state.datasets.rewards ? '' : 'disabled'}" data-dataset="rewards">
                <div class="legend-color"></div>
                <span class="legend-label">DAILY NET FLOW (GEOD)</span>
            </div>
        `;
        
        container.querySelectorAll('.legend-item').forEach(item => {
            item.addEventListener('click', () => {
                const dataset = item.dataset.dataset;
                this.state.datasets[dataset] = !this.state.datasets[dataset];
                item.classList.toggle('disabled');
                this.updateChartVisibility();
            });
        });
    },

    updateChartVisibility() {
        if (!this.chart) return;
        
        this.chart.data.datasets[0].hidden = !this.state.datasets.price;
        this.chart.data.datasets[1].hidden = !this.state.datasets.portfolio;
        this.chart.data.datasets[2].hidden = !this.state.datasets.rewards;
        this.chart.update();
    },

    setStatus(status, text) {
        const indicator = document.getElementById('status-indicator');
        const statusText = document.querySelector('.status-text');
        indicator.className = 'status-indicator ' + status;
        statusText.textContent = text;
    },

    updateLastUpdate() {
        document.getElementById('last-update').textContent = 
            new Date().toLocaleTimeString('en-US', { hour12: false });
    },

    async refresh() {
        if (this.state.isLoading) return;
        
        this.state.isLoading = true;
        this.setStatus('loading', 'SYNCING');

        try {
            const data = await API.fetchAllData();
            
            this.state.price = data.price;
            this.state.change24h = data.change24h;
            this.state.geodBalance = data.geodBalance;
            this.state.usdcBalance = data.usdcBalance;
            this.state.portfolioValue = data.portfolioValue;

            this.updatePriceUI();
            this.updatePortfolioUI();
            
            this.setStatus('', 'LIVE');
            this.updateLastUpdate();
            
        } catch (error) {
            console.error('Refresh failed:', error);
            this.state.error = error.message;
            this.setStatus('error', 'ERROR');
        } finally {
            this.state.isLoading = false;
        }
    },

    updatePriceUI() {
        document.getElementById('geod-price').textContent = Utils.formatPrice(this.state.price);
        const changeEl = document.getElementById('geod-change');
        changeEl.textContent = Utils.formatChange(this.state.change24h) + ' (24h)';
        changeEl.className = 'card-change ' + (this.state.change24h >= 0 ? 'positive' : 'negative');
    },

    updatePortfolioUI() {
        document.getElementById('portfolio-value').textContent = Utils.formatPrice(this.state.portfolioValue, 2);
        document.getElementById('geod-balance').textContent = Utils.formatNumber(this.state.geodBalance, 4) + ' GEOD';
        document.getElementById('usdc-balance').textContent = Utils.formatNumber(this.state.usdcBalance, 2) + ' USDC';
    },

    initChart() {
        const ctx = document.getElementById('combined-chart').getContext('2d');
        
        this.chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [
                    {
                        type: 'line',
                        label: 'Price (USD)',
                        data: [],
                        borderColor: '#ff6b35',
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        tension: 0.3,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        yAxisID: 'y',
                        order: 1
                    },
                    {
                        type: 'line',
                        label: 'Portfolio (USD)',
                        data: [],
                        borderColor: '#a855f7',
                        backgroundColor: 'rgba(168, 85, 247, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.3,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        yAxisID: 'y',
                        order: 2
                    },
                    {
                        type: 'bar',
                        label: 'Net Flow (GEOD)',
                        data: [],
                        backgroundColor: 'rgba(0, 255, 136, 0.5)',
                        borderColor: '#00ff88',
                        borderWidth: 1,
                        borderRadius: 2,
                        yAxisID: 'y1',
                        order: 3
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 300 },
                interaction: { intersect: false, mode: 'index' },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#1a1a1a',
                        borderColor: '#3a3a3a',
                        borderWidth: 1,
                        titleColor: '#666666',
                        bodyColor: '#e0e0e0',
                        titleFont: { family: "'JetBrains Mono'", size: 11 },
                        bodyFont: { family: "'JetBrains Mono'", size: 11 },
                        padding: 12
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(42, 42, 42, 0.5)', drawBorder: false },
                        ticks: { 
                            color: '#666666', 
                            font: { family: "'JetBrains Mono'", size: 9 },
                            maxTicksLimit: 10,
                            maxRotation: 45
                        }
                    },
                    y: {
                        type: 'linear',
                        position: 'left',
                        grid: { color: 'rgba(42, 42, 42, 0.5)', drawBorder: false },
                        ticks: { 
                            color: '#a855f7', 
                            font: { family: "'JetBrains Mono'", size: 10 },
                            callback: (v) => '$' + (v >= 1000 ? (v/1000).toFixed(1) + 'k' : v.toFixed(0))
                        },
                        title: {
                            display: true,
                            text: 'USD',
                            color: '#a855f7',
                            font: { family: "'JetBrains Mono'", size: 10 }
                        }
                    },
                    y1: {
                        type: 'linear',
                        position: 'right',
                        grid: { display: false },
                        ticks: { 
                            color: '#00ff88', 
                            font: { family: "'JetBrains Mono'", size: 10 },
                            callback: (v) => v + ' GEOD'
                        },
                        title: {
                            display: true,
                            text: 'GEOD',
                            color: '#00ff88',
                            font: { family: "'JetBrains Mono'", size: 10 }
                        }
                    }
                }
            }
        });
    },

    async loadChartData(days) {
        const loadingEl = document.getElementById('combined-chart-loading');
        const summaryEl = document.getElementById('combined-summary');
        
        loadingEl.textContent = 'Loading...';
        loadingEl.style.display = 'block';
        summaryEl.innerHTML = '';
        
        this.state.chartDays = days;
        
        try {
            const [priceHistory, transferHistory] = await Promise.all([
                API.getGEODPriceHistory(days),
                API.getAllGEODTransfers(days)
            ]);
            
            if (!priceHistory || priceHistory.length === 0) {
                throw new Error('No price data');
            }
            
            const flowByDate = {};
            let totalInflow = 0;
            
            for (const t of transferHistory) {
                flowByDate[t.date] = t.netFlow;
                totalInflow += t.inFlow || 0;
            }
            
            const priceByDate = {};
            for (const [timestamp, price] of priceHistory) {
                const date = new Date(timestamp).toISOString().split('T')[0];
                if (!priceByDate[date]) {
                    priceByDate[date] = price;
                }
            }
            
            const currentBalance = this.state.geodBalance || 0;
            const priceDates = Object.keys(priceByDate).sort();
            
            const labels = [];
            const priceData = [];
            const portfolioData = [];
            const rewardsData = [];
            
            const priceValues = [];
            const portfolioValues = [];
            
            const totalRewards = transferHistory.reduce((sum, t) => sum + (t.inFlow || 0), 0);
            let startBalance = currentBalance - totalRewards;
            if (startBalance < 0) startBalance = 0;
            
            for (const date of priceDates) {
                const price = priceByDate[date];
                const dailyReward = flowByDate[date] || 0;
                
                labels.push(new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
                priceValues.push(price);
                portfolioValues.push(startBalance * price);
                rewardsData.push(dailyReward);
                
                startBalance += dailyReward;
            }
            
            const basePrice = priceValues[0] || 1;
            const basePortfolio = portfolioValues[0] || 1;
            
            for (let i = 0; i < priceValues.length; i++) {
                priceData.push((priceValues[i] / basePrice) * 100);
                portfolioData.push((portfolioValues[i] / basePortfolio) * 100);
            }
            
            this.state.rawData.prices = priceValues;
            this.state.rawData.portfolios = portfolioValues;
            
            this.chart.data.labels = labels;
            this.chart.data.datasets[0].data = priceData;
            this.chart.data.datasets[1].data = portfolioData;
            this.chart.data.datasets[2].data = rewardsData;
            
            this.chart.options.scales.y.title.text = 'INDEX (100 = START)';
            this.chart.options.scales.y.ticks.callback = (v) => v.toFixed(0);
            this.chart.options.scales.y.min = undefined;
            
            this.chart.options.plugins.tooltip.callbacks.label = (context) => {
                const label = context.dataset.label;
                const idx = context.dataIndex;
                if (label.includes('Price')) {
                    const actual = this.state.rawData.prices[idx];
                    return `Price: $${actual.toFixed(4)} (index: ${context.parsed.y.toFixed(0)})`;
                } else if (label.includes('Portfolio')) {
                    const actual = this.state.rawData.portfolios[idx];
                    return `Portfolio: $${actual.toFixed(2)} (index: ${context.parsed.y.toFixed(0)})`;
                }
                const flow = context.parsed.y;
                return flow >= 0 ? `+${flow.toFixed(2)} GEOD` : `${flow.toFixed(2)} GEOD`;
            };
            
            this.chart.update();
            
            this.updateChartVisibility();
            
            loadingEl.style.display = 'none';
            
            const daysWithRewards = transferHistory.filter(d => d.inFlow > 0).length;
            const avgDaily = daysWithRewards > 0 ? totalInflow / daysWithRewards : 0;
            
            if (this.state.price) {
                summaryEl.innerHTML = `
                    <div class="tx-summary-item">
                        <div class="tx-summary-label">TOTAL MINED</div>
                        <div class="tx-summary-value rewards">${Utils.formatNumber(totalInflow, 2)} GEOD</div>
                    </div>
                    <div class="tx-summary-item">
                        <div class="tx-summary-label">MINING VALUE</div>
                        <div class="tx-summary-value portfolio">${Utils.formatPrice(totalInflow * this.state.price, 2)}</div>
                    </div>
                    <div class="tx-summary-item">
                        <div class="tx-summary-label">AVG DAILY</div>
                        <div class="tx-summary-value rewards">${Utils.formatNumber(avgDaily, 2)} GEOD</div>
                    </div>
                    <div class="tx-summary-item">
                        <div class="tx-summary-label">ACTIVE DAYS</div>
                        <div class="tx-summary-value rewards">${daysWithRewards} / ${days}</div>
                    </div>
                    <div class="tx-summary-item">
                        <div class="tx-summary-label">CURRENT PRICE</div>
                        <div class="tx-summary-value price">${Utils.formatPrice(this.state.price, 4)}</div>
                    </div>
                    <div class="tx-summary-item">
                        <div class="tx-summary-label">PORTFOLIO</div>
                        <div class="tx-summary-value portfolio">${Utils.formatPrice(this.state.portfolioValue, 2)}</div>
                    </div>
                `;
            }
            
        } catch (error) {
            console.error('Failed to load chart data:', error);
            loadingEl.innerHTML = 'Chart data unavailable<br><small style="color: var(--text-muted)">' + error.message + '</small>';
            loadingEl.style.display = 'block';
        }
    },

    startAutoRefresh() {
        if (this.state.refreshTimer) {
            clearInterval(this.state.refreshTimer);
        }
        
        this.state.refreshTimer = setInterval(() => {
            this.refresh();
        }, CONFIG.refreshInterval);
    },

    stopAutoRefresh() {
        if (this.state.refreshTimer) {
            clearInterval(this.state.refreshTimer);
            this.state.refreshTimer = null;
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('wallet-display').textContent = Utils.shortenAddress(CONFIG.wallet);
    App.init();
});
