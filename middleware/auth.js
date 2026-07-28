const User = require('../models/User');

module.exports = async (req, res, next) => {
    const uid = req.body?.uid || req.query?.uid;
    if (!uid) return next();
    try {
        const user = await User.findOne({ uid: String(uid) });
        if (user && user.is_banned) {
            return res.status(403).json({ err: "🚫 Ваш аккаунт заблокирован." });
        }
    } catch(e) {}
    next();
};
