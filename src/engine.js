/**
 * 💎 VIP TON ХОТ ТАП — GAME ENGINE & MATHEMATICS
 */

const crypto = require('crypto');

class VIP_Engine {
    constructor() {
        this.symbols = [
            { id: 1, char: '💎', weight: 1, mult: 100 },
            { id: 2, char: '👑', weight: 3, mult: 50 },
            { id: 3, char: '💰', weight: 8, mult: 20 },
            { id: 4, char: '🔥', weight: 15, mult: 10 },
            { id: 5, char: '⚡', weight: 25, mult: 5 },
            { id: 6, char: '🍀', weight: 40, mult: 2 },
            { id: 7, char: '🍒', weight: 60, mult: 0.5 }
        ];
    }

    // Генерация результата на основе криптографии
    generateResult(serverSeed, clientSeed, nonce) {
        const hash = crypto.createHmac('sha256', serverSeed)
            .update(`${clientSeed}:${nonce}`)
            .digest('hex');
            
        let result = [];
        for (let i = 0; i < 3; i++) {
            const part = hash.substring(i * 8, (i + 1) * 8);
            const val = parseInt(part, 16) % 1000;
            result.push(this.getSymbolFromValue(val));
        }
        return result;
    }

    getSymbolFromValue(val) {
        // Логика распределения весов (шансов)
        if (val < 10) return this.symbols[0]; // 1% шанс на 💎
        if (val < 40) return this.symbols[1];
        if (val < 100) return this.symbols[2];
        if (val < 250) return this.symbols[3];
        if (val < 450) return this.symbols[4];
        if (val < 700) return this.symbols[5];
        return this.symbols[6];
    }

    checkWin(res) {
        if (res[0].id === res[1].id && res[1].id === res[2].id) {
            return { type: 'JACKPOT', mult: res[0].mult };
        }
        if (res[0].id === res[1].id || res[1].id === res[2].id || res[0].id === res[2].id) {
            return { type: 'PAIR', mult: 1.5 };
        }
        return { type: 'LOSS', mult: 0 };
    }
}

module.exports = new VIP_Engine();
