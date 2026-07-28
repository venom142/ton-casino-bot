const express = require('express');
const User = require('../models/User');
const { addHistory, safeUid } = require('../utils/helpers');
const state = require('../state');

const crashState = {
    roundId: 0,
    status: 'betting',
    crashPoint: 0,
    startTime: 0,
    bettingEndsAt: Date.now() + 10000,
    crashedMultiplier: 0,
    bets: {},
    suspicious: [],
    cashoutSpam: {},
    history: []
};

function markCrashSuspicious(uid, reason) {
    const sUid = (uid || 'unknown').toString();
    const item = `${sUid}: ${reason}`;
    if (!crashState.suspicious.includes(item)) crashState.suspicious.push(item);
}

module.exports = (bot, CONFIG) => {
    async function sendCrashRoundReport() {
        try {
            const entries = Object.entries(crashState.bets || {});
            const total = entries.length;
            if (total === 0) return;
            const cashed = entries.filter(([, b]) => b.cashedOut).length;
            const lost = total - cashed;
            for (const [uid, b] of entries) {
                const status = b.cashedOut ? 'CASHOUT' : 'LOST';
                console.log(`ROUND_ID=${crashState.roundId} UID=${uid} BET=${b.bet} CASHOUT=${b.cashoutMultiplier || 0} CRASH=${crashState.crashPoint} WIN=${b.winSum || 0} STATUS=${status}`);
            }
            const suspiciousText = crashState.suspicious.length ? crashState.suspicious.slice(0, 15).join('\n') : '✅ Нет';
            const report = `🚀 CRASH REPORT\nРаунд: #${crashState.roundId}\nВзорвалась на: ${Number(crashState.crashPoint).toFixed(2)}x\n\nИгроков: ${total}\nЗабрали: ${cashed}\nПроиграли: ${lost}\n\nПодозрительные:\n${suspiciousText}`;
            await bot.sendMessage(CONFIG.ADMIN_ID, report);
        } catch (e) { console.error('CRASH REPORT ERROR:', e.message); }
    }

    setInterval(() => {
        const now = Date.now();
        if (crashState.status === 'betting') {
            if (now >= crashState.bettingEndsAt) {
                crashState.roundId += 1;
                crashState.status = 'flying';
                crashState.startTime = now;
                crashState.crashPoint = 1.00;
                if (Math.random() > 0.05) crashState.crashPoint = parseFloat((1 / Math.random() * 0.95).toFixed(2));
                if (crashState.crashPoint < 1.01) crashState.crashPoint = 1.01;
                if (crashState.crashPoint > 30) crashState.crashPoint = 30;
            }
        } else if (crashState.status === 'flying') {
            const elapsed = now - crashState.startTime;
            const currentMult = elapsed < 0 ? 1.00 : Math.pow(1.05, elapsed / 500);
            if (currentMult >= crashState.crashPoint) {
                crashState.status = 'crashed';
                crashState.crashedMultiplier = crashState.crashPoint;
                const finishedCrashPoint = Number(crashState.crashPoint || crashState.crashedMultiplier || 1);
                if (!Number.isNaN(finishedCrashPoint) && finishedCrashPoint >= 1) {
                    crashState.history.unshift(Number(finishedCrashPoint.toFixed(2)));
                    crashState.history = [...new Set(crashState.history.map(x => Number(x)))].slice(0, 12);
                }
                sendCrashRoundReport();
                setTimeout(() => {
                    crashState.status = 'betting';
                    crashState.bettingEndsAt = Date.now() + 10000;
                    crashState.bets = {};
                    crashState.suspicious = [];
                    crashState.cashoutSpam = {};
                    crashState.crashedMultiplier = 0;
                }, 3000);
            }
        }
    }, 80);

    const router = express.Router();

    router.post('/crash/state', (req, res) => {
        try {
            const { uid } = req.body;
            const now = Date.now();
            let currentMult = 1.00, timeLeft = 0;
            if (crashState.status === 'betting') timeLeft = Math.max(0, Math.floor((crashState.bettingEndsAt - now) / 1000));
            else if (crashState.status === 'flying') {
                currentMult = Math.pow(1.05, (now - crashState.startTime) / 500);
                if (currentMult >= crashState.crashPoint) currentMult = crashState.crashPoint;
            } else if (crashState.status === 'crashed') currentMult = crashState.crashedMultiplier;
            const myBet = crashState.bets[uid] || null;
            res.json({ status: crashState.status, serverTime: now, startTime: crashState.startTime, bettingEndsAt: crashState.bettingEndsAt, currentMultiplier: currentMult.toFixed(2), timeLeft, crashedMultiplier: crashState.crashedMultiplier.toFixed(2), playersCount: Object.keys(crashState.bets || {}).length, history: Array.isArray(crashState.history) ? crashState.history : [], bet: myBet ? myBet.bet : 0, cashedOut: myBet ? myBet.cashedOut : false, winSum: myBet ? myBet.winSum : 0 });
        } catch(e) { res.json({ err: "State err" }); }
    });

    router.post('/crash/bet', async (req, res) => {
        try {
            const { uid, bet } = req.body;
            const uidStr = safeUid(uid);
            const safeBet = Math.floor(Number(bet));
            if (!uidStr || isNaN(safeBet) || safeBet < state.SETTINGS.minBet) return res.json({ err: "Ошибка ставки" });
            if (crashState.status !== 'betting') return res.json({ err: "Ставки уже закрыты!" });
            if (crashState.bets[uidStr]) { markCrashSuspicious(uidStr, 'повторная ставка'); return res.json({ err: "Вы уже сделали ставку!" }); }
            const user = await User.findOne({ uid: uidStr });
            if (!user || user.balance < safeBet) return res.json({ err: "Мало 💎 ХОТ ТАП!" });
            user.balance -= safeBet; user.spins++;
            addHistory(user, `🚀 Crash ставка -${safeBet} 💎`, -safeBet);
            await user.save();
            crashState.bets[uidStr] = { bet: safeBet, cashedOut: false, winSum: 0, cashoutMultiplier: 0, cashoutAt: 0 };
            res.json({ success: true, balance: Math.floor(user.balance) });
        } catch (e) { res.json({ err: "Ошибка ставки" }); }
    });

    router.post('/crash/cashout', async (req, res) => {
        try {
            const { uid } = req.body;
            const uidStr = safeUid(uid);
            if (!uidStr) return res.json({ err: "Ошибка профиля" });
            const nowSpam = Date.now();
            crashState.cashoutSpam[uidStr] = (crashState.cashoutSpam[uidStr] || []).filter(t => nowSpam - t < 2000);
            crashState.cashoutSpam[uidStr].push(nowSpam);
            if (crashState.cashoutSpam[uidStr].length >= 6) markCrashSuspicious(uidStr, 'слишком много cashout');
            if (crashState.status !== 'flying') return res.json({ err: "Раунд не в полёте!" });
            const myBet = crashState.bets[uidStr];
            if (!myBet) { markCrashSuspicious(uidStr, 'cashout без ставки'); return res.json({ err: "Вы не ставили в этом раунде!" }); }
            if (myBet.cashedOut) return res.json({ err: "Уже забрали куш!" });
            const now = Date.now();
            const currentMult = Math.pow(1.05, (now - crashState.startTime) / 500);
            if (currentMult >= crashState.crashPoint) return res.json({ err: "Ракета уже взорвалась!" });
            const winSum = Math.floor(myBet.bet * currentMult);
            myBet.cashedOut = true; myBet.winSum = winSum; myBet.cashoutMultiplier = parseFloat(currentMult.toFixed(2)); myBet.cashoutAt = now;
            if ((crashState.crashPoint - myBet.cashoutMultiplier) > 0 && (crashState.crashPoint - myBet.cashoutMultiplier) <= 0.05) markCrashSuspicious(uidStr, `идеальный cashout`);
            const user = await User.findOne({ uid: uidStr });
            if (user) { user.balance += winSum; user.wins++; addHistory(user, `🚀 Crash win +${winSum} 💎`, winSum); await user.save(); res.json({ success: true, winSum, multiplier: currentMult.toFixed(2), balance: Math.floor(user.balance) }); }
            else res.json({ err: "Ошибка профиля" });
        } catch (e) { res.json({ err: "Ошибка вывода краша" }); }
    });

    return router;
};
