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

module.exports = { addHistory, safeUid };
