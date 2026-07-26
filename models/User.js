const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({ 
    uid: String, 
    balance: { type: Number, default: 100 },
    spins: { type: Number, default: 0 }, 
    wins: { type: Number, default: 0 },
    last_lt: { type: String, default: "0" },
    used_promos: [String],
    last_roulette_at: { type: Date, default: null },
    last_active: { type: Date, default: Date.now },
    notified_inactive: { type: Boolean, default: false },
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
