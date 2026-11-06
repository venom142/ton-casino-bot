const User = require('../models/User');
const { verifyInitData } = require('../utils/telegramAuth');

// Публичные маршруты (без входа): проверка техработ
const PUBLIC = new Set(['/maintenance']);

// Монтируется на '/api'. Проверяет подпись initData, ставит req.tgUser и ПЕРЕЗАПИСЫВАЕТ uid
// в body/query проверенным значением — подделать чужой uid невозможно.
module.exports = async (req, res, next) => {
    if (PUBLIC.has(req.path)) return next();
    const initData = req.get('x-telegram-init-data');
    const tgUser = verifyInitData(initData, process.env.BOT_TOKEN);
    if (!tgUser) return res.status(401).json({ err: "Нет доступа. Откройте приложение через бота.", auth: false });

    req.tgUser = tgUser;
    const uid = String(tgUser.id);
    if (req.body && typeof req.body === 'object') req.body.uid = uid;
    req.query.uid = uid;

    try {
        const user = await User.findOne({ uid }).select('is_banned ban_reason balance').lean();
        if (user && user.is_banned) {
            if (req.path === '/sync') {
                return res.json({ is_banned: true, ban_reason: user.ban_reason || 'Нарушение правил', balance: user.balance || 0 });
            }
            return res.status(403).json({ err: "🚫 Ваш аккаунт заблокирован." });
        }
    } catch (e) {
        // Проверка бана не должна «пропускать» при сбое БД
        console.error('[auth] db error:', e.message);
        return res.status(503).json({ err: "Сервис временно недоступен. Попробуйте позже." });
    }
    next();
};
