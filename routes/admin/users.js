const express = require('express');
const router = express.Router();
const User = require('../../models/User');
const Ban = require('../../models/Ban');
const AdminLog = require('../../models/AdminLog');
const { addHistory, safeUid } = require('../../utils/helpers');

module.exports = (bot) => {
    // Поиск пользователя
    router.post('/admin/users/search', async (req, res) => {
        try {
            const { query } = req.body;
            if (!query) return res.json({ err: "Введите ID или username" });

            let user;
            if (/^\d+$/.test(query)) {
                user = await User.findOne({ uid: query });
            } else {
                user = await User.findOne({ username: { $regex: query, $options: 'i' } });
            }

            if (!user) return res.json({ err: "Игрок не найден" });

            res.json({
                uid: user.uid,
                username: user.username,
                first_name: user.first_name,
                balance: user.balance,
                spins: user.spins,
                wins: user.wins,
                is_vip: user.is_vip,
                is_banned: user.is_banned,
                ban_reason: user.ban_reason,
                country: user.country,
                ip: user.ip,
                created_at: user.created_at,
                last_active: user.last_active,
                history: user.history?.slice(0, 10) || []
            });
        } catch(e) { res.json({ err: "Ошибка поиска" }); }
    });

    // Выдать/снять баланс
    router.post('/admin/users/balance', async (req, res) => {
        try {
            const { uid, amount, reason } = req.body;
            const uidStr = safeUid(uid);
            const amt = Math.floor(Number(amount));
            if (!uidStr || isNaN(amt)) return res.json({ err: "Ошибка данных" });

            const user = await User.findOne({ uid: uidStr });
            if (!user) return res.json({ err: "Игрок не найден" });

            user.balance += amt;
            if (user.balance < 0) user.balance = 0;

            const actionText = amt >= 0 ? `👑 Админ +${amt} 💎` : `👑 Админ ${amt} 💎`;
            addHistory(user, actionText, amt);
            await user.save();

            await AdminLog.create({
                action: amt >= 0 ? 'balance_add' : 'balance_remove',
                target_uid: uidStr,
                amount: amt,
                details: reason || 'Без причины'
            });

            bot.sendMessage(uidStr, amt >= 0 ? `🎁 Администратор начислил ${amt} 💎` : `⚠️ Администратор списал ${Math.abs(amt)} 💎`).catch(()=>{});
            res.json({ success: true, balance: user.balance });
        } catch(e) { res.json({ err: "Ошибка" }); }
    });

    // VIP статус
    router.post('/admin/users/vip', async (req, res) => {
        try {
            const { uid, status } = req.body;
            const uidStr = safeUid(uid);
            const user = await User.findOneAndUpdate({ uid: uidStr }, { is_vip: !!status }, { new: true });
            if (!user) return res.json({ err: "Игрок не найден" });

            await AdminLog.create({ action: status ? 'vip_give' : 'vip_remove', target_uid: uidStr });
            bot.sendMessage(uidStr, status ? "⭐ Вам выдан VIP статус!" : "⭐ VIP статус снят.").catch(()=>{});
            res.json({ success: true });
        } catch(e) { res.json({ err: "Ошибка" }); }
    });

    // Бан
    router.post('/admin/users/ban', async (req, res) => {
        try {
            const { uid, reason, duration } = req.body;
            const uidStr = safeUid(uid);
            const user = await User.findOneAndUpdate(
                { uid: uidStr },
                { is_banned: true, ban_reason: reason || 'Нарушение правил' },
                { new: true }
            );
            if (!user) return res.json({ err: "Игрок не найден" });

            const expires = duration ? new Date(Date.now() + duration * 86400000) : null;
            await Ban.create({ uid: uidStr, reason: reason || 'Нарушение правил', banned_by: 'admin', expires_at: expires });
            await AdminLog.create({ action: 'ban', target_uid: uidStr, details: reason });

            bot.sendMessage(uidStr, `🚫 Ваш аккаунт заблокирован.\nПричина: ${reason || 'Нарушение правил'}`).catch(()=>{});
            res.json({ success: true });
        } catch(e) { res.json({ err: "Ошибка" }); }
    });

    // Разбан
    router.post('/admin/users/unban', async (req, res) => {
        try {
            const { uid } = req.body;
            const uidStr = safeUid(uid);
            await User.findOneAndUpdate({ uid: uidStr }, { is_banned: false, ban_reason: null });
            await Ban.deleteMany({ uid: uidStr });
            await AdminLog.create({ action: 'unban', target_uid: uidStr });
            bot.sendMessage(uidStr, "✅ Ваш аккаунт разблокирован.").catch(()=>{});
            res.json({ success: true });
        } catch(e) { res.json({ err: "Ошибка" }); }
    });

    return router;
};
