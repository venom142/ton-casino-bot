const mongoose = require('mongoose');

const banSchema = new mongoose.Schema({
    uid: String,
    reason: String,
    banned_by: String,
    created_at: { type: Date, default: Date.now },
    expires_at: Date
});

module.exports = mongoose.model('Ban', banSchema);
