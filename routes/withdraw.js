const express = require('express');
const User = require('../models/User');
const { safeUid } = require('../utils/helpers');

module.exports = (bot, CONFIG) => {
    const router = express.Router();
    router.post('/withdraw', async (req, res) => {
        try {
            const { uid, amount, address } = req.body; 
            const uidStr = safeUid(uid);
            if (!uidStr) return res.json({ err: "Ошибка профиля" });
            const user = await User.findOne({ uid: uidStr });
            if (!user) return res.json({ err: "Ошибка профиля" });
            const safeAmount = Math.floor(Number(amount));
            if (isNaN(safeAmount) || safeAmount < 10) return res.json({ err: "Мин. вывод 10 💎" });
            if (!address || address.length < 20) return res.json({ err: "Укажи нормальный кошелёк" });
            if (user.balance < safeAmount) return res.json({ err: "Мало 💎 ХОТ ТАП!" });
            const adminText = `🚨 **НОВАЯ ЗАЯВКА НА ВЫВОД**\nЮзер ID: \`${uidStr}\`\nСумма вывода: **${safeAmount} 💎**\nКошелёк: \`${address}\`\nТекущий баланс игрока: **${user.balance} 💎**`;
            bot.sendMessage(CONFIG.ADMIN_ID, adminText, { 
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "✅ Подтвердить вывод", callback_data: `withdraw_ok_${uidStr}_${safeAmount}` }],
                        [{ text: "❌ Отклонить вывод", callback_data: `withdraw_no_${uidStr}_${safeAmount}` }]
                    ]
                }
            });
            res.json({ msg: "Заявка отправлена на подтверждение админу!" });
        } catch (e) { res.json({ err: "Ошибка при создании заявки" }); }
    });
    return router;
};
