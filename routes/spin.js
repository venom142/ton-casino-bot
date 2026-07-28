const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { addHistory, safeUid } = require('../utils/helpers');
const state = require('../state');

router.post('/spin', async (req, res) => {
    try {
        const { uid, bet } = req.body;
        const uidStr = safeUid(uid);
        const safeBet = Math.floor(Number(bet));
        if (!uidStr || isNaN(safeBet) || safeBet < state.SETTINGS.minBet) return res.json({ err: "Ошибка ставки" });
        const user = await User.findOne({ uid: uidStr });
        if (!user || user.balance < safeBet) return res.json({ err: "Мало 💎 ХОТ ТАП!" });
        user.balance -= safeBet;
        const items = ['🍒','🔔','💎','7️⃣','🍋'];
        let result = [items[Math.floor(Math.random()*5)], items[Math.floor(Math.random()*5)], items[Math.floor(Math.random()*5)]];
        if (Math.random() < state.SETTINGS.winChance) result = ['7️⃣','7️⃣','7️⃣'];
        const isWin = result[0] === result[1] && result[1] === result[2];
        const winSum = isWin ? Math.floor(safeBet * state.SETTINGS.multiplier) : 0;
        user.balance += winSum;
        user.spins++;
        addHistory(user, `🎰 Слот -${safeBet} 💎`, -safeBet);
        if(isWin) { user.wins++; addHistory(user, `🎰 Слот win +${winSum} 💎`, winSum); }
        await user.save();
        res.json({ result, winSum, balance: Math.floor(user.balance) });
    } catch (e) { res.json({ err: "Ошибка спина" }); }
});

module.exports = router;
