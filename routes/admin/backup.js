const express = require('express');
const router = express.Router();
const User = require('../../models/User');
const Promo = require('../../models/Promo');
const Transaction = require('../../models/Transaction');

module.exports = () => {
    router.get('/admin/backup/export', async (req, res) => {
        try {
            const users = await User.find().lean();
            const promos = await Promo.find().lean();
            const transactions = await Transaction.find().lean();
            res.json({ users, promos, transactions, exported_at: new Date() });
        } catch(e) { res.json({ err: "Ошибка экспорта" }); }
    });

    return router;
};
