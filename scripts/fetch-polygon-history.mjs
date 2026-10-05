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
        if (body.status !== '1') {
            if (/no (transactions|token transfers|internal transactions) found/i.test(body.message || '') ||
                (Array.isArray(body.result) && body.result.length === 0)) break;
            throw new Error(`${source.name} ${action}: ${body.message} ${JSON.stringify(body.result).slice(0, 200)}`);
        }
        rows.push(...body.result);
        if (body.result.length < 1000) break;
    }
    return rows;
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
                .map(t => ({ hash: t.hash, timeStamp: +t.timeStamp, from: t.from, to: t.to, value: t.value }))
        ];

        snapshot = {
            address,
            source: source.name,
            fetchedAt: new Date().toISOString(),
            tokenTransfers: tokens.map(t => ({
                hash: t.hash,
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
        console.log(`${source.name}: ${tokens.length} token transfers, ${native.length} POL transfers`);
        break;
    } catch (error) {
        console.error(error.message);
    }
}

if (!snapshot) throw new Error('All sources failed');

mkdirSync('data', { recursive: true });
writeFileSync('data/polygon-history.json', JSON.stringify(snapshot, null, 1) + '\n');
