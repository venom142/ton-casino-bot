const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Promo = require('../models/Promo');
const { addHistory, safeUid } = require('../utils/helpers');

router.post('/promo', async (req, res) => {
    try {
        const { uid, promo } = req.body; 
        const p = promo?.toUpperCase();
        const uidStr = safeUid(uid);
        if (!uidStr) return res.json({ err: "Ошибка профиля" });
        const user = await User.findOne({ uid: uidStr });
        if (!user) return res.json({ err: "Ошибка профиля" });
        const pr = await Promo.findOne({ code: p });
        if (!pr) return res.json({ err: "❌ Неверный промокод!" });
        if (user.used_promos.includes(p)) return res.json({ err: "⚠️ Вы уже использовали этот код!" });
        if (pr.usedCount >= pr.limit) return res.json({ err: "🚫 Лимит исчерпан!" });
        if (pr.expires_at && new Date() > pr.expires_at) return res.json({ err: "🚫 Промокод просрочен!" });
        if (pr.vip_only && !user.is_vip) return res.json({ err: "⭐ Только для VIP!" });
        if (pr.new_only && (Date.now() - new Date(user.created_at).getTime()) > 86400000 * 7) return res.json({ err: "🆕 Только для новых игроков!" });
        user.balance += pr.value;
        user.used_promos.push(p);
        addHistory(user, `🎁 Промо +${pr.value} 💎`, pr.value);
        await user.save();
        pr.usedCount += 1; 
        await pr.save(); 
        res.json({ msg: `🎁 Начислено +${pr.value} 💎.` });
    } catch (e) { res.json({ err: "Ошибка сервера" }); }
});

module.exports = router;
