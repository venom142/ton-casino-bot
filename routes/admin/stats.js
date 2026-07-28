const express = require('express');
const router = express.Router();
const User = require('../../models/User');
const Transaction = require('../../models/Transaction');
const state = require('../../state');
const { CONFIG } = require('../../config');

module.exports = (bot) => {
    router.get('/admin/stats', async (req, res) => {
        try {
            const totalUsers = await User.countDocuments();
            const newToday = await User.countDocuments({ created_at: { $gte: new Date(Date.now() - 86400000) } });
            const newWeek = await User.countDocuments({ created_at: { $gte: new Date(Date.now() - 604800000) } });
            const activeToday = await User.countDocuments({ last_active: { $gte: new Date(Date.now() - 86400000) } });

            const totalBalance = await User.aggregate([{ $group: { _id: null, sum: { $sum: "$balance" } } }]);
            const totalDeposited = await Transaction.aggregate([
                { $match: { type: 'deposit', status: 'completed' } },
                { $group: { _id: null, sum: { $sum: "$ton_amount" } } }
            ]);
            const totalWithdrawn = await Transaction.aggregate([
                { $match: { type: 'withdraw', status: 'completed' } },
                { $group: { _id: null, sum: { $sum: "$amount" } } }
            ]);
            const pendingWithdraws = await Transaction.countDocuments({ type: 'withdraw', status: 'pending' });

            const topPlayers = await User.find().sort({ balance: -1 }).limit(10).select('uid username balance spins wins');
            const biggestWins = await Transaction.find({ type: 'withdraw', status: 'completed' }).sort({ amount: -1 }).limit(10);

            const uptime = Math.floor((Date.now() - state.SERVER_START_TIME) / 1000);

            res.json({
                users: { total: totalUsers, newToday, newWeek, activeToday },
                finance: {
                    totalBalance: totalBalance[0]?.sum || 0,
                    totalDeposited: totalDeposited[0]?.sum || 0,
                    totalWithdrawn: totalWithdrawn[0]?.sum || 0,
                    pendingWithdraws
                },
                topPlayers: topPlayers.map(u => ({ uid: u.uid, username: u.username, balance: u.balance, spins: u.spins, wins: u.wins })),
                biggestWins: biggestWins.map(t => ({ uid: t.uid, amount: t.amount, date: t.created_at })),
                uptime: `${Math.floor(uptime/3600)}ч ${Math.floor((uptime%3600)/60)}м`,
                maintenance: state.MAINTENANCE_MODE,
                settings: state.SETTINGS
            });
        } catch(e) { res.status(500).json({ err: "Ошибка статистики" }); }
    });
    return router;
};
