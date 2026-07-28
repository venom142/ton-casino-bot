const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { safeUid } = require('../utils/helpers');
const { CONFIG } = require('../config');

module.exports = (bot) => {
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

            // Создаём заявку
            const tx = await Transaction.create({
                uid: uidStr,
                type: 'withdraw',
                amount: safeAmount,
                status: 'pending',
                wallet_address: address,
                description: 'Заявка на вывод'
            });

            const adminText = `🚨 **НОВАЯ ЗАЯВКА НА ВЫВОД**\nЮзер ID: \`${uidStr}\`\nСумма: **${safeAmount} 💎**\nКошелёк: \`${address}\`\nБаланс: **${user.balance} 💎**\nTX ID: ${tx._id}`;
            bot.sendMessage(CONFIG.ADMIN_ID, adminText, { 
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "✅ Подтвердить", callback_data: `withdraw_ok_${uidStr}_${safeAmount}_${tx._id}` }],
                        [{ text: "❌ Отклонить", callback_data: `withdraw_no_${uidStr}_${safeAmount}_${tx._id}` }]
                    ]
                }
            });
            res.json({ msg: "Заявка отправлена на подтверждение!" });
        } catch (e) { res.json({ err: "Ошибка при создании заявки" }); }
    });
    return router;
};
