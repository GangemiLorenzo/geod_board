const Utils = {
    formatPrice(value, decimals = 4) {
        if (value === null || value === undefined) return '--';
        return '$' + parseFloat(value).toFixed(decimals);
    },

    formatNumber(value, decimals = 2) {
        if (value === null || value === undefined) return '--';
        return parseFloat(value).toLocaleString('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    },

    formatChange(value) {
        if (value === null || value === undefined) return '--';
        const sign = value >= 0 ? '+' : '';
        return sign + parseFloat(value).toFixed(2) + '%';
    },

    formatBalance(value, decimals = 4) {
        if (value === null || value === undefined) return '--';
        return parseFloat(value).toFixed(decimals);
    },

    formatTimestamp(timestamp) {
        const date = new Date(timestamp * 1000);
        return date.toLocaleString('en-US', {
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    },

    formatDate(date) {
        if (typeof date === 'number') {
            date = new Date(date);
        }
        return date.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    },

    timeAgo(timestamp) {
        const hours = Math.floor((Date.now() / 1000 - timestamp) / 3600);
        if (hours < 1) return 'just now';
        if (hours < 48) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
        return Math.floor(hours / 24) + ' days ago';
    },

    shortenAddress(address, chars = 6) {
        if (!address) return '--';
        return address.slice(0, chars) + '...' + address.slice(-chars);
    },

    shortenSignature(sig, chars = 8) {
        if (!sig) return '--';
        return sig.slice(0, chars) + '...' + sig.slice(-chars);
    },

    lamportsToSol(lamports) {
        return lamports / 1000000000;
    },

    base64ToUint8Array(base64) {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    },

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Utils;
}
