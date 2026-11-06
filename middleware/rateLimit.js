// Простой лимитер запросов в памяти (без внешних пакетов). Ключ — проверенный uid, иначе IP.
function createLimiter({ windowMs, max, message }) {
    const hits = new Map();
    const timer = setInterval(() => {
        const now = Date.now();
        for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
    }, windowMs);
    if (timer && timer.unref) timer.unref();
    return (req, res, next) => {
        const key = (req.tgUser && req.tgUser.id) ? 'u' + req.tgUser.id : 'ip' + (req.ip || '');
        const now = Date.now();
        let h = hits.get(key);
        if (!h || now - h.start > windowMs) { h = { start: now, count: 0 }; hits.set(key, h); }
        h.count++;
        if (h.count > max) return res.status(429).json({ err: message || 'Слишком много запросов. Подождите немного.' });
        next();
    };
}
module.exports = { createLimiter };
