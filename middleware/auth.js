const User = require('../models/User');

module.exports = async (req, res, next) => {
    const uid = req.body?.uid || req.query?.uid;
    if (!uid) return next();
    try {
        const user = await User.findOne({ uid: String(uid) });
        if (user && user.is_banned) {
            // Для sync возвращаем статус, чтобы WebApp показал бан-экран
            if (req.path === '/sync') {
                return res.json({ 
                    is_banned: true, 
                    ban_reason: user.ban_reason || 'Нарушение правил',
                    balance: user.balance || 0 
                });
            }
            return res.status(403).json({ err: "🚫 Ваш аккаунт заблокирован." });
        }
    } catch(e) {}
    next();
};
