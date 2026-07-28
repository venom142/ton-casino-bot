const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({ 
    uid: String, 
    username: String,
    first_name: String,
    balance: { type: Number, default: 100 },
    spins: { type: Number, default: 0 }, 
    wins: { type: Number, default: 0 },
    total_deposited: { type: Number, default: 0 },
    total_withdrawn: { type: Number, default: 0 },
    last_lt: { type: String, default: "0" },
    used_promos: [String],
    last_roulette_at: { type: Date, default: null },
    last_active: { type: Date, default: Date.now },
    notified_inactive: { type: Boolean, default: false },
    created_at: { type: Date, default: Date.now },
    is_vip: { type: Boolean, default: false },
    is_banned: { type: Boolean, default: false },
    ban_reason: String,
    country: String,
    ip: String,
    user_agent: String,
    tasks_completed: [String], // коды выполненных заданий
    tasks: {
        subscribed_channel: { type: Boolean, default: false }
    },
    history: [{
        text: String,
        amount: Number,
        createdAt: { type: Date, default: Date.now }
    }]
});

module.exports = mongoose.model('User', userSchema);
