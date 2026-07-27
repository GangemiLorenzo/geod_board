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

    async getGEODTokenAccount() {
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
            return null;
        }
        
        return accounts[0].pubkey;
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
        const [priceData, geodBalance, usdcBalance] = await Promise.all([
            this.getGEODPrice(),
            this.getGEODBalance(),
            this.getUSDCBalance()
        ]);

        const geodValue = priceData.price && geodBalance ? priceData.price * geodBalance : 0;

        return {
            price: priceData.price,
            change24h: priceData.change24h,
            geodBalance: geodBalance,
            usdcBalance: usdcBalance,
            portfolioValue: geodValue + usdcBalance || null
        };
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
}
