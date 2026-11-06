const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Promo = require('../models/Promo');
const { safeUid } = require('../utils/helpers');
const { histEntry } = require('../utils/wallet');

router.post('/promo', async (req, res) => {
    try {
        const { uid, promo } = req.body;
        const p = typeof promo === 'string' ? promo.trim().toUpperCase().slice(0, 64) : '';
        const uidStr = safeUid(uid);
        if (!uidStr) return res.json({ err: "Ошибка профиля" });
        if (!p) return res.json({ err: "❌ Неверный промокод!" });
        const user = await User.findOne({ uid: uidStr });
        if (!user) return res.json({ err: "Ошибка профиля" });
        const pr = await Promo.findOne({ code: p });
        if (!pr) return res.json({ err: "❌ Неверный промокод!" });
        if (user.used_promos.includes(p)) return res.json({ err: "⚠️ Вы уже использовали этот код!" });
        if (pr.usedCount >= pr.limit) return res.json({ err: "🚫 Лимит исчерпан!" });
        if (pr.expires_at && new Date() > pr.expires_at) return res.json({ err: "🚫 Промокод просрочен!" });
        if (pr.vip_only && !user.is_vip) return res.json({ err: "⭐ Только для VIP!" });
        if (pr.new_only && (Date.now() - new Date(user.created_at).getTime()) > 86400000 * 7) return res.json({ err: "🆕 Только для новых игроков!" });
        // АТОМАРНО 1: занять место в лимите промокода
        const slot = await Promo.findOneAndUpdate(
            { _id: pr._id, $or: [{ limit: null }, { $expr: { $lt: ['$usedCount', '$limit'] } }] },
            { $inc: { usedCount: 1 } }
        );
        if (!slot) return res.json({ err: "🚫 Лимит исчерпан!" });
        // АТОМАРНО 2: начислить, только если игрок ещё не использовал код
        const value = Math.floor(Number(pr.value) || 0);
        const done = await User.findOneAndUpdate(
            { uid: uidStr, used_promos: { $ne: p } },
            { $inc: { balance: value }, $push: { used_promos: p, history: histEntry(`🎁 Промо +${value} 💎`, value) } },
            { new: true }
        );
        if (!done) {
            await Promo.updateOne({ _id: pr._id }, { $inc: { usedCount: -1 } }); // вернуть место
            return res.json({ err: "⚠️ Вы уже использовали этот код!" });
        }
        res.json({ msg: `🎁 Начислено +${value} 💎.` });
    } catch (e) { res.json({ err: "Ошибка сервера" }); }
});

module.exports = router;
