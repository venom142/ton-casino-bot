const express = require('express');
const router = express.Router();
const Transaction = require('../../models/Transaction');
const User = require('../../models/User');
const { addHistory } = require('../../utils/helpers');

module.exports = (bot) => {
    // Все депозиты
    router.get('/admin/finance/deposits', async (req, res) => {
        try {
            const deposits = await Transaction.find({ type: 'deposit' }).sort({ created_at: -1 }).limit(100);
            res.json(deposits);
        } catch(e) { res.json([]); }
    });

    // Все выводы
    router.get('/admin/finance/withdraws', async (req, res) => {
        try {
            const withdraws = await Transaction.find({ type: 'withdraw' }).sort({ created_at: -1 }).limit(100);
            res.json(withdraws);
        } catch(e) { res.json([]); }
    });

    // Ожидающие выплаты
    router.get('/admin/finance/pending', async (req, res) => {
        try {
            const pending = await Transaction.find({ type: 'withdraw', status: 'pending' }).sort({ created_at: -1 });
            res.json(pending);
        } catch(e) { res.json([]); }
    });

    // Подтвердить вывод
    router.post('/admin/finance/approve', async (req, res) => {
        try {
            const { tx_id } = req.body;
            const tx = await Transaction.findByIdAndUpdate(tx_id, { status: 'completed' }, { new: true });
            if (!tx) return res.json({ err: "Транзакция не найдена" });

            const user = await User.findOne({ uid: tx.uid });
            if (user) {
                user.balance -= tx.amount;
                addHistory(user, `🏦 Вывод -${tx.amount} 💎`, -tx.amount);
                await user.save();
            }

            bot.sendMessage(tx.uid, `✅ Ваша заявка на вывод ${tx.amount} 💎 одобрена!`).catch(()=>{});
            res.json({ success: true });
        } catch(e) { res.json({ err: "Ошибка" }); }
    });

    // Отклонить вывод
    router.post('/admin/finance/reject', async (req, res) => {
        try {
            const { tx_id } = req.body;
            const tx = await Transaction.findByIdAndUpdate(tx_id, { status: 'rejected' }, { new: true });
            if (!tx) return res.json({ err: "Транзакция не найдена" });
            bot.sendMessage(tx.uid, `❌ Ваша заявка на вывод ${tx.amount} 💎 отклонена.`).catch(()=>{});
            res.json({ success: true });
        } catch(e) { res.json({ err: "Ошибка" }); }
    });

    // Финансовая статистика
    router.get('/admin/finance/stats', async (req, res) => {
        try {
            const dayAgo = new Date(Date.now() - 86400000);
            const weekAgo = new Date(Date.now() - 604800000);
            const monthAgo = new Date(Date.now() - 2592000000);

            const dayDep = await Transaction.aggregate([{ $match: { type: 'deposit', status: 'completed', created_at: { $gte: dayAgo } } }, { $group: { _id: null, sum: { $sum: "$ton_amount" } } }]);
            const weekDep = await Transaction.aggregate([{ $match: { type: 'deposit', status: 'completed', created_at: { $gte: weekAgo } } }, { $group: { _id: null, sum: { $sum: "$ton_amount" } } }]);
            const monthDep = await Transaction.aggregate([{ $match: { type: 'deposit', status: 'completed', created_at: { $gte: monthAgo } } }, { $group: { _id: null, sum: { $sum: "$ton_amount" } } }]);

            const dayWit = await Transaction.aggregate([{ $match: { type: 'withdraw', status: 'completed', created_at: { $gte: dayAgo } } }, { $group: { _id: null, sum: { $sum: "$amount" } } }]);
            const weekWit = await Transaction.aggregate([{ $match: { type: 'withdraw', status: 'completed', created_at: { $gte: weekAgo } } }, { $group: { _id: null, sum: { $sum: "$amount" } } }]);
            const monthWit = await Transaction.aggregate([{ $match: { type: 'withdraw', status: 'completed', created_at: { $gte: monthAgo } } }, { $group: { _id: null, sum: { $sum: "$amount" } } }]);

            res.json({
                deposits: { day: dayDep[0]?.sum || 0, week: weekDep[0]?.sum || 0, month: monthDep[0]?.sum || 0 },
                withdraws: { day: dayWit[0]?.sum || 0, week: weekWit[0]?.sum || 0, month: monthWit[0]?.sum || 0 }
            });
        } catch(e) { res.json({ err: "Ошибка" }); }
    });

    return router;
};
