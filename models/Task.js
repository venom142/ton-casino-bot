const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
    code: { type: String, unique: true }, // уникальный код задания
    title: String, // название
    description: String, // описание
    reward: { type: Number, default: 50 }, // награда в 💎
    type: { type: String, enum: ['channel_sub', 'referral', 'play_games', 'custom'], default: 'custom' },
    target_value: String, // для channel_sub — @канал, для play_games — количество
    is_active: { type: Boolean, default: true },
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Task', taskSchema);
