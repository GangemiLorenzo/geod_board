// Snapshots the old Polygon wallet's history into data/polygon-history.json.
// The wallet is no longer used, so this only needs to run once (via the
// "Polygon snapshot" GitHub Action); the dashboard reads the saved file.
import { writeFileSync, mkdirSync } from 'node:fs';

const address = (process.env.POLYGON_WALLET || '').toLowerCase();
if (!/^0x[0-9a-f]{40}$/.test(address)) {
    throw new Error('POLYGON_WALLET must be a 0x address');
}

const sources = [
    { name: 'blockscout', url: 'https://polygon.blockscout.com/api?' },
    ...(process.env.ETHERSCAN_API_KEY
        ? [{ name: 'etherscan', url: `https://api.etherscan.io/v2/api?chainid=137&apikey=${process.env.ETHERSCAN_API_KEY}&` }]
        : [])
];

async function fetchAll(source, action) {
    const rows = [];
    for (let page = 1; page <= 50; page++) {
        const url = `${source.url}module=account&action=${action}&address=${address}&sort=asc&page=${page}&offset=1000`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${source.name} ${action}: HTTP ${res.status}`);
        const body = await res.json();
        // Blockscout returns status 0 with a warning (but complete rows) when
        // some blocks' internal transactions are still being indexed.
        if (body.status !== '1' && !(Array.isArray(body.result) && body.result.length > 0)) {
            if (/no (transactions|token transfers|internal transactions) found/i.test(body.message || '') ||
                (Array.isArray(body.result) && body.result.length === 0)) break;
            throw new Error(`${source.name} ${action}: ${body.message} ${JSON.stringify(body.result).slice(0, 200)}`);
        }
        rows.push(...body.result);
        if (body.result.length < 1000) break;
    }
    return rows;
}

async function fetchTokenTransfersV2() {
    try {
        const rows = new Map();
        let params = '';
        for (let page = 0; page < 200; page++) {
            const res = await fetch(`https://polygon.blockscout.com/api/v2/addresses/${address}/token-transfers?type=ERC-20${params}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = await res.json();
            for (const t of body.items || []) {
                const hash = t.transaction_hash || t.tx_hash;
                rows.set(`${hash}:${t.log_index}`, {
                    hash,
                    logIndex: +t.log_index,
                    timeStamp: Math.floor(Date.parse(t.timestamp) / 1000),
                    from: t.from.hash.toLowerCase(),
                    to: t.to.hash.toLowerCase(),
                    contractAddress: (t.token.address_hash || t.token.address).toLowerCase(),
                    tokenSymbol: t.token.symbol,
                    tokenDecimal: t.total.decimals ?? t.token.decimals,
                    value: t.total.value
                });
            }
            if (!body.next_page_params) break;
            params = '&' + new URLSearchParams(body.next_page_params).toString();
        }
        return [...rows.values()].sort((a, b) => a.timeStamp - b.timeStamp);
    } catch (error) {
        console.error('v2 API failed:', error.message);
        return null;
    }
}

let snapshot;
for (const source of sources) {
    try {
        const [tokens, txs, internal] = await Promise.all([
            fetchAll(source, 'tokentx'),
            fetchAll(source, 'txlist'),
            fetchAll(source, 'txlistinternal')
        ]);

        const native = [
            ...txs.filter(t => t.value !== '0' && t.isError !== '1')
                .map(t => ({ hash: t.hash, timeStamp: +t.timeStamp, from: t.from, to: t.to, value: t.value })),
            ...internal.filter(t => t.value !== '0' && t.isError !== '1')
                .map(t => ({ hash: t.hash || t.transactionHash, timeStamp: +t.timeStamp, from: t.from, to: t.to, value: t.value, internal: true }))
        ];

        // Prefer Blockscout's v2 API: it includes log indexes, so repeated
        // rows can be dropped without merging distinct transfers.
        let uniqueTokens = source.name === 'blockscout' ? await fetchTokenTransfersV2() : null;
        if (uniqueTokens) {
            console.log(`v2 API: ${uniqueTokens.length} token transfers (v1 API: ${tokens.length})`);
        } else {
            const seen = new Set();
            uniqueTokens = tokens.filter(t => {
                const key = `${t.hash}:${t.logIndex ?? ''}:${t.from}:${t.to}:${t.contractAddress}:${t.value}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        }

        const balances = {};
        for (const contract of [...new Set(uniqueTokens.map(t => t.contractAddress.toLowerCase()))]) {
            const res = await fetch(`${source.url}module=account&action=tokenbalance&contractaddress=${contract}&address=${address}`);
            const body = await res.json();
            if (body.status === '1' && body.result !== '0') balances[contract] = body.result;
        }
        const polRes = await (await fetch(`${source.url}module=account&action=balance&address=${address}`)).json();
        if (polRes.status === '1') balances.native = polRes.result;

        snapshot = {
            address,
            source: source.name,
            fetchedAt: new Date().toISOString(),
            balances,
            tokenTransfers: uniqueTokens.map(t => ({
                hash: t.hash,
                logIndex: t.logIndex === '' || t.logIndex == null ? null : +t.logIndex,
                timeStamp: +t.timeStamp,
                from: t.from,
                to: t.to,
                contract: t.contractAddress.toLowerCase(),
                symbol: t.tokenSymbol,
                decimals: +t.tokenDecimal,
                value: t.value
            })),
            nativeTransfers: native
        };
        for (const [contract, raw] of Object.entries(balances)) {
            if (contract === 'native') continue;
            const rows = uniqueTokens.filter(t => t.contractAddress.toLowerCase() === contract);
            const net = rows.reduce((sum, t) => sum + (t.to === address ? 1n : t.from === address ? -1n : 0n) * BigInt(t.value), 0n);
            console.log(`check ${rows[0]?.tokenSymbol}: on-chain ${raw}, from transfers ${net}`);
        }
        console.log(`${source.name}: ${uniqueTokens.length} token transfers, ${native.length} POL transfers`);
        break;
    } catch (error) {
        console.error(error.message);
    }
}

if (!snapshot) throw new Error('All sources failed');

mkdirSync('data', { recursive: true });
writeFileSync('data/polygon-history.json', JSON.stringify(snapshot, null, 1) + '\n');
