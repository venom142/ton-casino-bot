// ТОЛЬКО ЧТЕНИЕ. Ищет дубли, из-за которых нельзя безопасно сделать уникальные индексы.
// Запуск: MONGO_URI="..." node scripts/check-duplicates.js
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Promo = require('../models/Promo');
const Transaction = require('../models/Transaction');
(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const dup = async (Model, field, extra = {}) => Model.aggregate([
        { $match: { [field]: { $ne: null }, ...extra } },
        { $group: { _id: '$' + field, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $limit: 20 }
    ]);
    console.log('User.uid дубли:', JSON.stringify(await dup(User, 'uid')));
    console.log('Promo.code дубли:', JSON.stringify(await dup(Promo, 'code')));
    console.log('Transaction.tx_hash дубли (deposit):', JSON.stringify(await dup(Transaction, 'tx_hash', { type: 'deposit' })));
    console.log('Пустые списки значит дублей нет — тогда безопасно добавлять unique.');
    await mongoose.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
