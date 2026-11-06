const { CONFIG } = require('../config');
// Все /api/admin/* — только проверенный (по подписи) владелец. Монтируется ПОСЛЕ auth.
module.exports = (req, res, next) => {
    if (!req.tgUser || Number(req.tgUser.id) !== Number(CONFIG.ADMIN_ID)) {
        console.warn('[admin] отказ:', req.tgUser && req.tgUser.id, req.originalUrl);
        return res.status(403).json({ err: "Доступ запрещён." });
    }
    next();
};
