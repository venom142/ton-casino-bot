require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const axios = require('axios');

// ==========================================
// 🛡 АНТИ-КРАШ СИСТЕМА
// ==========================================
process.on('uncaughtException', (err) => {
    console.error('💥 КРИТИЧЕСКАЯ ОШИБКА:', err.message);
});
process.on('unhandledRejection', (reason) => {
    console.error('💥 СКРЫТАЯ ОШИБКА:', reason);
});

console.log("🛠 Запуск сервера VIP ХОТ ТАП...");

if (!process.env.BOT_TOKEN || !process.env.MONGO_URI) {
    console.error("❌ ОШИБКА: Заполни BOT_TOKEN и MONGO_URI!");
    process.exit(1);
}

const app = express();
app.use(express.json());

// ==========================================
// ⚙️ НАСТРОЙКИ КАЗИНО
// ==========================================
const CONFIG = {
    ADMIN_ID: 8475323865, 
    WALLET: "UQDoTj0hCwJbI-9fziRCyUZzO2XHmtcDzuiAiGjxG21G3dIX", 
    TON_KEY: process.env.TON_KEY, 
    START_BALANCE: 100, 
    HOTTAP_RATE: 10000,
    BG_VIDEO: "https://raw.githubusercontent.com/venom142/ton-casino-bot/main/gemini_generated_video_9fc75b5d.mp4", 
    BGM_URL: "https://files.catbox.moe/ef3c37.mp3"
};

let SETTINGS = { winChance: 0.15, multiplier: 10, minBet: 10 };
let MAINTENANCE_MODE = false;

// ==========================================
// 🗄 БАЗА ДАННЫХ
// ==========================================
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("💎 MongoDB подключена!"))
    .catch(err => console.error("❌ Ошибка БД:", err.message));

const User = mongoose.model('User', { 
    uid: String, 
    balance: { type: Number, default: CONFIG.START_BALANCE },
    spins: { type: Number, default: 0 }, 
    wins: { type: Number, default: 0 },
    last_lt: { type: String, default: "0" },
    used_promos: [String],
    last_active: { type: Date, default: Date.now },
    notified_inactive: { type: Boolean, default: false },
    history: [{
        text: String,
        amount: Number,
        createdAt: { type: Date, default: Date.now }
    }]
});

const Promo = mongoose.model('Promo', {
    code: String, value: Number, limit: Number, usedCount: { type: Number, default: 0 }
});

function addHistory(user, text, amount = 0) {
    if (!user) return;
    if (!Array.isArray(user.history)) user.history = [];
    user.history.unshift({
        text: text,
        amount: Math.floor(Number(amount) || 0),
        createdAt: new Date()
    });
    user.history = user.history.slice(0, 20);
}

// ==========================================
// 🤖 ТЕЛЕГРАМ БОТ (АДМИНКА)
// ==========================================
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const adminState = {};

bot.onText(/\/start/, async (msg) => {
    const uid = msg.from.id.toString();
    await User.findOneAndUpdate({ uid }, { uid }, { upsert: true, setDefaultsOnInsert: true });
    
    let kb = [[{ text: "🎰 ВОЙТИ В VIP ЗАЛ", web_app: { url: process.env.APP_URL || "https://google.com" } }]];
    if (msg.from.id === CONFIG.ADMIN_ID) kb.push([{ text: "👑 ПАНЕЛЬ ВЛАДЕЛЬЦА", callback_data: "admin_menu" }]);
    
    bot.sendMessage(msg.chat.id, `💎 **VIP ХОТ ТАП**\nБонус за старт: **${CONFIG.START_BALANCE} 💎**\nТвой ID: \`${uid}\``, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
});

bot.on('callback_query', async (q) => {
    if (q.from.id !== CONFIG.ADMIN_ID) return;
    
    if (q.data.startsWith('withdraw_ok_')) {
        const [, , uid, amountStr] = q.data.split('_');
        const amount = parseInt(amountStr);
        
        bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: q.message.chat.id, message_id: q.message.message_id });

        const user = await User.findOne({ uid });
        if (!user) {
            return bot.sendMessage(q.message.chat.id, "❌ Ошибка профиля. Игрок не найден.");
        }

        if (user.balance >= amount) {
            user.balance -= amount;
            addHistory(user, `🏦 Вывод -${amount} 💎`, -amount);
            await user.save();
            bot.sendMessage(uid, `✅ Заявка на вывод подтверждена. Списано ${amount} 💎`).catch(()=>{});
            bot.sendMessage(q.message.chat.id, "✅ Вывод подтверждён. Баланс игрока обновлён.");
        } else {
            bot.sendMessage(q.message.chat.id, "❌ Ошибка! На момент подтверждения у игрока уже недостаточно средств на балансе.");
        }
        return;
    }

    if (q.data.startsWith('withdraw_no_')) {
        const [, , uid] = q.data.split('_');
        
        bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: q.message.chat.id, message_id: q.message.message_id });

        bot.sendMessage(uid, "❌ Заявка на вывод отклонена.").catch(()=>{});
        bot.sendMessage(q.message.chat.id, "❌ Заявка отклонена. Баланс не изменён.");
        return;
    }

    if (q.data === "admin_menu") {
        bot.sendMessage(q.message.chat.id, `👑 **Админка**\n\n⚙️ Шанс: **${Math.round(SETTINGS.winChance * 100)}%**\n✖️ Икс: **x${SETTINGS.multiplier}**`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: "📢 Рассылка", callback_data: "adm_msg" }, { text: "💰 Баланс", callback_data: "adm_bal" }],
                [{ text: "🎁 Создать ПРОМО", callback_data: "adm_promo_add" }, { text: "🗑 Удал. ПРОМО", callback_data: "adm_promo_del" }],
                [{ text: "⚙️ Изменить ШАНС", callback_data: "adm_set_chance" }, { text: "✖️ Изменить ИКС", callback_data: "adm_set_mult" }],
                [{ text: "🛠 Техперерыв", callback_data: "adm_maintenance" }],
                [{ text: "📊 Статистика", callback_data: "adm_stat" }, { text: "💀 ОБНУЛИТЬ ВСЕХ", callback_data: "adm_wipe_all" }]
            ]}
        });
    }
    if (q.data === "adm_stat") {
        const users = await User.countDocuments(); const promos = await Promo.countDocuments();
        bot.sendMessage(q.message.chat.id, `📊 Игроков: **${users}**\n🎁 Активных промо: **${promos}**`, { parse_mode: 'Markdown' });
    }
    if (q.data === "adm_maintenance") {
        MAINTENANCE_MODE = !MAINTENANCE_MODE;
        bot.sendMessage(
            q.message.chat.id,
            MAINTENANCE_MODE ? "🛠 Техперерыв включён. WebApp закрыт экраном техработ." : "✅ Техперерыв выключен. WebApp снова доступен."
        );
    }
    if (q.data === "adm_set_chance") { adminState[q.from.id] = 'set_chance'; bot.sendMessage(q.message.chat.id, "Введите шанс (0.01 - 1.00):"); }
    if (q.data === "adm_set_mult") { adminState[q.from.id] = 'set_mult'; bot.sendMessage(q.message.chat.id, "Введите множитель (от 1):"); }
    if (q.data === "adm_wipe_all") {
        bot.sendMessage(q.message.chat.id, "⚠️ СБРОСИТЬ ВСЕХ?", { reply_markup: { inline_keyboard: [[{text: "✅ ДА", callback_data: "adm_wipe_confirm"}, {text: "❌ ОТМЕНА", callback_data: "admin_menu"}]] } });
    }
    if (q.data === "adm_wipe_confirm") {
        await User.updateMany({}, { balance: CONFIG.START_BALANCE, spins: 0, wins: 0, used_promos: [] });
        bot.sendMessage(q.message.chat.id, "✅ БАЗА ОБНУЛЕНА!");
    }
    if (q.data === "adm_msg") { adminState[q.from.id] = 'msg'; bot.sendMessage(q.message.chat.id, "Текст рассылки:"); }
    if (q.data === "adm_bal") { adminState[q.from.id] = 'bal_id'; bot.sendMessage(q.message.chat.id, "ID игрока:"); }
    if (q.data === "adm_promo_add") { adminState[q.from.id] = 'p_code'; bot.sendMessage(q.message.chat.id, "Название промокода:"); }
    if (q.data === "adm_promo_del") { adminState[q.from.id] = 'p_del'; bot.sendMessage(q.message.chat.id, "Название для удаления:"); }
});

bot.on('message', async (msg) => {
    const s = adminState[msg.from.id]; if (!s || msg.text?.startsWith('/')) return;
    try {
        if (s === 'set_chance') { SETTINGS.winChance = parseFloat(msg.text); bot.sendMessage(msg.chat.id, `✅ Готово!`); delete adminState[msg.from.id]; }
        else if (s === 'set_mult') { SETTINGS.multiplier = parseFloat(msg.text); bot.sendMessage(msg.chat.id, `✅ Готово!`); delete adminState[msg.from.id]; }
        else if (s === 'msg') { const users = await User.find(); for (let u of users) { try { await bot.sendMessage(u.uid, msg.text); } catch(e) {} } bot.sendMessage(msg.chat.id, "✅ Разослано!"); delete adminState[msg.from.id]; } 
        else if (s === 'bal_id') { adminState[msg.from.id] = `bal_v_${msg.text}`; bot.sendMessage(msg.chat.id, "Сумма (в 💎):"); }
        else if (s.startsWith('bal_v_')) {
            const uid = s.split('_')[2]; const user = await User.findOne({ uid });
            if (user) { const bonus = Math.floor(parseFloat(msg.text)); user.balance += bonus; addHistory(user, `👑 Админ бонус +${bonus} 💎`, bonus); await user.save(); bot.sendMessage(msg.chat.id, `✅ Выдано!`); bot.sendMessage(uid, `🎁 Начислен бонус: +${bonus} 💎`).catch(()=>{}); }
            delete adminState[msg.from.id];
        }
        else if (s === 'p_code') { adminState[msg.from.id] = `p_val_${msg.text.trim().toUpperCase()}`; bot.sendMessage(msg.chat.id, `Сумма (в 💎):`); }
        else if (s.startsWith('p_val_')) { adminState[msg.from.id] = `p_lim_${s.split('_')[2]}_${Math.floor(parseFloat(msg.text))}`; bot.sendMessage(msg.chat.id, `Лимит активаций:`); }
        else if (s.startsWith('p_lim_')) {
            const [, , code, valStr] = s.split('_');
            await Promo.findOneAndUpdate({ code }, { code, value: Math.floor(parseFloat(valStr)), limit: parseInt(msg.text), usedCount: 0 }, { upsert: true });
            await User.updateMany({}, { $pull: { used_promos: code } });
            bot.sendMessage(msg.chat.id, `✅ Промокод создан!\nКод: \`${code}\` | Сумма: ${Math.floor(parseFloat(valStr))} 💎 | Лимит: ${parseInt(msg.text)}`, {parse_mode:'Markdown'}); delete adminState[msg.from.id];
        }
        else if (s === 'p_del') {
            const delCode = msg.text.trim().toUpperCase();
            await Promo.deleteOne({ code: delCode });
            await User.updateMany({}, { $pull: { used_promos: delCode } });
            bot.sendMessage(msg.chat.id, "🗑 Удалено. Если создать этот код заново — игроки смогут использовать его снова.");
            delete adminState[msg.from.id];
        }
    } catch (e) {}
});

// ==========================================
// 💸 СКАНЕР ДОНАТОВ
// ==========================================
setInterval(async () => {
    try {
        const res = await axios.get(`https://toncenter.com/api/v2/getTransactions?address=${CONFIG.WALLET}&limit=10&api_key=${CONFIG.TON_KEY}`);
        if (!res.data?.ok) return;
        for (let tx of res.data.result) {
            const comment = tx.in_msg?.message?.trim(), lt = tx.transaction_id.lt, val = parseFloat(tx.in_msg?.value || 0) / 1e9;
            if (!comment || isNaN(comment) || val <= 0) continue;
            const user = await User.findOne({ uid: comment });
            if (user && BigInt(lt) > BigInt(user.last_lt || "0")) { 
                const addedHottap = Math.floor(val * CONFIG.HOTTAP_RATE);
                user.balance = Math.floor(user.balance + addedHottap); 
                user.last_lt = lt.toString();
                addHistory(user, `💰 Донат +${addedHottap} 💎`, addedHottap);
                await user.save();
                bot.sendMessage(user.uid, `💎 **ДОНАТ ХОТ ТАП!**\n+${addedHottap} 💎`).catch(()=>{});
            }
        }
    } catch (err) {}
}, 15000);

// ==========================================
// 🌐 API ИГРЫ
// ==========================================
app.use('/api', async (req, res, next) => {
    if (req.body && req.body.uid) await User.updateOne({uid: req.body.uid.toString()}, {last_active: Date.now(), notified_inactive: false}, {strict: false});
    next();
});

app.get('/api/maintenance', (req, res) => {
    res.json({ maintenance: MAINTENANCE_MODE });
});

app.post('/api/sync', async (req, res) => {
    try {
        const user = await User.findOne({ uid: req.body.uid?.toString() });
        res.json(user || { balance: 0 });
    } catch (e) { res.json({ balance: 0 }); }
});

app.post('/api/profile', async (req, res) => {
    try {
        const uid = req.body.uid?.toString();
        const user = await User.findOne({ uid });
        if (!user) return res.json({ err: "Ошибка профиля" });

        res.json({
            uid: user.uid,
            balance: Math.floor(user.balance || 0),
            spins: user.spins || 0,
            wins: user.wins || 0,
            promos: user.used_promos ? user.used_promos.length : 0,
            lastActive: user.last_active || null,
            version: "VIP ХОТ ТАП Alpha 1.0",
            history: (user.history || []).slice(0, 10).map(h => ({
                text: h.text,
                amount: h.amount || 0,
                createdAt: h.createdAt
            }))
        });
    } catch (e) {
        res.json({ err: "Ошибка профиля" });
    }
});

app.post('/api/leaderboard', async (req, res) => {
    try {
        const tops = await User.find().sort({ balance: -1 }).limit(10);
        res.json(tops.map(u => ({ uid: u.uid.substring(0, 3) + "***" + u.uid.substring(u.uid.length - 2), balance: Math.floor(u.balance) })));
    } catch (e) { res.json([]); }
});

app.post('/api/promo', async (req, res) => {
    try {
        const { uid, promo } = req.body; const p = promo?.toUpperCase();
        const user = await User.findOne({ uid: uid.toString() });
        if (!user) return res.json({ err: "Ошибка профиля" });
        const pr = await Promo.findOne({ code: p });
        if (!pr) return res.json({ err: "❌ Неверный промокод!" });
        if (user.used_promos.includes(p)) return res.json({ err: "⚠️ Вы уже использовали этот код!" });
        if (pr.usedCount >= pr.limit) return res.json({ err: "🚫 Лимит исчерпан!" });
        user.balance += pr.value;
        user.used_promos.push(p);
        addHistory(user, `🎁 Промо +${pr.value} 💎`, pr.value);
        await user.save();
        pr.usedCount += 1; await pr.save(); 
        res.json({ msg: `🎁 Начислено +${pr.value} 💎.` });
    } catch (e) { res.json({ err: "Ошибка сервера" }); }
});

app.post('/api/spin', async (req, res) => {
    try {
        const { uid, bet } = req.body; const user = await User.findOne({ uid: uid.toString() });
        if (!user || user.balance < bet || bet < SETTINGS.minBet) return res.json({ err: "Мало 💎 ХОТ ТАП!" });
        user.balance -= bet;
        const items = ['🍒','🔔','💎','7️⃣','🍋'];
        let result = [items[Math.floor(Math.random()*5)], items[Math.floor(Math.random()*5)], items[Math.floor(Math.random()*5)]];
        if (Math.random() < SETTINGS.winChance) result = ['7️⃣','7️⃣','7️⃣'];
        const isWin = result[0] === result[1] && result[1] === result[2];
        const winSum = isWin ? Math.floor(bet * SETTINGS.multiplier) : 0;
        user.balance += winSum;
        user.spins++;
        addHistory(user, `🎰 Слот -${Math.floor(bet)} 💎`, -Math.floor(bet));
        if(isWin) {
            user.wins++;
            addHistory(user, `🎰 Слот win +${winSum} 💎`, winSum);
        }
        await user.save();
        res.json({ result, winSum, balance: Math.floor(user.balance) });
    } catch (e) { res.json({ err: "Ошибка спина" }); }
});

// ==========================================
// 🚀 ЛОГИКА ИГРЫ КРАШ (ГЛОБАЛЬНАЯ)
// ==========================================
const crashState = {
    roundId: 0,
    status: 'betting', // 'betting', 'flying', 'crashed'
    crashPoint: 0,
    startTime: 0,
    bettingEndsAt: Date.now() + 10000,
    crashedMultiplier: 0,
    bets: {}, // uid -> { bet, cashedOut, winSum, cashoutMultiplier, cashoutAt }
    suspicious: [],
    cashoutSpam: {},
    history: []
};

function markCrashSuspicious(uid, reason) {
    const safeUid = (uid || 'unknown').toString();
    const item = `${safeUid}: ${reason}`;
    if (!crashState.suspicious.includes(item)) crashState.suspicious.push(item);
}

async function sendCrashRoundReport() {
    try {
        const entries = Object.entries(crashState.bets || {});
        const total = entries.length;
        if (total === 0) return;

        const cashed = entries.filter(([, b]) => b.cashedOut).length;
        const lost = total - cashed;

        for (const [uid, b] of entries) {
            const status = b.cashedOut ? 'CASHOUT' : 'LOST';
            console.log(
                `ROUND_ID=${crashState.roundId} UID=${uid} BET=${b.bet} CASHOUT_MULTIPLIER=${b.cashoutMultiplier || 0} CRASH_POINT=${crashState.crashPoint} WIN_SUM=${b.winSum || 0} STATUS=${status}`
            );
        }

        const suspiciousText = crashState.suspicious.length
            ? crashState.suspicious.slice(0, 15).join('\n')
            : '✅ Нет';

        const report =
`🚀 CRASH REPORT
Раунд: #${crashState.roundId}
Взорвалась на: ${Number(crashState.crashPoint).toFixed(2)}x

Игроков поставило: ${total}
Забрали куш: ${cashed}
Проиграли: ${lost}

Подозрительные:
${suspiciousText}`;

        await bot.sendMessage(CONFIG.ADMIN_ID, report);
    } catch (e) {
        console.error('CRASH REPORT ERROR:', e.message);
    }
}

// Серверный цикл игры Краш
setInterval(() => {
    const now = Date.now();
    
    if (crashState.status === 'betting') {
        if (now >= crashState.bettingEndsAt) {
            // Переход к полёту
            crashState.roundId += 1;
            crashState.status = 'flying';
            crashState.startTime = now;
            
            // Генерация точки взрыва
            crashState.crashPoint = 1.00;
            if (Math.random() > 0.05) {
                crashState.crashPoint = parseFloat((1 / Math.random() * 0.95).toFixed(2));
            }
            if (crashState.crashPoint < 1.01) crashState.crashPoint = 1.01;
            if (crashState.crashPoint > 30) crashState.crashPoint = 30;
        }
    } else if (crashState.status === 'flying') {
        const elapsed = now - crashState.startTime;
        const currentMult = elapsed < 0 ? 1.00 : Math.pow(1.05, elapsed / 500);
        
        if (currentMult >= crashState.crashPoint) {
            // Взрыв!
            crashState.status = 'crashed';
            crashState.crashedMultiplier = crashState.crashPoint;
            const finishedCrashPoint = Number(crashState.crashPoint || crashState.crashedMultiplier || 1);
            if (!Number.isNaN(finishedCrashPoint) && finishedCrashPoint >= 1) {
                crashState.history.unshift(Number(finishedCrashPoint.toFixed(2)));
                crashState.history = [...new Set(crashState.history.map(x => Number(x)))].slice(0, 12);
            }
            
            sendCrashRoundReport();
            // Ожидаем 3 секунды и начинаем новый раунд
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

app.post('/api/crash/state', (req, res) => {
    try {
        const { uid } = req.body;
        const now = Date.now();
        let currentMult = 1.00;
        let timeLeft = 0;
        
        if (crashState.status === 'betting') {
            timeLeft = Math.max(0, Math.floor((crashState.bettingEndsAt - now) / 1000));
        } else if (crashState.status === 'flying') {
            currentMult = Math.pow(1.05, (now - crashState.startTime) / 500);
            if (currentMult >= crashState.crashPoint) {
                currentMult = crashState.crashPoint;
            }
        } else if (crashState.status === 'crashed') {
            currentMult = crashState.crashedMultiplier;
        }
        
        const myBet = crashState.bets[uid] || null;
        
        res.json({
            status: crashState.status,
            serverTime: now,
            startTime: crashState.startTime,
            bettingEndsAt: crashState.bettingEndsAt,
            currentMultiplier: currentMult.toFixed(2),
            timeLeft: timeLeft,
            crashedMultiplier: crashState.crashedMultiplier.toFixed(2),
            playersCount: Object.keys(crashState.bets || {}).length,
            history: Array.isArray(crashState.history) ? crashState.history : [],
            bet: myBet ? myBet.bet : 0,
            cashedOut: myBet ? myBet.cashedOut : false,
            winSum: myBet ? myBet.winSum : 0
        });
    } catch(e) { res.json({ err: "State err" }); }
});

app.post('/api/crash/bet', async (req, res) => {
    try {
        const { uid, bet } = req.body;
        const uidStr = uid.toString();
        const safeBet = Math.floor(Number(bet));

        if (!uidStr || isNaN(safeBet) || safeBet < SETTINGS.minBet) return res.json({ err: "Ошибка ставки" });
        if (crashState.status !== 'betting') return res.json({ err: "Ставки уже закрыты!" });
        if (crashState.bets[uidStr]) {
            markCrashSuspicious(uidStr, 'повторная ставка в одном раунде');
            return res.json({ err: "Вы уже сделали ставку!" });
        }

        const user = await User.findOne({ uid: uidStr });
        if (!user || user.balance < safeBet) return res.json({ err: "Мало 💎 ХОТ ТАП!" });

        user.balance -= safeBet;
        user.spins++;
        addHistory(user, `🚀 Crash ставка -${safeBet} 💎`, -safeBet);
        await user.save();

        crashState.bets[uidStr] = { bet: safeBet, cashedOut: false, winSum: 0, cashoutMultiplier: 0, cashoutAt: 0 };
        res.json({ success: true, balance: Math.floor(user.balance) });
    } catch (e) {
        console.log("Crash bet error:", e.message);
        res.json({ err: "Ошибка ставки" });
    }
});

app.post('/api/crash/cashout', async (req, res) => {
    try {
        const { uid } = req.body;
        const uidStr = uid.toString();

        const nowSpam = Date.now();
        crashState.cashoutSpam[uidStr] = (crashState.cashoutSpam[uidStr] || []).filter(t => nowSpam - t < 2000);
        crashState.cashoutSpam[uidStr].push(nowSpam);
        if (crashState.cashoutSpam[uidStr].length >= 6) {
            markCrashSuspicious(uidStr, 'слишком много cashout-запросов за короткое время');
        }

        if (crashState.status !== 'flying') return res.json({ err: "Раунд не в полёте!" });

        const myBet = crashState.bets[uidStr];
        if (!myBet) {
            markCrashSuspicious(uidStr, 'cashout без активной ставки');
            return res.json({ err: "Вы не ставили в этом раунде!" });
        }
        if (myBet.cashedOut) return res.json({ err: "Уже забрали куш!" });

        const now = Date.now();
        const currentMult = Math.pow(1.05, (now - crashState.startTime) / 500);

        if (currentMult >= crashState.crashPoint) {
            return res.json({ err: "Ракета уже взорвалась!" });
        }

        const winSum = Math.floor(myBet.bet * currentMult);
        myBet.cashedOut = true;
        myBet.winSum = winSum;
        myBet.cashoutMultiplier = parseFloat(currentMult.toFixed(2));
        myBet.cashoutAt = now;

        if ((crashState.crashPoint - myBet.cashoutMultiplier) > 0 && (crashState.crashPoint - myBet.cashoutMultiplier) <= 0.05) {
            markCrashSuspicious(uidStr, `идеальный cashout перед взрывом (${myBet.cashoutMultiplier}x / ${crashState.crashPoint}x)`);
        }

        const user = await User.findOne({ uid: uidStr });
        if (user) {
            user.balance += winSum;
            user.wins++;
            addHistory(user, `🚀 Crash win +${winSum} 💎`, winSum);
            await user.save();
            res.json({ success: true, winSum, multiplier: currentMult.toFixed(2), balance: Math.floor(user.balance) });
        } else {
            res.json({ err: "Ошибка профиля" });
        }
    } catch (e) { res.json({ err: "Ошибка вывода краша" }); }
});

// ==========================================
// 💸 ВЫВОД 
// ==========================================
app.post('/api/withdraw', async (req, res) => {
    try {
        const { uid, amount, address } = req.body; 
        const user = await User.findOne({ uid: uid.toString() });
        if (!user) return res.json({ err: "Ошибка профиля" });
        const safeAmount = Math.floor(Number(amount));
        if (isNaN(safeAmount) || safeAmount < 10) return res.json({ err: "Мин. вывод 10 💎" });
        if (!address || address.length < 20) return res.json({ err: "Укажи нормальный кошелёк" });
        if (user.balance < safeAmount) return res.json({ err: "Мало 💎 ХОТ ТАП!" });
        const adminText = `🚨 **НОВАЯ ЗАЯВКА НА ВЫВОД**\nЮзер ID: \`${uid}\`\nСумма вывода: **${safeAmount} 💎**\nКошелёк: \`${address}\`\nТекущий баланс игрока: **${user.balance} 💎**`;
        bot.sendMessage(CONFIG.ADMIN_ID, adminText, { 
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "✅ Подтвердить вывод", callback_data: `withdraw_ok_${uid}_${safeAmount}` }],
                    [{ text: "❌ Отклонить вывод", callback_data: `withdraw_no_${uid}_${safeAmount}` }]
                ]
            }
        });
        res.json({ msg: "Заявка отправлена на подтверждение админу!" });
    } catch (e) { res.json({ err: "Ошибка при создании заявки" }); }
});

// ==========================================
// 🎨 ФРОНТЕНД
// ==========================================
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
    <html lang="ru">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
        <script src="https://telegram.org/js/telegram-web-app.js"></script>
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@700;900&display=swap" rel="stylesheet">
        <style>
            :root { --neon-cyan: #00f0ff; --neon-magenta: #ff00ff; --gold: #FFD700; --dark: #0a0a0c; }
            body { margin: 0; font-family: 'Montserrat', sans-serif; text-align: center; color: #fff; background-color: var(--dark); overflow: hidden; }
            .back-video { position: fixed; top: 50%; left: 50%; min-width: 100%; min-height: 100%; z-index: -2; transform: translate(-50%, -50%); object-fit: cover; opacity: 0.8; }
            body::before { content: ""; position: fixed; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.8) 100%); z-index: -1; }
            
            .nav {
                display: flex;
                gap: 4px;
                overflow-x: auto;
                overflow-y: hidden;
                white-space: nowrap;
                background: rgba(10,10,12,0.95);
                border-bottom: 2px solid var(--neon-magenta);
                box-shadow: 0 0 15px rgba(255,0,255,0.3);
                -webkit-overflow-scrolling: touch;
                scrollbar-width: none;
            }
            .nav::-webkit-scrollbar { display: none; }
            .tab {
                flex: 0 0 auto;
                min-width: 84px;
                padding: 13px 8px;
                font-size: 10px;
                font-weight: 900;
                color: #777;
                cursor: pointer;
                transition: 0.3s;
                text-transform: uppercase;
            }
            .tab.active { color: #fff; text-shadow: 0 0 10px var(--neon-cyan); border-bottom: 3px solid var(--neon-cyan); }
            
            .page { display: none; padding: 20px; height: 85vh; overflow-y: auto; box-sizing: border-box; animation: fadeIn 0.4s ease-out; }
            .page.active { display: block; }
            @keyframes fadeIn { from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: scale(1); } }
            
            /* VIP НЕОНОВЫЙ БАЛАНС */
            .vip-balance-card {
                background: linear-gradient(135deg, rgba(20,20,25,0.9), rgba(10,10,15,0.95));
                border: 2px solid var(--neon-cyan);
                border-radius: 16px;
                padding: 15px 20px;
                margin-bottom: 20px;
                box-shadow: 0 0 20px rgba(0,240,255,0.3), inset 0 0 15px rgba(255,0,255,0.1);
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                position: relative;
                overflow: hidden;
            }
            .vip-balance-card::before {
                content: ''; position: absolute; top: 0; left: -100%; width: 50%; height: 100%;
                background: linear-gradient(90deg, transparent, rgba(255,0,255,0.2), transparent);
                animation: shine 3s infinite;
            }
            @keyframes shine { 100% { left: 200%; } }
            .vip-balance-title { font-size: 12px; color: #aaa; text-transform: uppercase; letter-spacing: 2px; font-weight: 800; margin-bottom: 5px; }
            .vip-balance-value { display: flex; align-items: center; justify-content: center; gap: 10px; }
            .vip-balance-number { font-size: 38px; color: #fff; font-weight: 900; text-shadow: 0 0 15px var(--neon-cyan), 0 0 5px var(--neon-magenta); }
            .vip-balance-gem { font-size: 32px; filter: drop-shadow(0 0 10px var(--neon-cyan)); }

            .card { background: rgba(20,20,25,0.85); border: 1px solid rgba(0,240,255,0.3); padding: 20px; margin-bottom: 20px; border-radius: 16px; box-shadow: inset 0 0 20px rgba(0,240,255,0.1), 0 5px 15px rgba(0,0,0,0.6); backdrop-filter: blur(5px); }
            
            .reel-cont { display: flex; justify-content: center; gap: 15px; margin: 30px 0; }
            .reel { width: 90px; height: 120px; background: #000; border: 2px solid var(--neon-cyan); border-radius: 16px; overflow: hidden; position: relative; box-shadow: 0 0 20px rgba(0,240,255,0.3); }
            .strip { width: 100%; position: absolute; top: 0; left: 0; will-change: transform; }
            .sym { height: 120px; display: flex; align-items: center; justify-content: center; font-size: 60px; filter: drop-shadow(0 0 10px rgba(255,255,255,0.2)); }
            
            .crash-monitor { width: 100%; height: 160px; background: #000; border: 2px solid var(--neon-magenta); border-radius: 16px; display: flex; flex-direction: column; justify-content: center; align-items: center; box-shadow: inset 0 0 30px rgba(255,0,255,0.2), 0 0 20px rgba(255,0,255,0.3); margin-bottom: 20px; }
            .crash-x {
                font-size: 38px;
                font-weight: 900;
                color: #fff;
                text-shadow: 0 0 18px rgba(255,255,255,0.65);
                font-variant-numeric: tabular-nums;
                font-feature-settings: "tnum";
                min-width: 180px;
                text-align: center;
                display: inline-block;
                letter-spacing: 1px;
                will-change: contents;
                transition: color 0.18s ease, text-shadow 0.18s ease;
            }
            .crash-status { font-size: 14px; color: #aaa; margin-top: 5px; text-transform: uppercase; letter-spacing: 2px; }

            .crash-mini-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px 0 14px; }
            .crash-mini-card { background: rgba(0,0,0,0.42); border: 1px solid rgba(0,240,255,0.22); border-radius: 14px; padding: 10px 8px; box-shadow: inset 0 0 12px rgba(0,240,255,0.06); }
            .crash-mini-label { color: #888; font-size: 10px; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; }
            .crash-mini-value { color: #fff; font-size: 15px; font-weight: 900; margin-top: 4px; text-shadow: 0 0 10px rgba(0,240,255,0.35); }
            .crash-history { display: flex; gap: 7px; overflow-x: auto; white-space: nowrap; margin: 0 0 14px; padding: 2px 1px 8px; scrollbar-width: none; }
            .crash-history::-webkit-scrollbar { display: none; }
            .crash-chip { flex: 0 0 auto; min-width: 54px; padding: 8px 9px; border-radius: 999px; background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.12); font-size: 12px; font-weight: 900; }
            .crash-chip.low { color: #ff4a4a; border-color: rgba(255,74,74,0.45); box-shadow: 0 0 12px rgba(255,74,74,0.12); }
            .crash-chip.mid { color: #ffd700; border-color: rgba(255,215,0,0.45); box-shadow: 0 0 12px rgba(255,215,0,0.12); }
            .crash-chip.high { color: #00f0ff; border-color: rgba(0,240,255,0.55); box-shadow: 0 0 12px rgba(0,240,255,0.16); }
            .crash-chip.max { color: #fff; border-color: rgba(255,215,0,0.9); background: linear-gradient(90deg, rgba(255,215,0,0.18), rgba(255,0,255,0.12)); box-shadow: 0 0 18px rgba(255,215,0,0.28); }


            .crash-monitor {
                position: relative;
                overflow: hidden;
            }
            .rocket-visual {
                position: absolute;
                left: 50%;
                top: 50%;
                transform: translate(-50%, -50%) scale(0.8) rotate(-12deg);
                font-size: 34px;
                opacity: 0;
                z-index: 2;
                pointer-events: none;
                will-change: transform, opacity;
                filter: drop-shadow(0 0 16px rgba(0,240,255,0.75));
                transition: transform .18s linear, opacity .16s ease, filter .16s ease;
            }
            .rocket-visual.fly {
                opacity: 0.95;
                animation: rocketWiggle .75s ease-in-out infinite alternate;
            }
            .rocket-visual.cashout {
                opacity: 1;
                font-size: 30px;
                filter: drop-shadow(0 0 22px rgba(0,255,120,0.95));
                animation: cashoutPop .45s ease;
            }
            .rocket-visual.boom {
                opacity: 1;
                font-size: 38px;
                filter: drop-shadow(0 0 26px rgba(255,40,90,0.95));
                animation: boomCenter .5s ease;
            }
            .rocket-trail {
                position: absolute;
                left: 50%;
                top: 58%;
                width: 7px;
                height: 64px;
                transform: translateX(-50%);
                border-radius: 999px;
                background: linear-gradient(to top, rgba(255,0,255,0), rgba(0,240,255,0.68), rgba(255,255,255,0.9));
                opacity: 0;
                z-index: 1;
                filter: blur(1px);
                pointer-events: none;
            }
            .rocket-trail.show {
                opacity: .75;
                animation: trailPulse .5s ease-in-out infinite alternate;
            }
            .crash-monitor.cashout-glow {
                box-shadow: 0 0 28px rgba(0,255,120,0.5), inset 0 0 28px rgba(0,255,120,0.10);
            }
            .crash-monitor.boom-glow {
                box-shadow: 0 0 32px rgba(255,0,90,0.58), inset 0 0 32px rgba(255,0,90,0.14);
            }
            @keyframes rocketWiggle {
                from { margin-left: -5px; }
                to { margin-left: 5px; }
            }
            @keyframes trailPulse {
                from { height: 48px; opacity: .35; }
                to { height: 78px; opacity: .75; }
            }
            @keyframes boomCenter {
                0% { transform: translate(-50%, -50%) scale(.6) rotate(0deg); opacity: .7; }
                45% { transform: translate(-50%, -50%) scale(1.35) rotate(0deg); opacity: 1; }
                100% { transform: translate(-50%, -50%) scale(1) rotate(0deg); opacity: 1; }
            }
            @keyframes cashoutPop {
                0% { transform: translate(-50%, -50%) scale(.7) rotate(0deg); }
                50% { transform: translate(-50%, -50%) scale(1.18) rotate(0deg); }
                100% { transform: translate(-50%, -50%) scale(1) rotate(0deg); }
            }

            .quick-bets { display: grid; grid-template-columns: repeat(5, 1fr); gap: 7px; margin: -4px 0 14px; }
            .quick-bet { border: 1px solid rgba(0,240,255,0.35); background: rgba(0,0,0,0.42); color: #fff; border-radius: 12px; padding: 10px 0; font-size: 12px; font-weight: 900; font-family: inherit; box-shadow: inset 0 0 10px rgba(0,240,255,0.06); }
            .quick-bet:active { transform: scale(0.96); }
            .crash-result { min-height: 20px; margin: -8px 0 11px; font-size: 13px; font-weight: 900; color: #aaa; text-shadow: 0 0 10px rgba(255,255,255,0.1); }

            
            .input-group { display: flex; gap: 10px; margin-bottom: 15px; }
            .input-box { flex: 1; background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.2); border-radius: 12px; padding: 10px; text-align: left; }
            .input-box span { display: block; font-size: 10px; color: #aaa; text-transform: uppercase; margin-bottom: 5px; }
            .input-box input { width: 100%; background: transparent; border: none; color: #fff; font-size: 20px; font-weight: 900; outline: none; font-family: 'Montserrat', sans-serif; }
            
            .btn-main { width: 100%; padding: 18px; background: linear-gradient(90deg, #00f0ff, #0055ff); color: #fff; border: none; border-radius: 14px; font-size: 20px; font-weight: 900; box-shadow: 0 0 20px rgba(0,240,255,0.4); text-transform: uppercase; cursor: pointer; transition: 0.1s; letter-spacing: 1px; }
            .btn-main:active { transform: scale(0.96); }
            .btn-main.magenta { background: linear-gradient(90deg, #ff00ff, #ff0055); box-shadow: 0 0 20px rgba(255,0,255,0.4); }
            .btn-main.dark { background: #1a1a24; border: 1px solid #333; box-shadow: none; color: #aaa; }
            .btn-main:disabled { opacity: 0.5; cursor: not-allowed; }

            #maintenanceOverlay {
                display: none;
                position: fixed;
                inset: 0;
                z-index: 99999;
                background: radial-gradient(circle at center, rgba(40,0,80,0.96), rgba(0,0,0,0.98));
                align-items: center;
                justify-content: center;
                text-align: center;
                padding: 20px;
                box-sizing: border-box;
            }
            .maint-box {
                width: 100%;
                max-width: 360px;
                border: 2px solid var(--neon-cyan);
                border-radius: 24px;
                padding: 28px 18px;
                background: rgba(10,10,20,0.94);
                box-shadow: 0 0 35px rgba(0,240,255,0.42), inset 0 0 25px rgba(255,0,255,0.12);
            }
            .maint-title {
                font-size: 24px;
                font-weight: 900;
                color: var(--neon-cyan);
                text-shadow: 0 0 15px var(--neon-cyan);
                margin-bottom: 14px;
            }
            .maint-text {
                font-size: 15px;
                color: #fff;
                margin: 8px 0;
                line-height: 1.45;
            }
            .maint-brand {
                margin-top: 20px;
                font-size: 18px;
                color: var(--gold);
                font-weight: 900;
                text-shadow: 0 0 12px rgba(255,215,0,0.45);
            }

            .copy-box { background: rgba(0,0,0,0.8); border: 1px dashed var(--neon-cyan); padding: 15px; border-radius: 12px; font-family: monospace; color: var(--neon-cyan); word-break: break-all; margin: 15px 0; font-size: 16px; }
            .top-row { display: flex; justify-content: space-between; align-items: center; padding: 15px 10px; border-bottom: 1px solid rgba(255,255,255,0.05); }
            .top-rank { color: var(--gold); font-weight: 900; width: 30px; font-size: 18px; }

            .profile-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin: 12px 0; }
            .profile-stat {
                background: rgba(0,0,0,0.45);
                border: 1px solid rgba(0,240,255,0.25);
                border-radius: 14px;
                padding: 10px 7px;
                box-shadow: inset 0 0 12px rgba(0,240,255,0.08);
            }
            .profile-stat .label { color: #aaa; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px; }
            .profile-stat .value { color: #fff; font-size: 20px; font-weight: 900; text-shadow: 0 0 10px rgba(0,240,255,0.45); word-break: break-word; }

            #profUid { font-size: 22px !important; letter-spacing: -1px; white-space: nowrap; }
            @media (max-width: 380px) {
                #profUid { font-size: 19px !important; letter-spacing: -1.5px; }
                .profile-stat .value { font-size: 19px; }
            }

            .history-list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
            .history-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 10px;
                background: rgba(0,0,0,0.38);
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 12px;
                padding: 10px 11px;
                text-align: left;
            }
            .history-main { color: #fff; font-size: 13px; font-weight: 900; line-height: 1.25; }
            .history-time { color: #777; font-size: 10px; margin-top: 3px; }
            .promo-card-title { color: var(--gold); font-size: 18px; font-weight: 900; margin: 8px 0 12px; text-shadow: 0 0 10px rgba(255,215,0,0.35); }
            .small-info { color: #777; font-size: 11px; margin-top: 12px; line-height: 1.45; }

        
            /* VIP ХОТ ТАП — красивый экран загрузки */
            #vipLoader {
                position: fixed;
                inset: 0;
                z-index: 99999;
                display: flex;
                align-items: center;
                justify-content: center;
                background:
                    radial-gradient(circle at 50% 20%, rgba(0,240,255,.22), transparent 34%),
                    radial-gradient(circle at 50% 78%, rgba(255,0,200,.18), transparent 38%),
                    linear-gradient(180deg, #06010d 0%, #12001f 55%, #030008 100%);
                color: #fff;
                overflow: hidden;
                transition: opacity .45s ease, visibility .45s ease;
            }
            #vipLoader.hide {
                opacity: 0;
                visibility: hidden;
                pointer-events: none;
            }
            #vipLoader::before {
                content: "";
                position: absolute;
                inset: -20%;
                background:
                    linear-gradient(rgba(0,240,255,.18) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(0,240,255,.14) 1px, transparent 1px);
                background-size: 48px 48px;
                transform: perspective(500px) rotateX(62deg) translateY(18%);
                transform-origin: center bottom;
                animation: loaderGrid 2.2s linear infinite;
                opacity: .38;
            }
            @keyframes loaderGrid {
                from { background-position: 0 0, 0 0; }
                to { background-position: 0 48px, 0 48px; }
            }
            .loaderBox {
                position: relative;
                width: min(86vw, 390px);
                padding: 34px 24px;
                border: 2px solid rgba(0,240,255,.75);
                border-radius: 28px;
                background: rgba(10, 6, 22, .74);
                box-shadow: 0 0 28px rgba(0,240,255,.35), inset 0 0 22px rgba(255,0,200,.12);
                text-align: center;
            }
            .loaderLogo {
                font-size: 30px;
                line-height: 1;
                filter: drop-shadow(0 0 14px rgba(0,240,255,.75));
                animation: loaderPulse 1.4s ease-in-out infinite;
            }
            @keyframes loaderPulse {
                0%,100% { transform: scale(1); opacity: .9; }
                50% { transform: scale(1.09); opacity: 1; }
            }
            .loaderTitle {
                margin-top: 14px;
                font-size: 26px;
                font-weight: 900;
                letter-spacing: 1px;
                color: #fff;
                text-shadow: 0 0 14px rgba(0,240,255,.7), 0 0 22px rgba(255,0,200,.45);
            }
            .loaderText {
                margin-top: 8px;
                font-size: 14px;
                font-weight: 800;
                color: #b9f8ff;
                letter-spacing: 2px;
                text-transform: uppercase;
            }
            .loaderBar {
                margin: 24px auto 0;
                height: 12px;
                width: 86%;
                border-radius: 999px;
                overflow: hidden;
                background: rgba(255,255,255,.09);
                border: 1px solid rgba(0,240,255,.45);
            }
            .loaderBar span {
                display: block;
                height: 100%;
                width: 42%;
                border-radius: 999px;
                background: linear-gradient(90deg, #00f0ff, #ff00cc, #ffd000);
                box-shadow: 0 0 18px rgba(0,240,255,.7);
                animation: loaderBarMove 1.15s ease-in-out infinite;
            }
            @keyframes loaderBarMove {
                0% { transform: translateX(-105%); }
                100% { transform: translateX(245%); }
            }
            .loaderHint {
                margin-top: 14px;
                font-size: 12px;
                color: rgba(255,255,255,.62);
            }

        
            .toast-box {
                position: fixed;
                top: 82px;
                left: 50%;
                transform: translateX(-50%) translateY(-20px);
                width: calc(100% - 34px);
                max-width: 440px;
                z-index: 99999;
                padding: 14px 16px;
                border-radius: 18px;
                background: rgba(10, 10, 18, 0.92);
                border: 1px solid rgba(0, 240, 255, 0.45);
                box-shadow: 0 0 20px rgba(0, 240, 255, 0.22), inset 0 0 18px rgba(255,255,255,0.04);
                color: #fff;
                font-size: 15px;
                font-weight: 900;
                line-height: 1.25;
                opacity: 0;
                pointer-events: none;
                transition: opacity .22s ease, transform .22s ease;
                backdrop-filter: blur(10px);
                text-shadow: 0 0 10px rgba(255,255,255,0.28);
            }
            .toast-box.show { opacity: 1; transform: translateX(-50%) translateY(0); }
            .toast-box.success { border-color: rgba(0,255,140,0.65); box-shadow: 0 0 22px rgba(0,255,140,0.22); }
            .toast-box.warn { border-color: rgba(255,215,0,0.7); box-shadow: 0 0 22px rgba(255,215,0,0.18); }
            .toast-box.error { border-color: rgba(255,0,90,0.7); box-shadow: 0 0 22px rgba(255,0,90,0.22); }

        </style>
    </head>
    <body>
        <div id="gameToast" class="toast-box"></div>
        <div id="vipLoader">
            <div class="loaderBox">
                <div class="loaderLogo">💎</div>
                <div class="loaderTitle">VIP ХОТ ТАП</div>
                <div class="loaderText">Загрузка казино...</div>
                <div class="loaderBar"><span></span></div>
                <div class="loaderHint">Подключаем банк, краш и слоты</div>
            </div>
        </div>

        <video autoplay loop muted playsinline class="back-video"><source src="${CONFIG.BG_VIDEO}" type="video/mp4"></video>
        <audio id="bgm" loop src="${CONFIG.BGM_URL}"></audio>

        <div id="maintenanceOverlay">
            <div class="maint-box">
                <div class="maint-title">🛠 ТЕХНИЧЕСКИЙ ПЕРЕРЫВ</div>
                <div class="maint-text">Игра временно недоступна.</div>
                <div class="maint-text">Мы скоро вернёмся.</div>
                <div class="maint-brand">💎 VIP ХОТ ТАП 💎</div>
            </div>
        </div>

        <div class="nav">
            <div class="tab active" onclick="sh(1)">🎰 Слоты</div>
            <div class="tab" onclick="sh(2)">🚀 Краш</div>
            <div class="tab" onclick="sh(3)">🏆 Топ</div>
            <div class="tab" onclick="sh(4)">💎 Банк</div>
            <div class="tab" onclick="sh(5)">👤 Проф.</div>
            <div class="tab" onclick="sh(6)">⚙️ Настр.</div>
        </div>

        <!-- ВКЛАДКА 1: СЛОТЫ -->
        <div id="pg1" class="page active">
            <div class="vip-balance-card">
                <div class="vip-balance-title">БАЛАНС ХОТ ТАП</div>
                <div class="vip-balance-value">
                    <span class="vip-balance-number" id="bal1">0</span>
                    <span class="vip-balance-gem">💎</span>
                </div>
            </div>
            
            <div class="reel-cont">
                <div class="reel"><div class="strip" id="s1"><div class="sym">🍒</div></div></div>
                <div class="reel"><div class="strip" id="s2"><div class="sym">🔔</div></div></div>
                <div class="reel"><div class="strip" id="s3"><div class="sym">🍋</div></div></div>
            </div>
            
            <div class="input-group">
                <div class="input-box" style="flex: 0.3;" onclick="chBet(-10, 'bet1')"><div style="text-align:center; font-size:24px; color:#aaa; margin-top:5px;">-</div></div>
                <div class="input-box"><span style="text-align:center;">Ставка (💎)</span><input type="number" id="bet1" value="10" step="10" style="text-align:center;" readonly></div>
                <div class="input-box" style="flex: 0.3;" onclick="chBet(10, 'bet1')"><div style="text-align:center; font-size:24px; color:#aaa; margin-top:5px;">+</div></div>
            </div>
            <button class="btn-main" onclick="playSpin()" id="btnSpin">КРУТИТЬ</button>
        </div>

        <!-- ВКЛАДКА 2: КРАШ -->
        <div id="pg2" class="page">
            <div class="vip-balance-card">
                <div class="vip-balance-title">БАЛАНС ХОТ ТАП</div>
                <div class="vip-balance-value">
                    <span class="vip-balance-number" id="bal2">0</span>
                    <span class="vip-balance-gem">💎</span>
                </div>
            </div>
            
            <div class="crash-monitor" id="crashMonitor">
                <div class="rocket-trail" id="rocketTrail"></div>
                <div class="rocket-visual" id="rocketVisual">🚀</div>
                <div class="crash-x" id="cX">1.00x</div>
                <div class="crash-status" id="cMsg">ОЖИДАНИЕ...</div>
            </div>

            <div id="crashResult" class="crash-result">Сделай ставку до старта раунда</div>

            <div class="crash-mini-row">
                <div class="crash-mini-card">
                    <div class="crash-mini-label">Игроков</div>
                    <div class="crash-mini-value" id="crashPlayers">0</div>
                </div>
                <div class="crash-mini-card">
                    <div class="crash-mini-label">Моя ставка</div>
                    <div class="crash-mini-value"><span id="crashMyBet">0</span> 💎</div>
                </div>
            </div>

            <div class="crash-history" id="crashHistory">
                <div class="crash-chip low">--</div>
            </div>

            <div class="input-group">
                <div class="input-box" style="flex: 0.3;" onclick="chBet(-10, 'bet2')"><div style="text-align:center; font-size:24px; color:#aaa; margin-top:5px;">-</div></div>
                <div class="input-box"><span style="text-align:center;">Ставка (💎)</span><input type="number" id="bet2" value="10" step="10" style="text-align:center;" readonly></div>
                <div class="input-box" style="flex: 0.3;" onclick="chBet(10, 'bet2')"><div style="text-align:center; font-size:24px; color:#aaa; margin-top:5px;">+</div></div>
            </div>

            <div class="quick-bets">
                <button class="quick-bet" onclick="setCrashBet(10)">10</button>
                <button class="quick-bet" onclick="setCrashBet(50)">50</button>
                <button class="quick-bet" onclick="setCrashBet(100)">100</button>
                <button class="quick-bet" onclick="setCrashBet(500)">500</button>
                <button class="quick-bet" onclick="setCrashBet('all')">ALL</button>
            </div>

            <button class="btn-main magenta" onclick="placeCrashBet()" id="btnCrash">ПОСТАВИТЬ</button>
        </div>

        <!-- ВКЛАДКА 3: ТОП -->
        <div id="pg3" class="page">
            <div class="card" style="padding:10px;">
                <h2 style="color:var(--neon-cyan); margin:10px 0; font-size:18px;">🏆 ЛУЧШИЕ ИГРОКИ</h2>
                <div id="topList">Загрузка...</div>
            </div>
        </div>

        <!-- ВКЛАДКА 4: БАНК -->
        <div id="pg4" class="page">
            <div class="card">
                <h2 style="color:var(--neon-magenta); margin-top:0;">КАССА</h2>
                <p style="color:#aaa; font-size:13px; text-align:left;">Пополнение автоматическое. Скопируй адрес ниже и отправь на него TON. <b>Обязательно укажи свой UID в комментарии (Memo)!</b> TON будут конвертированы в 💎 ХОТ ТАП.</p>
                <div style="color:#00f0ff; font-size:13px; font-weight:900; margin:8px 0 14px;">Курс: 1 TON = 10 000 💎 ХОТ ТАП</div>
                <div class="copy-box" onclick="copy('${CONFIG.WALLET}')">${CONFIG.WALLET}</div>
                <p style="color:#ff0055; font-size:12px; font-weight:bold;">⚠️ ТВОЙ КОД ДЛЯ MEMO / COMMENT:</p>
                <div class="copy-box" style="border-color:#ff0055; font-size:24px; font-weight:bold; color:#fff;" onclick="copy(uid.toString())" id="memoText">...</div>
                
                <button class="btn-main" style="margin-top:20px; font-size:16px;" onclick="withdraw()">💸 ВЫВЕСТИ СРЕДСТВА</button>
            </div>
        </div>

        <!-- ВКЛАДКА 5: ПРОФИЛЬ -->
        <div id="pg5" class="page">
            <div class="card">
                <h2 style="color:var(--neon-cyan); margin-top:0;">👤 VIP ПРОФИЛЬ</h2>
                <div class="profile-grid">
                    <div class="profile-stat"><div class="label">ID игрока</div><div class="value" id="profUid">...</div></div>
                    <div class="profile-stat"><div class="label">Баланс</div><div class="value"><span id="balP">0</span> 💎</div></div>
                    <div class="profile-stat"><div class="label">Спины</div><div class="value" id="profSpins">0</div></div>
                    <div class="profile-stat"><div class="label">Победы</div><div class="value" id="profWins">0</div></div>
                    <div class="profile-stat"><div class="label">Промо</div><div class="value" id="profPromos">0</div></div>
                    <div class="profile-stat"><div class="label">Версия</div><div class="value" style="font-size:15px;" id="profVersion">Alpha</div></div>
                </div>
            </div>

            <div class="card">
                <div class="promo-card-title">🎁 ПРОМОКОД</div>
                <div class="input-box" style="margin-bottom:12px;">
                    <span>Введите промокод</span>
                    <input type="text" id="promoInput" placeholder="VIPSTART" style="text-transform:uppercase;">
                </div>
                <button class="btn-main magenta" onclick="activatePromoFromProfile()" style="font-size:16px;">АКТИВИРОВАТЬ</button>
            </div>

            <div class="card">
                <div class="promo-card-title">📜 ПОСЛЕДНИЕ ДЕЙСТВИЯ</div>
                <div id="historyList" class="history-list">
                    <div class="history-row"><div><div class="history-main">Пока действий нет</div><div class="history-time">Сыграй или пополни баланс</div></div></div>
                </div>
            </div>
        </div>

        <!-- ВКЛАДКА 6: НАСТРОЙКИ -->
        <div id="pg6" class="page">
            <div class="card">
                <h2 style="color:var(--neon-cyan); margin-top:0;">⚙️ НАСТРОЙКИ</h2>
                <button class="btn-main dark" style="margin-top:10px; font-size:16px; color:#fff; border-color:var(--neon-cyan);" onclick="toggleAudio()" id="audioBtn">🔊 ВЫКЛЮЧИТЬ ЗВУК</button>
                <div class="profile-stat" style="margin-top:15px;">
                    <div class="label">Язык</div>
                    <div class="value">RU</div>
                </div>
                <div class="profile-stat" style="margin-top:10px;">
                    <div class="label">Версия игры</div>
                    <div class="value" style="font-size:16px;">VIP ХОТ ТАП Alpha 1.0</div>
                </div>
            </div>
        </div>

        <script>

            function hideVipLoader() {
                const loader = document.getElementById('vipLoader');
                if (!loader) return;
                loader.classList.add('hide');
                setTimeout(() => loader.remove(), 650);
            }
            window.addEventListener('load', () => setTimeout(hideVipLoader, 900));
            setTimeout(hideVipLoader, 4500);

            const tg = window.Telegram.WebApp;
            tg.expand();
            

            let toastTimer = null;
            function showToast(msg, type = "info") {
                const box = document.getElementById('gameToast');
                if (!box) {
                    try { gameAlert(msg); } catch(e) { alert(msg); }
                    return;
                }
                box.className = 'toast-box ' + type;
                box.innerHTML = msg || '';
                clearTimeout(toastTimer);
                requestAnimationFrame(() => box.classList.add('show'));
                toastTimer = setTimeout(() => {
                    box.classList.remove('show');
                }, 2300);
            }
            function gameAlert(msg) {
                const t = String(msg || '');
                const low = t.toLowerCase();
                let type = "info";
                if (t.includes('✅') || t.includes('🎁') || t.includes('Начислено') || t.includes('Выигрыш') || t.includes('забрал')) type = "success";
                if (t.includes('⚠️') || low.includes('уже') || low.includes('введите') || low.includes('лимит')) type = "warn";
                if (t.includes('❌') || low.includes('ошибка') || low.includes('недостаточно') || low.includes('невер')) type = "error";
                showToast(t, type);
            }

const uid = tg.initDataUnsafe?.user?.id || 123456789;

            async function checkMaintenance() {
                try {
                    const r = await fetch('/api/maintenance');
                    const d = await r.json();
                    const overlay = document.getElementById('maintenanceOverlay');
                    if (overlay) overlay.style.display = d.maintenance ? 'flex' : 'none';
                } catch(e) {}
            }
            checkMaintenance();
            setInterval(checkMaintenance, 5000);
            let bal = 0, isSlotGame = false;
            let crashPollInterval = null;
            let lastCrashStatus = '';
            let crashAnimFrame = null;
            let crashStatus = 'betting';
            let syncedStartTime = 0;
            let lastCrashText = '';
            let lastCrashRoundResultShown = false;
            let lastCashoutVisualRound = null;

            function setCrashMultiplier(value) {
                const num = Number(value);
                if (!isFinite(num)) return;
                const txt = num.toFixed(2) + "x";
                if (txt === lastCrashText) return;
                lastCrashText = txt;
                requestAnimationFrame(function () {
                    const el = document.getElementById("cX");
                    if (el) el.innerText = txt;
                });
            }

            function stopCrashAnimation() {
                if (crashAnimFrame) {
                    cancelAnimationFrame(crashAnimFrame);
                    crashAnimFrame = null;
                }
            }

            function animateCrashMultiplier() {
                if (crashStatus !== 'flying' || !syncedStartTime) return;
                const elapsed = Date.now() - syncedStartTime;
                const current = elapsed < 0 ? 1.00 : Math.pow(1.05, elapsed / 500);
                setCrashMultiplier(current);
                crashAnimFrame = requestAnimationFrame(animateCrashMultiplier);
            }

            function startCrashAnimation(startTime, serverTime) {
                const nowClient = Date.now();
                syncedStartTime = startTime + (nowClient - serverTime);
                if (!crashAnimFrame) animateCrashMultiplier();
            }


            function setCrashBet(value) {
                const inp = document.getElementById('bet2');
                if (!inp) return;
                if (value === 'all') inp.value = Math.max(10, Math.floor(bal || 10));
                else inp.value = Math.max(10, Math.floor(Number(value) || 10));
            }

            function crashChipClass(x) {
                const n = Number(x);
                if (n >= 30) return 'max';
                if (n >= 5) return 'high';
                if (n >= 2) return 'mid';
                return 'low';
            }

            function renderCrashHistory(history) {
                const box = document.getElementById('crashHistory');
                if (!box) return;
                if (!history || history.length === 0) {
                    box.innerHTML = '<div class="crash-chip low">--</div>';
                    return;
                }
                box.innerHTML = history.map(x => {
                    const n = Number(x || 0);
                    return '<div class="crash-chip ' + crashChipClass(n) + '">' + n.toFixed(2) + 'x</div>';
                }).join('');
            }

            function setCrashResult(text, type) {
                const el = document.getElementById('crashResult');
                if (!el) return;
                el.innerText = text || '';
                if (type === 'win') el.style.color = '#00ff66';
                else if (type === 'lose') el.style.color = '#ff4a4a';
                else if (type === 'wait') el.style.color = '#ffd700';
                else el.style.color = '#aaa';
            }


            function setRocketState(state, multiplier = 1) {
                const rocket = document.getElementById('rocketVisual');
                const trail = document.getElementById('rocketTrail');
                const monitor = document.getElementById('crashMonitor');
                const msg = document.getElementById('cMsg');

                if (!rocket || !trail || !monitor) return;

                rocket.className = 'rocket-visual';
                trail.className = 'rocket-trail';
                monitor.classList.remove('cashout-glow', 'boom-glow');

                rocket.style.opacity = '0';
                trail.style.opacity = '0';
                rocket.innerText = '🚀';

                if (state === 'idle') {
                    rocket.style.transform = 'translate(-50%, -50%) translateY(38px) scale(0.8) rotate(-12deg)';
                    if (msg) msg.innerText = 'СДЕЛАЙ СТАВКУ ДО СТАРТА';
                    return;
                }

                if (state === 'fly') {
                    const m = Math.max(1, Math.min(Number(multiplier) || 1, 30));
                    const y = 58 - (m - 1) * 2.4;

                    rocket.innerText = '🚀';
                    rocket.style.opacity = '1';
                    trail.style.opacity = '0.8';
                    rocket.style.transform = 'translate(-50%, -50%) translateY(' + Math.max(-18, y) + 'px) scale(0.9) rotate(-12deg)';

                    rocket.classList.add('fly');
                    trail.classList.add('show');

                    if (msg) msg.innerText = 'РАКЕТА ЛЕТИТ...';
                    return;
                }

                if (state === 'cashout') {
                    rocket.innerText = '✅';
                    rocket.style.opacity = '1';
                    trail.style.opacity = '0';
                    rocket.style.transform = 'translate(-50%, -50%) translateY(42px) scale(0.72) rotate(0deg)';

                    rocket.classList.add('cashout');
                    monitor.classList.add('cashout-glow');

                    if (msg) msg.innerText = 'КУШ ЗАБРАН';
                    return;
                }

                if (state === 'boom') {
                    rocket.innerText = '💥';
                    rocket.style.opacity = '1';
                    trail.style.opacity = '0';
                    rocket.style.transform = 'translate(-50%, -50%) translateY(28px) scale(0.88) rotate(0deg)';

                    rocket.classList.add('boom');
                    monitor.classList.add('boom-glow');

                    if (msg) msg.innerText = 'РАКЕТА ВЗОРВАЛАСЬ!';
                }
            }


            
            document.getElementById('memoText').innerText = uid;
            const syms = ['🍒','🔔','💎','7️⃣','🍋'];

            function sh(n) {
                document.querySelectorAll('.page, .tab').forEach(e => e.classList.remove('active'));
                document.getElementById('pg'+n).classList.add('active');
                document.querySelectorAll('.tab')[n-1].classList.add('active');
                
                if(n === 3) loadTop();
                if(n === 5) loadProfile();
                
                if(n === 2) {
                    if(!crashPollInterval) crashPollInterval = setInterval(pollCrashState, 500);
                    pollCrashState();
                } else {
                    if(crashPollInterval) { clearInterval(crashPollInterval); crashPollInterval = null; }
                }
            }

            function chBet(d, id) {
                let v = parseFloat(document.getElementById(id).value) + d;
                if(v < 10) v = 10;
                document.getElementById(id).value = Math.floor(v);
            }

            function copy(t) { navigator.clipboard.writeText(t); gameAlert("Скопировано!"); }

            function toggleAudio() {
                const a = document.getElementById('bgm');
                a.muted = !a.muted;
                if(a.muted) { document.getElementById('audioBtn').innerText="🔈 ВКЛЮЧИТЬ ЗВУК"; document.getElementById('audioBtn').style.borderColor="#333"; }
                else { a.play().catch(e=>{}); document.getElementById('audioBtn').innerText="🔊 ВЫКЛЮЧИТЬ ЗВУК"; document.getElementById('audioBtn').style.borderColor="var(--neon-cyan)"; }
            }

            function formatBal(val) {
                return Math.floor(val).toLocaleString('ru-RU');
            }

            function updateBal(newBal) {
                bal = Math.floor(newBal);
                document.getElementById('bal1').innerText = formatBal(bal);
                document.getElementById('bal2').innerText = formatBal(bal);
                const bp = document.getElementById('balP');
                if (bp) bp.innerText = formatBal(bal);
            }

            async function upd() {
                try {
                    const r = await fetch('/api/sync', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid})});
                    const d = await r.json(); updateBal(d.balance);
                } catch(e){}
            }

            async function loadTop() {
                document.getElementById('topList').innerHTML = "Загрузка...";
                const r = await fetch('/api/leaderboard', {method:'POST'});
                const d = await r.json();
                let h = '';
                d.forEach((u,i) => {
                    let rank = i===0?'🥇':i===1?'🥈':i===2?'🥉':(i+1);
                    h += '<div class="top-row"><div class="top-rank">'+rank+'</div><div style="flex:1; text-align:left; color:#ccc;">ID '+u.uid+'</div><div style="color:var(--neon-cyan); font-weight:900;">'+formatBal(u.balance)+' 💎</div></div>';
                });
                document.getElementById('topList').innerHTML = h;
            }

            // --- ИГРА: СЛОТЫ ---
            function buildStrip(targetSymbol) {
                let html = '';
                for(let i=0; i<25; i++) {
                    html += '<div class="sym">'+syms[Math.floor(Math.random()*syms.length)]+'</div>';
                }
                html += '<div class="sym">'+targetSymbol+'</div>';
                return html;
            }

            async function playSpin() {
                if(isSlotGame) return;
                const bet = parseFloat(document.getElementById('bet1').value);
                if(bet > bal) return gameAlert("Мало 💎 ХОТ ТАП!");
                const a = document.getElementById('bgm'); if(a.paused && !a.muted) a.play().catch(e=>{});
                
                isSlotGame = true; const btn = document.getElementById('btnSpin'); btn.disabled = true;
                
                try {
                    const r = await fetch('/api/spin', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, bet})});
                    const d = await r.json();
                    
                    if(d.err) { gameAlert(d.err); isSlotGame=false; btn.disabled=false; return; }
                    updateBal(bal - bet);
                    
                    const s1 = document.getElementById('s1'); const s2 = document.getElementById('s2'); const s3 = document.getElementById('s3');
                    
                    s1.style.transition = 'none'; s1.style.transform = 'translateY(0)';
                    s2.style.transition = 'none'; s2.style.transform = 'translateY(0)';
                    s3.style.transition = 'none'; s3.style.transform = 'translateY(0)';
                    
                    s1.innerHTML = buildStrip(d.result[0]);
                    s2.innerHTML = buildStrip(d.result[1]);
                    s3.innerHTML = buildStrip(d.result[2]);
                    
                    void s1.offsetWidth; void s2.offsetWidth; void s3.offsetWidth;
                    
                    const targetY = -(25 * 120); 
                    
                    setTimeout(() => { s1.style.transition = 'transform 2s cubic-bezier(0.15, 1, 0.3, 1)'; s1.style.transform = 'translateY(' + targetY + 'px)'; }, 50);
                    setTimeout(() => { s2.style.transition = 'transform 2s cubic-bezier(0.15, 1, 0.3, 1)'; s2.style.transform = 'translateY(' + targetY + 'px)'; }, 300);
                    setTimeout(() => { s3.style.transition = 'transform 2s cubic-bezier(0.15, 1, 0.3, 1)'; s3.style.transform = 'translateY(' + targetY + 'px)'; }, 600);
                    
                    setTimeout(() => {
                        updateBal(d.balance);
                        if(d.winSum > 0) { gameAlert("🎉 ВЫИГРЫШ: " + formatBal(d.winSum) + " 💎"); if(window.navigator.vibrate) window.navigator.vibrate([100,50,100,50,100]); }
                        isSlotGame = false; btn.disabled=false;
                    }, 2600);
                } catch(e) { isSlotGame = false; btn.disabled=false; }
            }

            // --- ИГРА: КРАШ (ГЛОБАЛЬНАЯ) ---
            async function pollCrashState() {
                try {
                    const r = await fetch('/api/crash/state', {
                        method:'POST',
                        headers:{'Content-Type':'application/json'},
                        body:JSON.stringify({uid})
                    });
                    const d = await r.json();

                    const cx = document.getElementById('cX');
                    const cm = document.getElementById('cMsg');
                    const btn = document.getElementById('btnCrash');

                    renderCrashHistory(d.history || []);
                    const playersEl = document.getElementById('crashPlayers');
                    if (playersEl) playersEl.innerText = d.playersCount || 0;
                    const myBetEl = document.getElementById('crashMyBet');
                    if (myBetEl) myBetEl.innerText = formatBal(d.bet || 0);

                    crashStatus = d.status;

                    if (d.status === 'betting') {
                        lastCrashRoundResultShown = false;
                        lastCashoutVisualRound = null;
                        setRocketState('idle');
                        stopCrashAnimation();
                        setCrashMultiplier(1.00);
                        cx.style.color = "#fff";
                        cx.style.textShadow = "0 0 18px rgba(255,255,255,0.65)";
                        cm.innerText = "ДО СТАРТА: " + d.timeLeft + " СЕК";
                        cm.style.color = "#aaa";

                        if (d.bet > 0) {
                            setCrashResult("✅ Ставка принята: " + formatBal(d.bet) + " 💎", "wait");
                            btn.disabled = true;
                            btn.innerText = "СТАВКА ПРИНЯТА";
                            btn.style.background = "#555";
                            btn.style.boxShadow = "none";
                        } else {
                            setCrashResult("Сделай ставку до старта раунда", "info");
                            btn.disabled = false;
                            btn.innerText = "ПОСТАВИТЬ";
                            btn.onclick = placeCrashBet;
                            btn.style.background = "";
                            btn.style.boxShadow = "";
                        }
                    } else if (d.status === 'flying') {
                        setRocketState('fly', d.currentMultiplier);
                        cx.style.color = "#00ff66";
                        cx.style.textShadow = "0 0 18px rgba(0,255,102,0.55)";
                        cm.innerText = "РАКЕТА ЛЕТИТ...";
                        cm.style.color = "#00f0ff";

                        if (d.startTime && d.serverTime) {
                            startCrashAnimation(Number(d.startTime), Number(d.serverTime));
                        }

                        if (d.bet > 0 && !d.cashedOut) {
                            const potential = Math.floor(Number(d.bet) * Number(d.currentMultiplier || 1));
                            setCrashResult("Потенциал: +" + formatBal(potential) + " 💎", "wait");
                            btn.disabled = false;
                            btn.innerText = "💰 ЗАБРАТЬ КУШ";
                            btn.onclick = cashoutCrashGlobal;
                            btn.style.background = "linear-gradient(90deg, #00ff00, #009900)";
                            btn.style.boxShadow = "0 0 20px rgba(0,255,0,0.5)";
                        } else if (d.bet > 0 && d.cashedOut) {
                            if (lastCashoutVisualRound !== d.roundId) {
                                setRocketState('cashout');
                                lastCashoutVisualRound = d.roundId;
                            }
                            setCrashResult("✅ Забрал +" + formatBal(d.winSum) + " 💎", "win");
                            btn.disabled = true;
                            btn.innerText = "✅ ЗАБРАЛ +" + formatBal(d.winSum) + " 💎";
                            btn.style.background = "#555";
                            btn.style.boxShadow = "none";
                        } else {
                            setCrashResult("Раунд идёт, жди следующий", "info");
                            btn.disabled = true;
                            btn.innerText = "ОЖИДАНИЕ...";
                            btn.style.background = "#555";
                            btn.style.boxShadow = "none";
                        }
                    } else if (d.status === 'crashed') {
                        if (d.bet > 0 && d.cashedOut) {
                            setRocketState('cashout');
                        } else {
                            setRocketState('boom');
                        }
                        stopCrashAnimation();
                        setCrashMultiplier(Number(d.crashedMultiplier || 1));
                        cx.style.color = "#ff3030";
                        cx.style.textShadow = "0 0 18px rgba(255,48,48,0.65)";
                        cm.innerText = "💥 РАКЕТА ВЗОРВАЛАСЬ!";
                        cm.style.color = "#ff3030";

                        if (!lastCrashRoundResultShown) {
                            if (d.bet > 0 && d.cashedOut) {
                                setCrashResult("✅ Ты забрал +" + formatBal(d.winSum) + " 💎", "win");
                            } else if (d.bet > 0) {
                                setCrashResult("💥 Проигрыш -" + formatBal(d.bet) + " 💎", "lose");
                            } else {
                                setCrashResult("💥 Взорвалась на " + Number(d.crashedMultiplier || 1).toFixed(2) + "x", "lose");
                            }
                            lastCrashRoundResultShown = true;
                        }

                        btn.disabled = true;
                        btn.innerText = (d.bet > 0 && d.cashedOut) ? "✅ ЗАБРАЛ" : "ВЗРЫВ";
                        btn.style.background = "#ff0000";
                        btn.style.boxShadow = "0 0 20px rgba(255,0,0,0.5)";

                        if (lastCrashStatus !== 'crashed' && window.navigator.vibrate) {
                            window.navigator.vibrate([500]);
                        }
                    }

                    lastCrashStatus = d.status;
                } catch(e) {}
            }

            async function placeCrashBet() {
                const bet = parseFloat(document.getElementById('bet2').value);
                if(bet > bal) return gameAlert("Мало 💎 ХОТ ТАП!");
                
                const btn = document.getElementById('btnCrash');
                btn.disabled = true;
                
                const a = document.getElementById('bgm'); if(a.paused && !a.muted) a.play().catch(e=>{});
                
                try {
                    const r = await fetch('/api/crash/bet', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, bet})});
                    const d = await r.json();
                    if(d.err) { gameAlert(d.err); btn.disabled = false; }
                    else { updateBal(d.balance); pollCrashState(); }
                } catch(e) { btn.disabled = false; }
            }

            async function cashoutCrashGlobal() {
                const btn = document.getElementById('btnCrash');
                btn.disabled = true;
                
                try {
                    const r = await fetch('/api/crash/cashout', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid})});
                    const d = await r.json();
                    if(d.err) {
                        gameAlert(d.err);
                        btn.disabled = false;
                    } else if (d.success) {
                        setRocketState('cashout');
                        gameAlert("✅ +" + formatBal(d.winSum) + " 💎");
                        if(window.navigator.vibrate) window.navigator.vibrate([100,50,100]);
                        updateBal(d.balance);
                        pollCrashState(); // Немедленно обновить UI
                    }
                } catch(e) {
                    btn.disabled = false;
                    gameAlert("Ошибка забора куша");
                }
            }

            function withdraw() {
                const a = prompt("Кошелёк для вывода:"); if(!a) return;
                const sum = prompt("Сумма вывода (в 💎):"); if(!sum) return;
                fetch('/api/withdraw', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, address:a, amount:parseFloat(sum)})})
                .then(r=>r.json()).then(d=>{ gameAlert(d.msg||d.err); upd(); });
            }
            

            function renderHistory(history) {
                const list = document.getElementById('historyList');
                if (!list) return;
                if (!history || history.length === 0) {
                    list.innerHTML = '<div class="history-row"><div><div class="history-main">Пока действий нет</div><div class="history-time">Сыграй или пополни баланс</div></div></div>';
                    return;
                }
                list.innerHTML = history.map(h => {
                    let time = '';
                    try {
                        if (h.createdAt) time = new Date(h.createdAt).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
                    } catch(e) {}
                    return '<div class="history-row"><div><div class="history-main">' + (h.text || 'Действие') + '</div><div class="history-time">' + time + '</div></div></div>';
                }).join('');
            }

            async function loadProfile() {
                try {
                    const r = await fetch('/api/profile', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid})});
                    const d = await r.json();
                    if(d.err) return gameAlert(d.err);
                    document.getElementById('profUid').innerText = d.uid;
                    document.getElementById('profSpins').innerText = formatBal(d.spins || 0);
                    document.getElementById('profWins').innerText = formatBal(d.wins || 0);
                    document.getElementById('profPromos').innerText = formatBal(d.promos || 0);
                    document.getElementById('profVersion').innerText = "Alpha 1.0";
                    renderHistory(d.history || []);
                    updateBal(d.balance || 0);
                } catch(e) {}
            }

            function activatePromoFromProfile() {
                const inp = document.getElementById('promoInput');
                const code = (inp?.value || '').trim().toUpperCase();
                if(!code) return gameAlert("Введите промокод");
                fetch('/api/promo', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, promo:code})})
                .then(r=>r.json()).then(d=>{
                    gameAlert(d.msg||d.err);
                    if(d.msg && inp) inp.value = "";
                    upd();
                    loadProfile();
                });
            }

            function promo() {
                const code = prompt("Введите промокод:"); if(!code) return;
                fetch('/api/promo', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, promo:code})})
                .then(r=>r.json()).then(d=>{ gameAlert(d.msg||d.err); upd(); loadProfile(); });
            }

            setInterval(upd, 5000); upd();
            document.getElementById('bgm').muted = false; // Звук включен по умолчанию
        </script>
    </body>
    </html>`);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('Сервер запущен на порту ' + PORT));
