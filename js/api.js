const API = {
    heliusRpcUrl: '',
    heliusApiUrl: '',

    async fetchJSON(url, options = {}) {
        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        });
        
        if (response.status === 429) {
            const err = new Error('Rate limited');
            err.isRateLimit = true;
            throw err;
        }
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        return await response.json();
    },

    async coinGeckoRequest(endpoint) {
        let url = `https://api.coingecko.com/api/v3${endpoint}`;
        if (CONFIG.coingeckoApiKey) {
            url += `&x_cg_demo_api_key=${CONFIG.coingeckoApiKey}`;
        }
        return this.fetchJSON(url);
    },

    async getGEODPrice() {
        const data = await this.fetchJSON(
            'https://api.dexscreener.com/latest/dex/tokens/' + CONFIG.geodMint
        );
        
        if (!data.pairs || data.pairs.length === 0) {
            throw new Error('No price data found');
        }
        
        const pair = data.pairs.find(p => p.quoteToken.symbol === 'USDC') || data.pairs[0];
        
        return {
            price: parseFloat(pair.priceUsd),
            change24h: pair.priceChange?.h24 || 0
        };
    },

    async getGEODPriceHistory(days = 30) {
        const cacheKey = `geod_history_${days}`;
        
        try {
            const stored = localStorage.getItem(cacheKey);
            if (stored) {
                const { data, timestamp } = JSON.parse(stored);
                const age = Date.now() - timestamp;
                if (age < 3600000) {
                    console.log('Using cached price history');
                    return data;
                }
            }
        } catch (e) {}
        
        try {
            const endpoint = `/coins/geodnet/market_chart?vs_currency=usd&days=${days}`;
            const data = await this.coinGeckoRequest(endpoint);
            
            const prices = data.prices || [];
            
            if (prices.length > 0) {
                try {
                    localStorage.setItem(cacheKey, JSON.stringify({ data: prices, timestamp: Date.now() }));
                } catch (e) {}
            }
            
            return prices;
        } catch (error) {
            console.error('CoinGecko failed, checking cache:', error.message);
            
            try {
                const stored = localStorage.getItem(cacheKey);
                if (stored) {
                    return JSON.parse(stored).data;
                }
            } catch (e) {}
            
            throw error;
        }
    },

    async heliusRpcRequest(method, params = []) {
        const body = {
            jsonrpc: '2.0',
            id: 1,
            method: method,
            params: params
        };
        
        return this.fetchJSON(this.heliusRpcUrl, {
            method: 'POST',
            body: JSON.stringify(body)
        });
    },

    async getEURRate() {
        try {
            const data = await this.coinGeckoRequest('/simple/price?ids=usd-coin&vs_currencies=eur');
            return data['usd-coin']?.eur || null;
        } catch (e) {
            return null;
        }
    },

    async getUSDCBalance() {
        const response = await this.heliusRpcRequest('getTokenAccountsByOwner', [
            CONFIG.wallet,
            { mint: CONFIG.usdcMint },
            { encoding: 'jsonParsed' }
        ]);

        if (response.error) {
            throw new Error(response.error.message);
        }

        const accounts = response.result?.value || [];
        if (accounts.length === 0) return 0;

        const balance = accounts[0].account.data.parsed.info.tokenAmount;
        return parseFloat(balance.uiAmount || balance.amount / Math.pow(10, balance.decimals));
    },

    async getGEODBalance() {
        const response = await this.heliusRpcRequest('getTokenAccountsByOwner', [
            CONFIG.wallet,
            { mint: CONFIG.geodMint },
            { encoding: 'jsonParsed' }
        ]);
        
        if (response.error) {
            throw new Error(response.error.message);
        }
        
        const accounts = response.result?.value || [];
        if (accounts.length === 0) {
            return 0;
        }
        
        const balance = accounts[0].account.data.parsed.info.tokenAmount;
        return parseFloat(balance.uiAmount || balance.amount / Math.pow(10, balance.decimals));
    },

    tokenAccounts: {},

    async getTokenAccount(mint) {
        if (this.tokenAccounts[mint]) {
            return this.tokenAccounts[mint];
        }

        const response = await this.heliusRpcRequest('getTokenAccountsByOwner', [
            CONFIG.wallet,
            { mint: mint },
            { encoding: 'jsonParsed' }
        ]);

        if (response.error) {
            throw new Error(response.error.message);
        }

        const accounts = response.result?.value || [];
        if (accounts.length === 0) {
            return null;
        }

        this.tokenAccounts[mint] = accounts[0].pubkey;
        return accounts[0].pubkey;
    },

    async getGEODTokenAccount() {
        return this.getTokenAccount(CONFIG.geodMint);
    },

    async getTokenAccountHistory(mint, limit = 100) {
        const tokenAccount = await this.getTokenAccount(mint);
        if (!tokenAccount) return [];

        return this.fetchJSON(
            `https://api.helius.xyz/v0/addresses/${tokenAccount}/transactions?api-key=${CONFIG.heliusApiKey}&limit=${limit}`
        );
    },

    // Turns raw GEOD/USDC transactions into plain-language activity entries.
    async getWalletActivity() {
        const [geodTxs, usdcTxs] = await Promise.all([
            this.getTokenAccountHistory(CONFIG.geodMint),
            this.getTokenAccountHistory(CONFIG.usdcMint)
        ]);

        const bySignature = new Map();
        for (const tx of [...geodTxs, ...usdcTxs]) {
            bySignature.set(tx.signature, tx);
        }

        const entries = [];
        const geodSenders = {};

        for (const tx of bySignature.values()) {
            let geod = 0;
            let usdc = 0;
            let geodFrom = null;

            for (const t of tx.tokenTransfers || []) {
                const sign = t.toUserAccount === CONFIG.wallet ? 1
                    : t.fromUserAccount === CONFIG.wallet ? -1 : 0;
                if (t.mint === CONFIG.geodMint) {
                    geod += sign * t.tokenAmount;
                    if (sign > 0) geodFrom = t.fromUserAccount;
                } else if (t.mint === CONFIG.usdcMint) {
                    usdc += sign * t.tokenAmount;
                }
            }

            if (geod === 0 && usdc === 0) continue;

            const isSwap = tx.type === 'SWAP' || (geod !== 0 && usdc !== 0);
            let kind;
            if (geod > 0 && isSwap) kind = 'buy';
            else if (geod < 0 && isSwap) kind = 'sell';
            else if (geod > 0) kind = 'geod-in';
            else if (geod < 0) kind = 'geod-out';
            else if (isSwap) kind = usdc > 0 ? 'sell' : 'buy';
            else kind = usdc > 0 ? 'usdc-in' : 'usdc-out';

            if (kind === 'geod-in' && geodFrom) {
                geodSenders[geodFrom] = (geodSenders[geodFrom] || 0) + 1;
            }

            entries.push({ signature: tx.signature, timestamp: tx.timestamp, kind, geod, usdc, geodFrom });
        }

        // Mining payouts all come from the same distributor wallet, so the most
        // frequent GEOD sender is treated as the reward source.
        const rewardSender = Object.entries(geodSenders)
            .filter(([, count]) => count >= 3)
            .sort((a, b) => b[1] - a[1])[0]?.[0];

        for (const entry of entries) {
            if (entry.kind === 'geod-in' && entry.geodFrom === rewardSender) {
                entry.kind = 'reward';
            }
        }

        return entries.sort((a, b) => b.timestamp - a.timestamp);
    },

    async getGEODTransactions(limit = 15) {
        try {
            const tokenAccount = await this.getGEODTokenAccount();
            if (!tokenAccount) {
                return [];
            }
            
            const response = await this.fetchJSON(
                `https://api.helius.xyz/v0/addresses/${tokenAccount}/transactions?api-key=${CONFIG.heliusApiKey}&limit=${limit * 2}`
            );
            
            const geodTransactions = [];
            
            for (const tx of response) {
                if (geodTransactions.length >= limit) break;
                if (!tx.tokenTransfers) continue;
                
                for (const transfer of tx.tokenTransfers) {
                    if (transfer.mint === CONFIG.geodMint && transfer.toUserAccount === CONFIG.wallet) {
                        geodTransactions.push({
                            signature: tx.signature,
                            blockTime: tx.timestamp,
                            amount: transfer.tokenAmount,
                            direction: 'in'
                        });
                        break;
                    }
                }
            }
            
            return geodTransactions;
        } catch (error) {
            console.error('Helius API error:', error);
            return [];
        }
    },

    async getGEODTransactionsByDays(days) {
        const now = Math.floor(Date.now() / 1000);
        const startTime = now - (days * 24 * 60 * 60);
        
        const allTransactions = [];
        let batchCount = 0;
        let beforeSignature = null;
        
        while (batchCount < 10) {
            try {
                const tokenAccount = await this.getGEODTokenAccount();
                if (!tokenAccount) break;
                
                let url = `https://api.helius.xyz/v0/addresses/${tokenAccount}/transactions?api-key=${CONFIG.heliusApiKey}&limit=100`;
                if (beforeSignature) {
                    url += `&before=${beforeSignature}`;
                }
                
                const response = await this.fetchJSON(url);
                
                if (!response || response.length === 0) break;
                
                for (const tx of response) {
                    if (tx.timestamp < startTime) {
                        return this.aggregateByDay(allTransactions, days);
                    }
                    
                    if (tx.tokenTransfers) {
                        for (const transfer of tx.tokenTransfers) {
                            if (transfer.mint === CONFIG.geodMint && transfer.toUserAccount === CONFIG.wallet) {
                                allTransactions.push({
                                    blockTime: tx.timestamp,
                                    amount: transfer.tokenAmount
                                });
                                break;
                            }
                        }
                    }
                }
                
                beforeSignature = response[response.length - 1].signature;
                batchCount++;
                
            } catch (error) {
                console.error('Error fetching transactions:', error);
                break;
            }
        }
        
        return this.aggregateByDay(allTransactions, days);
    },

    aggregateByDay(transactions, days) {
        const dailyData = {};
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        
        for (let i = 0; i < days; i++) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            const key = date.toISOString().split('T')[0];
            dailyData[key] = { date: key, amount: 0, count: 0, netFlow: 0 };
        }
        
        for (const tx of transactions) {
            const date = new Date(tx.blockTime * 1000);
            date.setHours(0, 0, 0, 0);
            const key = date.toISOString().split('T')[0];
            
            if (dailyData[key]) {
                dailyData[key].amount += tx.amount;
                dailyData[key].count++;
                dailyData[key].netFlow += tx.amount;
            }
        }
        
        return Object.values(dailyData).sort((a, b) => a.date.localeCompare(b.date));
    },

    async getAllGEODTransfers(days) {
        const now = Math.floor(Date.now() / 1000);
        const startTime = now - (days * 24 * 60 * 60);
        
        const allTransfers = [];
        let batchCount = 0;
        let beforeSignature = null;
        
        while (batchCount < 10) {
            try {
                const tokenAccount = await this.getGEODTokenAccount();
                if (!tokenAccount) break;
                
                let url = `https://api.helius.xyz/v0/addresses/${tokenAccount}/transactions?api-key=${CONFIG.heliusApiKey}&limit=100`;
                if (beforeSignature) {
                    url += `&before=${beforeSignature}`;
                }
                
                const response = await this.fetchJSON(url);
                
                if (!response || response.length === 0) break;
                
                for (const tx of response) {
                    if (tx.timestamp < startTime) {
                        return this.aggregateRewardsByDay(allTransfers, days);
                    }
                    
                    if (tx.tokenTransfers) {
                        for (const transfer of tx.tokenTransfers) {
                            if (transfer.mint === CONFIG.geodMint && transfer.toUserAccount === CONFIG.wallet) {
                                allTransfers.push({
                                    blockTime: tx.timestamp,
                                    amount: transfer.tokenAmount
                                });
                                break;
                            }
                        }
                    }
                }
                
                beforeSignature = response[response.length - 1].signature;
                batchCount++;
                
            } catch (error) {
                console.error('Error fetching transfers:', error);
                break;
            }
        }
        
        return this.aggregateRewardsByDay(allTransfers, days);
    },

    aggregateRewardsByDay(transfers, days) {
        const dailyData = {};
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        
        for (let i = 0; i < days; i++) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            const key = date.toISOString().split('T')[0];
            dailyData[key] = { date: key, netFlow: 0, inFlow: 0, outFlow: 0 };
        }
        
        for (const tx of transfers) {
            const date = new Date(tx.blockTime * 1000);
            date.setHours(0, 0, 0, 0);
            const key = date.toISOString().split('T')[0];
            
            if (dailyData[key]) {
                dailyData[key].netFlow += tx.amount;
                dailyData[key].inFlow += tx.amount;
            }
        }
        
        return Object.values(dailyData).sort((a, b) => a.date.localeCompare(b.date));
    },

    async fetchAllData() {
        const [priceData, geodBalance, usdcBalance, eurRate] = await Promise.all([
            this.getGEODPrice(),
            this.getGEODBalance(),
            this.getUSDCBalance(),
            this.getEURRate()
        ]);

        const geodValue = priceData.price && geodBalance ? priceData.price * geodBalance : 0;
        const portfolioValue = geodValue + usdcBalance || null;

        return {
            price: priceData.price,
            change24h: priceData.change24h,
            geodBalance: geodBalance,
            usdcBalance: usdcBalance,
            portfolioValue: portfolioValue,
            portfolioValueEUR: portfolioValue && eurRate ? portfolioValue * eurRate : null
        };
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
}
