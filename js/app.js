const App = {
    state: {
        price: null,
        change24h: null,
        geodBalance: null,
        usdcBalance: null,
        portfolioValue: null,
        portfolioValueEUR: null,
        chartDays: 90,
        datasets: {
            price: false,
            portfolio: true,
            rewards: true
        },
        rawData: {
            prices: [],
            portfolios: []
        },
        activity: [],
        polygonActivity: null,
        rawEntries: null,
        eurRate: null,
        mined: null,
        minedSince: null,
        activityShown: 15,
        activityLoadedAt: 0,
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
        if (!this.activityReady) this.activityReady = this.loadTransactions();
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

        document.getElementById('tx-more').addEventListener('click', () => {
            this.state.activityShown += 15;
            this.renderTransactions();
        });
    },

    renderLegend() {
        const container = document.getElementById('chart-legend');
        container.innerHTML = `
            <div class="legend-item price ${this.state.datasets.price ? '' : 'disabled'}" data-dataset="price">
                <div class="legend-color"></div>
                <span class="legend-label">GEOD PRICE</span>
            </div>
            <div class="legend-item portfolio ${this.state.datasets.portfolio ? '' : 'disabled'}" data-dataset="portfolio">
                <div class="legend-color"></div>
                <span class="legend-label">PORTFOLIO VALUE</span>
            </div>
            <div class="legend-item rewards ${this.state.datasets.rewards ? '' : 'disabled'}" data-dataset="rewards">
                <div class="legend-color"></div>
                <span class="legend-label">GEOD MINED</span>
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
        this.chart.options.scales.y2.display = this.state.datasets.price;
        this.chart.options.scales.y1.display = this.state.datasets.rewards;
        this.chart.options.scales.y.display = this.state.datasets.portfolio;
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
            this.state.portfolioValueEUR = data.portfolioValueEUR;
            this.state.eurRate = data.eurRate;

            this.updatePriceUI();
            this.updatePortfolioUI();
            
            this.setStatus('', 'LIVE');
            this.updateLastUpdate();

            if (Date.now() - this.state.activityLoadedAt > CONFIG.activityRefreshInterval) {
                this.activityReady = this.loadTransactions();
            }
            
        } catch (error) {
            console.error('Refresh failed:', error);
            this.state.error = error.message;
            this.setStatus('error', 'ERROR');
        } finally {
            this.state.isLoading = false;
        }
    },

    updatePriceUI() {
        const eur = this.state.eurRate;
        document.getElementById('geod-price').textContent = eur
            ? '€' + (this.state.price * eur).toFixed(4)
            : Utils.formatPrice(this.state.price);
        document.getElementById('geod-price-usd').textContent = eur ? '≈ ' + Utils.formatPrice(this.state.price) : '';
        const changeEl = document.getElementById('geod-change');
        changeEl.textContent = Utils.formatChange(this.state.change24h) + ' (24h)';
        changeEl.className = 'card-change ' + (this.state.change24h >= 0 ? 'positive' : 'negative');
    },

    updatePortfolioUI() {
        document.getElementById('portfolio-value').textContent = this.state.portfolioValueEUR
            ? '€' + Utils.formatNumber(this.state.portfolioValueEUR, 2)
            : Utils.formatPrice(this.state.portfolioValue, 2);
        document.getElementById('geod-balance').textContent = Utils.formatNumber(this.state.geodBalance, 4) + ' GEOD';
        document.getElementById('usdc-balance').textContent = Utils.formatNumber(this.state.usdcBalance, 2) + ' USDC';
        const eurEl = document.getElementById('portfolio-eur');
        if (this.state.portfolioValueEUR) {
            eurEl.textContent = '≈ $' + Utils.formatNumber(this.state.portfolioValue, 2);
        }
        this.updateInvestmentUI();
    },

    // One plain sentence for friends who only read the top of the page.
    updateHeadline() {
        const entries = this.state.rawEntries;
        if (!entries || !this.state.price || !this.state.eurRate) return;

        const monthAgo = Date.now() / 1000 - 30 * 86400;
        const rewards = entries.filter(e => e.kind === 'reward');
        const mined = rewards.filter(e => e.timestamp >= monthAgo).reduce((sum, e) => sum + e.geod, 0);
        const value = mined * this.state.price * this.state.eurRate;
        const last = rewards[0];
        const stale = last && Date.now() / 1000 - last.timestamp > 2 * 86400;

        document.getElementById('investment-headline').innerHTML =
            `In the last 30 days the miners earned <strong>${Utils.formatNumber(mined, 0)} GEOD</strong>` +
            ` (≈ €${Utils.formatNumber(value, 0)}).` +
            (last ? ` <span class="${stale ? 'warn' : ''}">Last payout ${Utils.timeAgo(last.timestamp)}.</span>` : '');
    },

    updateInvestmentUI() {
        const invested = CONFIG.investment.amountEUR;
        const worth = this.state.portfolioValueEUR;
        const euro = (v) => '€' + Utils.formatNumber(v, 0);

        document.getElementById('invested-value').textContent = euro(invested);
        document.getElementById('investment-note').textContent =
            `${CONFIG.investment.description}. "Worth today" is the GEOD and USDC in the wallet at today's prices; the miners themselves are not counted.`;

        if (!worth) return;

        this.updateHeadline();

        if (this.state.mined && this.state.price) {
            const eurPerUsd = worth / this.state.portfolioValue;
            const since = new Date(this.state.minedSince * 1000)
                .toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            document.getElementById('investment-mined').innerHTML =
                `Mined since ${since}: <strong>${Utils.formatNumber(this.state.mined, 0)} GEOD</strong>` +
                ` (≈ ${euro(this.state.mined * this.state.price * eurPerUsd)} at today's price)`;
        }

        const result = worth - invested;
        const percent = (result / invested) * 100;
        const resultEl = document.getElementById('result-value');
        const percentEl = document.getElementById('result-percent');

        document.getElementById('worth-value').textContent = euro(worth);
        resultEl.textContent = (result >= 0 ? '+' : '−') + euro(Math.abs(result));
        resultEl.className = 'investment-value ' + (result >= 0 ? 'positive' : 'negative');
        percentEl.textContent = Utils.formatChange(percent);
        percentEl.className = 'card-change ' + (result >= 0 ? 'positive' : 'negative');
    },

    initChart() {
        const ctx = document.getElementById('combined-chart').getContext('2d');
        const font = (size) => ({ family: "'JetBrains Mono'", size });
        const grid = { color: 'rgba(42, 42, 42, 0.5)', drawBorder: false };
        const euro = (v) => '€' + (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(v < 10 ? 2 : 0));

        this.chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [
                    {
                        type: 'line',
                        label: 'GEOD price',
                        data: [],
                        borderColor: '#ff6b35',
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        tension: 0.3,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        yAxisID: 'y2',
                        order: 1
                    },
                    {
                        type: 'line',
                        label: 'Portfolio value',
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
                        label: 'GEOD mined',
                        data: [],
                        backgroundColor: 'rgba(0, 255, 136, 0.35)',
                        borderColor: 'rgba(0, 255, 136, 0.7)',
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
                        titleFont: font(11),
                        bodyFont: font(11),
                        padding: 12,
                        callbacks: {
                            label: (context) => {
                                const v = context.parsed.y;
                                if (context.datasetIndex === 0) return `GEOD price: €${v.toFixed(4)}`;
                                if (context.datasetIndex === 1) return `Portfolio: €${Utils.formatNumber(v, 0)}`;
                                return `Mined: +${Utils.formatNumber(v, 2)} GEOD`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid,
                        ticks: { color: '#666666', font: font(9), maxTicksLimit: 8, maxRotation: 0 }
                    },
                    y: {
                        type: 'linear',
                        position: 'left',
                        grid,
                        ticks: { color: '#a855f7', font: font(10), callback: euro },
                        title: { display: true, text: 'PORTFOLIO €', color: '#a855f7', font: font(10) }
                    },
                    y1: {
                        type: 'linear',
                        position: 'right',
                        beginAtZero: true,
                        grid: { display: false },
                        ticks: { color: '#00ff88', font: font(10) },
                        title: { display: true, text: 'GEOD MINED', color: '#00ff88', font: font(10) }
                    },
                    y2: {
                        type: 'linear',
                        position: 'right',
                        display: false,
                        grid: { display: false },
                        ticks: { color: '#ff6b35', font: font(10), callback: (v) => '€' + v.toFixed(2) },
                        title: { display: true, text: 'PRICE €', color: '#ff6b35', font: font(10) }
                    }
                }
            }
        });
    },

    dayKey(timestamp) {
        const d = new Date(timestamp * 1000);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },

    // Rebuilds the wallet's daily GEOD/USDC holdings by walking back from
    // today's balances through every recorded transaction (both chains; the
    // move to Solana cancels out), then values them with that day's price.
    async loadChartData(days) {
        const loadingEl = document.getElementById('combined-chart-loading');
        const summaryEl = document.getElementById('combined-summary');

        loadingEl.textContent = 'Loading...';
        loadingEl.style.display = 'block';
        summaryEl.innerHTML = '';

        this.state.chartDays = days;

        try {
            const [priceHistory] = await Promise.all([API.getGEODPriceHistory(days), this.activityReady]);
            if (this.state.chartDays !== days) return;
            if (!priceHistory || priceHistory.length === 0) throw new Error('No price data');
            if (!this.state.rawEntries) throw new Error('Transactions unavailable');

            const eur = this.state.eurRate || 1;
            const priceByDay = {};
            for (const [ms, price] of priceHistory) {
                priceByDay[this.dayKey(ms / 1000)] = price;
            }

            // Day list, oldest first, each with its end-of-day timestamp.
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const dayList = [];
            for (let i = days - 1; i >= 0; i--) {
                const start = new Date(today);
                start.setDate(start.getDate() - i);
                const end = new Date(start);
                end.setDate(end.getDate() + 1);
                dayList.push({ key: this.dayKey(start / 1000), start: start / 1000, end: end / 1000 });
            }

            const entries = this.state.rawEntries;  // newest first
            let geod = this.state.geodBalance || 0;
            let usd = this.state.usdcBalance || 0;
            let p = 0;
            for (let i = dayList.length - 1; i >= 0; i--) {
                while (p < entries.length && entries[p].timestamp >= dayList[i].end) {
                    geod -= entries[p].geod;
                    usd -= entries[p].usdc;
                    p++;
                }
                dayList[i].geod = Math.max(geod, 0);
                dayList[i].usd = Math.max(usd, 0);
            }

            const minedByDay = {};
            for (const e of entries) {
                if (e.kind === 'reward') minedByDay[this.dayKey(e.timestamp)] = (minedByDay[this.dayKey(e.timestamp)] || 0) + e.geod;
            }

            let lastPrice = priceHistory[0][1];
            for (const day of dayList) {
                lastPrice = priceByDay[day.key] ?? lastPrice;
                day.price = lastPrice;
                day.value = (day.geod * day.price + day.usd) * eur;
                day.mined = minedByDay[day.key] || 0;
            }

            // Longer ranges are shown per week so the bars stay readable.
            const bucketSize = days > 90 ? 7 : 1;
            const buckets = [];
            for (let i = dayList.length; i > 0; i -= bucketSize) {
                const slice = dayList.slice(Math.max(0, i - bucketSize), i);
                const last = slice[slice.length - 1];
                buckets.unshift({
                    label: new Date(last.start * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                    value: last.value,
                    price: last.price * eur,
                    mined: slice.reduce((sum, d) => sum + d.mined, 0)
                });
            }

            this.chart.data.labels = buckets.map(b => b.label);
            this.chart.data.datasets[0].data = buckets.map(b => b.price);
            this.chart.data.datasets[1].data = buckets.map(b => b.value);
            this.chart.data.datasets[2].data = buckets.map(b => b.mined);
            // Keep the bars in the bottom third so the portfolio line stays readable.
            this.chart.options.scales.y1.max = Math.ceil(Math.max(...buckets.map(b => b.mined), 1) * 3);
            this.chart.options.scales.y1.title.text = bucketSize > 1 ? 'GEOD MINED / WEEK' : 'GEOD MINED / DAY';
            this.updateChartVisibility();
            loadingEl.style.display = 'none';

            const mined = dayList.reduce((sum, d) => sum + d.mined, 0);
            const first = dayList[0].value;
            const last = dayList[dayList.length - 1].value;
            const change = last - first;
            const changePct = first ? (change / first) * 100 : 0;
            const lastReward = entries.find(e => e.kind === 'reward');
            const sign = change >= 0 ? '+' : '−';

            summaryEl.innerHTML = `
                <div class="tx-summary-item">
                    <div class="tx-summary-label">MINED IN PERIOD</div>
                    <div class="tx-summary-value rewards">${Utils.formatNumber(mined, 0)} GEOD</div>
                </div>
                <div class="tx-summary-item">
                    <div class="tx-summary-label">MINED VALUE TODAY</div>
                    <div class="tx-summary-value portfolio">€${Utils.formatNumber(mined * (this.state.price || 0) * eur, 0)}</div>
                </div>
                <div class="tx-summary-item">
                    <div class="tx-summary-label">AVERAGE PER DAY</div>
                    <div class="tx-summary-value rewards">${Utils.formatNumber(mined / days, 1)} GEOD</div>
                </div>
                <div class="tx-summary-item">
                    <div class="tx-summary-label">PORTFOLIO CHANGE</div>
                    <div class="tx-summary-value ${change >= 0 ? 'rewards' : 'negative'}">${sign}€${Utils.formatNumber(Math.abs(change), 0)} (${Utils.formatChange(changePct)})</div>
                </div>
                <div class="tx-summary-item">
                    <div class="tx-summary-label">LAST PAYOUT</div>
                    <div class="tx-summary-value rewards">${lastReward ? Utils.timeAgo(lastReward.timestamp) : '--'}</div>
                </div>
            `;
        } catch (error) {
            console.error('Failed to load chart data:', error);
            loadingEl.innerHTML = 'Chart data unavailable<br><small style="color: var(--text-muted)">' + error.message + '</small>';
            loadingEl.style.display = 'block';
        }
    },

    async loadTransactions() {
        this.state.activityLoadedAt = Date.now();
        try {
            // The Polygon history never changes, so it is only loaded once.
            this.state.polygonActivity ??= await API.getPolygonActivity().catch(error => {
                console.error('Polygon history unavailable:', error);
                return null;
            });
            const solana = await API.getWalletActivity();
            this.state.rawEntries = [...solana, ...(this.state.polygonActivity || [])]
                .sort((a, b) => b.timestamp - a.timestamp);
            // Small swaps for Polygon network fees are left out of the list.
            const entries = this.state.rawEntries.filter(e => e.kind !== 'gas');

            this.state.mined = entries.filter(e => e.kind === 'reward').reduce((sum, e) => sum + e.geod, 0);
            this.state.minedSince = Math.min(...entries.filter(e => e.kind === 'reward').map(e => e.timestamp));
            this.state.activity = this.groupRuns(entries);
            this.renderTransactions();
            this.updateInvestmentUI();
        } catch (error) {
            console.error('Failed to load transactions:', error);
            if (this.state.activity.length === 0) {
                document.getElementById('transactions-list').innerHTML =
                    '<div class="tx-empty">Transactions unavailable right now</div>';
            }
        }
    },

    // Merges back-to-back entries of the same kind (mining payouts, the
    // transfers of the move to Solana) into one expandable row so they don't
    // drown out buys, sells and transfers.
    groupRuns(entries) {
        const groupable = ['reward', 'migrate-out', 'migrate-in'];
        const result = [];

        for (const entry of entries) {
            const last = result[result.length - 1];
            if (!groupable.includes(entry.kind)) {
                result.push(entry);
            } else if (last?.kind === entry.kind && last.chain === entry.chain) {
                last.geod += entry.geod;
                last.payouts.push(entry);
                last.firstTimestamp = entry.timestamp;
            } else {
                result.push({ ...entry, payouts: [entry], firstTimestamp: entry.timestamp });
            }
        }

        return result;
    },

    describeTransaction(entry) {
        const geod = Utils.formatNumber(Math.abs(entry.geod), 2) + ' GEOD';
        const usdc = Utils.formatNumber(Math.abs(entry.usdc), 2) + ' USDC';
        const geodNow = this.state.price
            ? '≈ €' + Utils.formatNumber(Math.abs(entry.geod) * this.state.price * (this.state.eurRate || 1), 2) + ' today'
            : '';

        const count = entry.payouts?.length > 1 ? entry.payouts.length : 0;

        switch (entry.kind) {
            case 'reward':
                return {
                    title: count ? 'Mining rewards' : 'Mining reward',
                    note: count ? `${count} payouts` : 'Earned by the miners',
                    amount: '+' + geod, sub: geodNow, dir: 'incoming'
                };
            case 'migrate-out':
                return {
                    title: 'Moved to Solana',
                    note: (count ? `${count} transfers` : 'Sent') + ' to the GEODNET bridge',
                    amount: '-' + geod, sub: '', dir: 'swap'
                };
            case 'migrate-in':
                return {
                    title: 'Arrived on Solana',
                    note: (count ? `${count} transfers` : 'Received') + ' from the old Polygon wallet',
                    amount: '+' + geod, sub: '', dir: 'swap'
                };
            case 'sell':
                return {
                    title: 'Sold GEOD',
                    note: 'Converted to USDC (digital dollars)',
                    amount: entry.geod ? '-' + geod : '+' + usdc,
                    sub: entry.geod && entry.usdc ? 'for ' + usdc : '', dir: 'swap'
                };
            case 'buy':
                return {
                    title: 'Bought GEOD',
                    note: 'Paid with USDC (digital dollars)',
                    amount: entry.geod ? '+' + geod : '-' + usdc,
                    sub: entry.geod && entry.usdc ? 'for ' + usdc : '', dir: 'swap'
                };
            case 'geod-in':
                return { title: 'GEOD received', note: 'Transfer into the wallet', amount: '+' + geod, sub: geodNow, dir: 'incoming' };
            case 'geod-out':
                return { title: 'GEOD sent', note: 'Transfer out of the wallet', amount: '-' + geod, sub: geodNow, dir: 'outgoing' };
            case 'usdc-in':
                return { title: 'USDC received', note: 'Digital dollars added', amount: '+' + usdc, sub: '', dir: 'incoming' };
            default:
                return { title: 'USDC sent', note: 'Digital dollars withdrawn', amount: '-' + usdc, sub: '', dir: 'outgoing' };
        }
    },

    renderTransactions() {
        const listEl = document.getElementById('transactions-list');
        const moreEl = document.getElementById('tx-more');
        const entries = this.state.activity;

        const oldest = entries[entries.length - 1];
        document.getElementById('tx-count').textContent = oldest
            ? 'SINCE ' + new Date((oldest.firstTimestamp || oldest.timestamp) * 1000)
                .toLocaleDateString('en-US', { month: 'short', year: 'numeric' }).toUpperCase()
            : '';

        if (entries.length === 0) {
            listEl.innerHTML = '<div class="tx-empty">No transactions yet</div>';
            moreEl.hidden = true;
            return;
        }

        const formatDay = (timestamp, withYear = true) =>
            new Date(timestamp * 1000).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', ...(withYear && { year: 'numeric' })
            });
        const explorer = { solana: 'https://solscan.io/tx/', polygon: 'https://polygonscan.com/tx/' };
        const proofLink = (chain, signature) => `
            <a class="tx-link" href="${explorer[chain]}${signature}" target="_blank" rel="noopener"
               title="See this transaction on the public blockchain">PROOF ↗</a>`;

        listEl.innerHTML = entries.slice(0, this.state.activityShown).map(entry => {
            const tx = this.describeTransaction(entry);
            const isGroup = entry.payouts?.length > 1;
            const sameYear = new Date(entry.firstTimestamp * 1000).getFullYear() ===
                new Date(entry.timestamp * 1000).getFullYear();
            const date = isGroup && formatDay(entry.firstTimestamp) !== formatDay(entry.timestamp)
                ? `${formatDay(entry.firstTimestamp, !sameYear)} – ${formatDay(entry.timestamp)}`
                : formatDay(entry.timestamp);
            const row = `
                <div class="tx-info">
                    <div class="tx-title">${tx.title}${entry.chain === 'polygon' ? '<span class="tx-chain">POLYGON</span>' : ''}</div>
                    <div class="tx-date">${date} · ${tx.note}</div>
                </div>
                <div class="tx-value">
                    <div class="tx-amount ${tx.dir === 'outgoing' ? 'negative' : tx.dir === 'incoming' ? 'positive' : ''}">${tx.amount}</div>
                    <div class="tx-sub">${tx.sub}</div>
                </div>`;

            if (!isGroup) {
                return `<div class="tx-item ${tx.dir}">${row}${proofLink(entry.chain, entry.signature)}</div>`;
            }

            const payouts = entry.payouts.map(p => `
                <div class="tx-payout">
                    <span class="tx-date">${formatDay(p.timestamp)}</span>
                    <span class="tx-amount positive">+${Utils.formatNumber(p.geod, 2)} GEOD</span>
                    ${proofLink(p.chain, p.signature)}
                </div>`).join('');

            return `
                <details class="tx-group">
                    <summary class="tx-item ${tx.dir}">${row}<span class="tx-link tx-toggle">DETAILS</span></summary>
                    <div class="tx-payouts">${payouts}</div>
                </details>`;
        }).join('');

        moreEl.hidden = entries.length <= this.state.activityShown;
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
