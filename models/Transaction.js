const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    uid: String,
    type: { type: String, enum: ['deposit', 'withdraw', 'admin_add', 'admin_remove', 'promo', 'task'] },
    amount: Number,
    status: { type: String, enum: ['pending', 'completed', 'rejected', 'cancelled'], default: 'completed' },
    ton_amount: Number,
    wallet_address: String,
    tx_hash: String,
    description: String,
    reserved: { type: Boolean, default: false }, // сумма вывода заморожена при создании заявки
    created_at: { type: Date, default: Date.now }
});

transactionSchema.index({ tx_hash: 1 });
transactionSchema.index({ uid: 1, created_at: -1 });
transactionSchema.index({ type: 1, status: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
