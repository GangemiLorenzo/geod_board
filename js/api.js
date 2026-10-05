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

    async getTokenAccountHistory(mint, maxPages = 1) {
        const tokenAccount = await this.getTokenAccount(mint);
        if (!tokenAccount) return [];

        const txs = [];
        let before = '';
        for (let page = 0; page < maxPages; page++) {
            const batch = await this.fetchJSON(
                `https://api.helius.xyz/v0/addresses/${tokenAccount}/transactions?api-key=${CONFIG.heliusApiKey}&limit=100${before}`
            );
            txs.push(...batch);
            if (batch.length < 100) break;
            before = `&before=${batch[batch.length - 1].signature}`;
        }
        return txs;
    },

    // Solana wallet: GEOD/USDC transactions as plain-language activity entries.
    async getWalletActivity() {
        const [geodTxs, usdcTxs] = await Promise.all([
            this.getTokenAccountHistory(CONFIG.geodMint, 10),
            this.getTokenAccountHistory(CONFIG.usdcMint)
        ]);

        const bySignature = new Map();
        for (const tx of [...geodTxs, ...usdcTxs]) {
            bySignature.set(tx.signature, tx);
        }

        const moves = [];
        for (const tx of bySignature.values()) {
            const move = { chain: 'solana', signature: tx.signature, timestamp: tx.timestamp,
                geod: 0, usd: 0, pol: 0, isSwap: tx.type === 'SWAP', geodFrom: null, geodTo: null };

            for (const t of tx.tokenTransfers || []) {
                const sign = t.toUserAccount === CONFIG.wallet ? 1
                    : t.fromUserAccount === CONFIG.wallet ? -1 : 0;
                if (t.mint === CONFIG.geodMint) {
                    move.geod += sign * t.tokenAmount;
                    if (sign > 0) move.geodFrom = t.fromUserAccount;
                    if (sign < 0) move.geodTo = t.toUserAccount;
                } else if (t.mint === CONFIG.usdcMint) {
                    move.usd += sign * t.tokenAmount;
                }
            }
            moves.push(move);
        }

        return this.classifyMoves(moves);
    },

    // Old Polygon wallet: read from the snapshot saved by the "Polygon snapshot"
    // GitHub Action. Only GEOD, dollar stablecoins and POL are considered, which
    // also hides the spam tokens scammers airdrop to Polygon wallets.
    async getPolygonActivity() {
        const snapshot = await this.fetchJSON(CONFIG.polygon.snapshotUrl);
        const wallet = snapshot.address;
        const geodContract = CONFIG.polygon.geodContract;
        const usdContracts = Object.keys(CONFIG.polygon.usdContracts);
        const byHash = new Map();
        const moveFor = (hash, timestamp) => {
            if (!byHash.has(hash)) {
                byHash.set(hash, { chain: 'polygon', signature: hash, timestamp,
                    geod: 0, usd: 0, pol: 0, isSwap: false, geodFrom: null, geodTo: null });
            }
            return byHash.get(hash);
        };

        for (const t of snapshot.tokenTransfers) {
            const isGeod = t.contract === geodContract;
            if (!isGeod && !usdContracts.includes(t.contract)) continue;

            const sign = t.to === wallet ? 1 : t.from === wallet ? -1 : 0;
            const amount = sign * Number(t.value) / Math.pow(10, t.decimals);
            const move = moveFor(t.hash, t.timeStamp);
            if (isGeod) {
                move.geod += amount;
                if (sign > 0) move.geodFrom = t.from;
                if (sign < 0) move.geodTo = t.to;
            } else {
                move.usd += amount;
            }
        }

        for (const t of snapshot.nativeTransfers) {
            if (!t.hash) continue;
            const sign = t.to === wallet ? 1 : t.from === wallet ? -1 : 0;
            moveFor(t.hash, t.timeStamp).pol += sign * Number(t.value) / 1e18;
        }

        return this.classifyMoves([...byHash.values()]);
    },

    classifyMoves(moves) {
        const entries = [];
        const geodSenders = {};

        for (const m of moves) {
            // Ignore dust (spam "address poisoning" transfers and rounding leftovers).
            if (Math.abs(m.geod) < 0.01 && Math.abs(m.usd) < 0.1) continue;

            let kind;
            if (m.geod > 0 && (m.usd < 0 || m.isSwap)) kind = 'buy';
            else if (m.geod < 0 && (m.usd > 0 || m.isSwap)) kind = 'sell';
            else if (m.geod < 0 && m.geodTo === CONFIG.polygon.bridgeAddress) kind = 'migrate-out';
            else if (m.geod > 0) kind = 'geod-in';
            else if (m.geod < 0) kind = 'geod-out';
            else if (m.usd < 0 && m.pol > 0) kind = 'gas';
            else if (m.isSwap) kind = m.usd > 0 ? 'sell' : 'buy';
            else kind = m.usd > 0 ? 'usdc-in' : 'usdc-out';

            if (kind === 'geod-in' && m.geodFrom) {
                geodSenders[m.geodFrom] = (geodSenders[m.geodFrom] || 0) + 1;
            }

            entries.push({ chain: m.chain, signature: m.signature, timestamp: m.timestamp,
                kind, geod: m.geod, usdc: m.usd, geodFrom: m.geodFrom });
        }

        // Mining payouts all come from the same distributor wallet, so the most
        // frequent GEOD sender is treated as the reward source.
        const rewardSender = Object.entries(geodSenders)
            .filter(([, count]) => count >= 3)
            .sort((a, b) => b[1] - a[1])[0]?.[0];

        for (const entry of entries) {
            if (entry.kind === 'geod-in' && entry.geodFrom === rewardSender) {
                entry.kind = 'reward';
            } else if (entry.kind === 'geod-in' && entry.chain === 'solana' &&
                Math.abs(entry.timestamp - CONFIG.polygon.migratedAt) < 3 * 86400) {
                entry.kind = 'migrate-in';
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
