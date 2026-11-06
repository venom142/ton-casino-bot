const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { safeUid } = require('../utils/helpers');
const { debit, credit } = require('../utils/wallet');
const state = require('../state');

router.post('/spin', async (req, res) => {
    try {
        const { uid, bet } = req.body;
        const uidStr = safeUid(uid);
        const safeBet = Math.floor(Number(bet));
        if (!uidStr || isNaN(safeBet) || safeBet < state.SETTINGS.minBet) return res.json({ err: "Ошибка ставки" });
        if (!uidStr || !Number.isFinite(safeBet) || safeBet > 1e9) return res.json({ err: "Ошибка ставки" });
        // АТОМАРНО: ставка списывается только если хватает баланса (защита от гонок)
        const debited = await debit(uidStr, safeBet, `🎰 Слот -${safeBet} 💎`, { spins: 1 });
        if (!debited) return res.json({ err: "Мало 💎 ХОТ ТАП!" });
        const items = ['🍒','🔔','💎','7️⃣','🍋'];
        let result = [items[Math.floor(Math.random()*5)], items[Math.floor(Math.random()*5)], items[Math.floor(Math.random()*5)]];
        if (Math.random() < state.SETTINGS.winChance) result = ['7️⃣','7️⃣','7️⃣'];
        const isWin = result[0] === result[1] && result[1] === result[2];
        const winSum = isWin ? Math.floor(safeBet * state.SETTINGS.multiplier) : 0;
        let balance = debited.balance;
        if (isWin) {
            const w = await credit(uidStr, winSum, `🎰 Слот win +${winSum} 💎`, { wins: 1 });
            if (w) balance = w.balance;
        }
        res.json({ result, winSum, balance: Math.floor(balance) });
    } catch (e) { res.json({ err: "Ошибка спина" }); }
});

module.exports = router;
