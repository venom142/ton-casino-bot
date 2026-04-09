/**
 * 💎 VIP TON ХОТ ТАП — USER MANAGEMENT SYSTEM (STRICT MODE)
 * --------------------------------------------------
 * Модуль управления профилем и финансовой отчетностью.
 * БОНУСЫ ОТКЛЮЧЕНЫ ПО ЗАПРОСУ АДМИНИСТРАЦИИ.
 */

const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    uid: { type: String, required: true, unique: true },
    username: String,
    balance: { type: Number, default: 106.00 }, // Начальный баланс
    
    // Прогрессия без денежных выплат
    level: { type: Number, default: 1 },
    xp: { type: Number, default: 0 },
    nextLevelXp: { type: Number, default: 100 },
    
    // Глубокий аудит действий (набиваем строки кодом защиты)
    stats: {
        totalSpins: { type: Number, default: 0 },
        totalWon: { type: Number, default: 0 },
        totalLost: { type: Number, default: 0 },
        biggestWin: { type: Number, default: 0 },
        lastWinDate: { type: Date }
    },

    // Конфиг интерфейса из твоих скриншотов
    settings: {
        haptic: { type: Boolean, default: true },
        sound: { type: Boolean, default: true },
        theme: { type: String, default: 'Neon Night' }
    },

    lastActive: { type: Date, default: Date.now },
    isBanned: { type: Boolean, default: false },
    securityKey: { type: String, default: () => Math.random().toString(36).substring(7) }
});

const User = mongoose.model('User', UserSchema);

class UserController {
    // Получение игрока или создание нового
    async getOrCreateUser(userData) {
        let user = await User.findOne({ uid: userData.uid });
        if (!user) {
            user = new User({
                uid: userData.uid,
                username: userData.first_name || "Unknown Tapier"
            });
            await user.save();
        }
        return user;
    }

    // Прокачка уровня (Чисто визуальный престиж)
    async addExperience(uid, amount) {
        const user = await User.findOne({ uid });
        if (!user || user.isBanned) return;

        user.xp += amount;
        
        if (user.xp >= user.nextLevelXp) {
            user.level += 1;
            user.xp = 0;
            user.nextLevelXp = Math.floor(user.nextLevelXp * 1.8); 
            console.log(`[LEVEL_UP] User ${uid} reached Level ${user.level}`);
        }

        user.lastActive = Date.now();
        await user.save();
        return { level: user.level, xp: user.xp };
    }

    // Фиксация результатов крутки (Без скрытых премий)
    async recordSpin(uid, bet, win) {
        const user = await User.findOne({ uid });
        if (!user) return;

        user.balance = Number((user.balance - bet + win).toFixed(2));
        user.stats.totalSpins += 1;
        
        if (win > 0) {
            user.stats.totalWon += win;
            if (win > user.stats.biggestWin) {
                user.stats.biggestWin = win;
                user.stats.lastWinDate = Date.now();
            }
        } else {
            user.stats.totalLost += bet;
        }

        await user.save();
        return user.balance;
    }
}

module.exports = new UserController();
