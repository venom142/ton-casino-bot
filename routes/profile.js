const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { safeUid } = require('../utils/helpers');

router.post('/sync', async (req, res) => {
    try {
        const uid = safeUid(req.body?.uid);
        const user = uid ? await User.findOne({ uid }) : null;
        res.json(user || { balance: 0 });
    } catch (e) { res.json({ balance: 0 }); }
});

router.post('/profile', async (req, res) => {
    try {
        const uid = safeUid(req.body?.uid);
        if (!uid) return res.json({ err: "Ошибка профиля" });
        const user = await User.findOne({ uid });
        if (!user) return res.json({ err: "Ошибка профиля" });
        res.json({
            uid: user.uid,
            username: user.username,
            balance: Math.floor(user.balance || 0),
            spins: user.spins || 0,
            wins: user.wins || 0,
            is_vip: user.is_vip || false,
            promos: user.used_promos ? user.used_promos.length : 0,
            lastActive: user.last_active || null,
            version: "VIP ХОТ ТАП Alpha 2.0",
            history: (user.history || []).slice(0, 10).map(h => ({ text: h.text, amount: h.amount || 0, createdAt: h.createdAt }))
        });
    } catch (e) { res.json({ err: "Ошибка профиля" }); }
});

router.post('/leaderboard', async (req, res) => {
    try {
        const tops = await User.find().sort({ balance: -1 }).limit(10);
        res.json(tops.map(u => {
            const uid = safeUid(u.uid) || 'player';
            return { uid: uid.substring(0, 3) + "***" + uid.substring(Math.max(uid.length - 2, 0)), balance: Math.floor(u.balance || 0) };
        }));
    } catch (e) { res.json([]); }
});

module.exports = router;
