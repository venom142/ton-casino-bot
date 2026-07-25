const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { addHistory, safeUid } = require('../utils/helpers');

router.post('/roulette', async (req, res) => {
    try {
        const { uid } = req.body;
        const uidStr = safeUid(uid);
        if (!uidStr) return res.json({ err: "Ошибка профиля" });
        const user = await User.findOne({ uid: uidStr });
        if (!user) return res.json({ err: "Ошибка профиля" });

        const now = Date.now();
        const dayMs = 24 * 60 * 60 * 1000;
        const lastSpin = user.last_roulette_at ? new Date(user.last_roulette_at).getTime() : 0;
        if (lastSpin && now - lastSpin < dayMs) {
            const remainingMinutes = Math.max(1, Math.ceil((dayMs - (now - lastSpin)) / 60000));
            const hours = Math.floor(remainingMinutes / 60);
            const minutes = remainingMinutes % 60;
            return res.json({ err: `⏰ Вы уже использовали бесплатную рулетку.\nПопробуйте снова через: ${hours} ч ${minutes} мин.` });
        }

        const prizes = [
            { label: "💎 +10", amount: 10, chance: 30 },
            { label: "💎 +25", amount: 25, chance: 20 },
            { label: "💎 +50", amount: 50, chance: 10 },
            { label: "💎 +100", amount: 100, chance: 5 },
            { label: "😭 Пусто", amount: 0, chance: 35 }
        ];
        const roll = Math.random() * 100;
        let sum = 0;
        let prize = prizes[prizes.length - 1];
        for (const item of prizes) {
            sum += item.chance;
            if (roll < sum) { prize = item; break; }
        }

        user.last_roulette_at = new Date(now);
        if (prize.amount > 0) {
            user.balance += prize.amount;
            addHistory(user, `🎡 Рулетка ${prize.label}`, prize.amount);
        } else {
            addHistory(user, "🎡 Рулетка: пусто", 0);
        }
        await user.save();
        res.json({ prize: prize.label, amount: prize.amount, balance: Math.floor(user.balance), msg: prize.amount > 0 ? `🎡 Выпал приз ${prize.label}!` : "😭 В этот раз пусто" });
    } catch (e) { res.json({ err: "Ошибка рулетки" }); }
});

module.exports = router;
