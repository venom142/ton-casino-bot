function addHistory(user, text, amount = 0) {
    if (!user) return;
    if (!Array.isArray(user.history)) user.history = [];
    user.history.unshift({
        text: text,
        amount: Math.floor(Number(amount) || 0),
        createdAt: new Date()
    });
    user.history = user.history.slice(0, 20);
}

function safeUid(uid) {
    return uid === undefined || uid === null ? '' : String(uid).trim();
}

function formatNumber(n) {
    return Number(n).toLocaleString('ru-RU');
}

function timeAgo(date) {
    if (!date) return "никогда";
    const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (diff < 60) return `${diff}с`;
    if (diff < 3600) return `${Math.floor(diff/60)}м`;
    if (diff < 86400) return `${Math.floor(diff/3600)}ч`;
    return `${Math.floor(diff/86400)}д`;
}

module.exports = { addHistory, safeUid, formatNumber, timeAgo };
