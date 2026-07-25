const mongoose = require('mongoose');

const promoSchema = new mongoose.Schema({
    code: String, 
    value: Number, 
    limit: Number, 
    usedCount: { type: Number, default: 0 }
});

module.exports = mongoose.model('Promo', promoSchema);
