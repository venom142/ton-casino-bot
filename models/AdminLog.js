const mongoose = require('mongoose');

const adminLogSchema = new mongoose.Schema({
    action: String,
    target_uid: String,
    details: String,
    amount: Number,
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('AdminLog', adminLogSchema);
