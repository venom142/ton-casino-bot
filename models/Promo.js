const mongoose = require('mongoose');

const promoSchema = new mongoose.Schema({
    code: String, 
    value: Number, 
    limit: Number, 
    usedCount: { type: Number, default: 0 },
    expires_at: Date,
    vip_only: { type: Boolean, default: false },
    new_only: { type: Boolean, default: false },
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Promo', promoSchema);
