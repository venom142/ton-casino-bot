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
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Transaction', transactionSchema);
