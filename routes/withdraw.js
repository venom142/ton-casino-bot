const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { safeUid } = require('../utils/helpers');
const { debit, credit } = require('../utils/wallet');
const { CONFIG } = require('../config');

module.exports = (bot) => {
    router.post('/withdraw', async (req, res) => {
        try {
            const { uid, amount, address } = req.body; 
            const uidStr = safeUid(uid);
            if (!uidStr) return res.json({ err: "Ошибка профиля" });
            const safeAmount = Math.floor(Number(amount));
            if (!Number.isFinite(safeAmount) || safeAmount < 10 || safeAmount > 1e9) return res.json({ err: "Мин. вывод 10 💎" });
            const addr = typeof address === 'string' ? address.trim() : '';
            // TON: user-friendly (48 симв. base64url) или raw (0:hex64)
            if (!/^[A-Za-z0-9_\-]{48}$/.test(addr) && !/^-?\d:[0-9a-fA-F]{64}$/.test(addr)) return res.json({ err: "Укажи нормальный кошелёк" });
            // АТОМАРНО: сумма замораживается сразу — нельзя создать заявок больше, чем баланс
            const user = await debit(uidStr, safeAmount, `🏦 Заявка на вывод -${safeAmount} 💎`);
            if (!user) return res.json({ err: "Мало 💎 ХОТ ТАП!" });

            let tx;
            try {
                tx = await Transaction.create({ uid: uidStr, type: 'withdraw', amount: safeAmount, status: 'pending', wallet_address: addr, description: 'Заявка на вывод', reserved: true });
            } catch (err) {
                await credit(uidStr, safeAmount, `↩️ Возврат вывода +${safeAmount} 💎`); // заявка не создалась — вернуть
                throw err;
            }

            const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const adminText = `🚨 <b>НОВАЯ ЗАЯВКА НА ВЫВОД</b>\nЮзер ID: <code>${esc(uidStr)}</code>\nСумма: <b>${safeAmount} 💎</b>\nКошелёк: <code>${esc(addr)}</code>\nБаланс после заморозки: <b>${Math.floor(user.balance)} 💎</b>\nTX ID: ${tx._id}`;
            bot.sendMessage(CONFIG.ADMIN_ID, adminText, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "✅ Подтвердить", callback_data: `withdraw_ok_${uidStr}_${safeAmount}_${tx._id}` }],
                        [{ text: "❌ Отклонить", callback_data: `withdraw_no_${uidStr}_${safeAmount}_${tx._id}` }]
                    ]
                }
            }).catch(e => console.error('[withdraw notify]', e.message));
            res.json({ msg: "Заявка отправлена на подтверждение!" });
        } catch (e) { res.json({ err: "Ошибка при создании заявки" }); }
    });
    return router;
};
