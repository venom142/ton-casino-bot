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
    notified_inactive: { type: Boolean, default: false }
});

const Promo = mongoose.model('Promo', {
    code: String, value: Number, limit: Number, usedCount: { type: Number, default: 0 }
});

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
            if (user) { user.balance += Math.floor(parseFloat(msg.text)); await user.save(); bot.sendMessage(msg.chat.id, `✅ Выдано!`); bot.sendMessage(uid, `🎁 Начислен бонус: +${Math.floor(parseFloat(msg.text))} 💎`).catch(()=>{}); }
            delete adminState[msg.from.id];
        }
        else if (s === 'p_code') { adminState[msg.from.id] = `p_val_${msg.text.trim().toUpperCase()}`; bot.sendMessage(msg.chat.id, `Сумма (в 💎):`); }
        else if (s.startsWith('p_val_')) { adminState[msg.from.id] = `p_lim_${s.split('_')[2]}_${Math.floor(parseFloat(msg.text))}`; bot.sendMessage(msg.chat.id, `Лимит активаций:`); }
        else if (s.startsWith('p_lim_')) {
            const [, , code, valStr] = s.split('_');
            await Promo.findOneAndUpdate({ code }, { code, value: Math.floor(parseFloat(valStr)), limit: parseInt(msg.text), usedCount: 0 }, { upsert: true });
            bot.sendMessage(msg.chat.id, `✅ Промокод создан!\nКод: \`${code}\` | Сумма: ${Math.floor(parseFloat(valStr))} 💎 | Лимит: ${parseInt(msg.text)}`, {parse_mode:'Markdown'}); delete adminState[msg.from.id];
        }
        else if (s === 'p_del') { await Promo.deleteOne({ code: msg.text.trim().toUpperCase() }); bot.sendMessage(msg.chat.id, "🗑 Удалено."); delete adminState[msg.from.id]; }
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
        user.balance += pr.value; user.used_promos.push(p); await user.save();
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
        user.balance += winSum; user.spins++; if(isWin) user.wins++; await user.save();
        res.json({ result, winSum, balance: Math.floor(user.balance) });
    } catch (e) { res.json({ err: "Ошибка спина" }); }
});

// ==========================================
// 🚀 ЛОГИКА ИГРЫ КРАШ (ГЛОБАЛЬНАЯ)
// ==========================================
const crashState = {
    status: 'betting', // 'betting', 'flying', 'crashed'
    crashPoint: 0,
    startTime: 0,
    bettingEndsAt: Date.now() + 10000,
    crashedMultiplier: 0,
    bets: {} // uid -> { bet, cashedOut, winSum }
};

// Серверный цикл игры Краш
setInterval(() => {
    const now = Date.now();
    
    if (crashState.status === 'betting') {
        if (now >= crashState.bettingEndsAt) {
            // Переход к полёту
            crashState.status = 'flying';
            crashState.startTime = now;
            
            // Генерация точки взрыва
            crashState.crashPoint = 1.00;
            if (Math.random() > 0.05) {
                crashState.crashPoint = parseFloat((1 / Math.random() * 0.95).toFixed(2));
            }
            if (crashState.crashPoint < 1.00) crashState.crashPoint = 1.00;
        }
    } else if (crashState.status === 'flying') {
        const elapsed = now - crashState.startTime;
        const currentMult = elapsed < 0 ? 1.00 : Math.pow(1.05, elapsed / 500);
        
        if (currentMult >= crashState.crashPoint) {
            // Взрыв!
            crashState.status = 'crashed';
            crashState.crashedMultiplier = crashState.crashPoint;
            
            // Ожидаем 3 секунды и начинаем новый раунд
            setTimeout(() => {
                crashState.status = 'betting';
                crashState.bettingEndsAt = Date.now() + 10000;
                crashState.bets = {};
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
            currentMultiplier: currentMult.toFixed(2),
            timeLeft: timeLeft,
            crashedMultiplier: crashState.crashedMultiplier.toFixed(2),
            bet: myBet ? myBet.bet : 0,
            cashedOut: myBet ? myBet.cashedOut : false,
            winSum: myBet ? myBet.winSum : 0
        });
    } catch(e) { res.json({ err: "State err" }); }
});

app.post('/api/crash/bet', async (req, res) => {
    try {
        const { uid, bet } = req.body;
        
        if (crashState.status !== 'betting') return res.json({ err: "Ставки уже закрыты!" });
        if (crashState.bets[uid]) return res.json({ err: "Вы уже сделали ставку!" });
        
        const user = await User.findOne({ uid: uid.toString() });
        if (!user || user.balance < bet || bet < SETTINGS.minBet) return res.json({ err: "Мало 💎 ХОТ ТАП!" });
        
        user.balance -= bet;
        user.spins++;
        await user.save();
        
        crashState.bets[uid] = { bet: bet, cashedOut: false, winSum: 0 };
        res.json({ success: true, balance: Math.floor(user.balance) });
    } catch (e) { res.json({ err: "Ошибка ставки" }); }
});

app.post('/api/crash/cashout', async (req, res) => {
    try {
        const { uid } = req.body;
        
        if (crashState.status !== 'flying') return res.json({ err: "Раунд не в полёте!" });
        
        const myBet = crashState.bets[uid];
        if (!myBet) return res.json({ err: "Вы не ставили в этом раунде!" });
        if (myBet.cashedOut) return res.json({ err: "Уже забрали куш!" });
        
        const now = Date.now();
        const currentMult = Math.pow(1.05, (now - crashState.startTime) / 500);
        
        if (currentMult >= crashState.crashPoint) {
            return res.json({ err: "Ракета уже взорвалась!" });
        }
        
        const winSum = Math.floor(myBet.bet * currentMult);
        myBet.cashedOut = true;
        myBet.winSum = winSum;
        
        const user = await User.findOne({ uid: uid.toString() });
        if (user) {
            user.balance += winSum;
            user.wins++;
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
            
            .nav { display: flex; background: rgba(10,10,12,0.95); border-bottom: 2px solid var(--neon-magenta); box-shadow: 0 0 15px rgba(255,0,255,0.3); }
            .tab { flex: 1; padding: 15px 0; font-size: 11px; font-weight: 900; color: #666; cursor: pointer; transition: 0.3s; text-transform: uppercase; }
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
            .crash-x { font-size: 54px; font-weight: 900; color: #fff; text-shadow: 0 0 20px #fff; transition: color 0.2s; }
            .crash-status { font-size: 14px; color: #aaa; margin-top: 5px; text-transform: uppercase; letter-spacing: 2px; }
            
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
        </style>
    </head>
    <body>
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
            <div class="tab" onclick="sh(5)">⚙️ Настр.</div>
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
            
            <div class="crash-monitor">
                <div class="crash-x" id="cX">1.00x</div>
                <div class="crash-status" id="cMsg">ОЖИДАНИЕ...</div>
            </div>
            
            <div class="input-group">
                <div class="input-box" style="flex: 0.3;" onclick="chBet(-10, 'bet2')"><div style="text-align:center; font-size:24px; color:#aaa; margin-top:5px;">-</div></div>
                <div class="input-box"><span style="text-align:center;">Ставка (💎)</span><input type="number" id="bet2" value="10" step="10" style="text-align:center;" readonly></div>
                <div class="input-box" style="flex: 0.3;" onclick="chBet(10, 'bet2')"><div style="text-align:center; font-size:24px; color:#aaa; margin-top:5px;">+</div></div>
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
                <button class="btn-main dark" style="margin-top:10px; font-size:16px;" onclick="promo()">🎁 ВВЕСТИ ПРОМОКОД</button>
            </div>
        </div>

        <!-- ВКЛАДКА 5: НАСТРОЙКИ -->
        <div id="pg5" class="page">
            <div class="card">
                <h2 style="color:var(--neon-cyan); margin-top:0;">НАСТРОЙКИ</h2>
                <button class="btn-main dark" style="margin-top:10px; font-size:16px; color:#fff; border-color:var(--neon-cyan);" onclick="toggleAudio()" id="audioBtn">🔊 ВЫКЛЮЧИТЬ ЗВУК</button>
                <p style="color:#666; font-size:11px; margin-top:20px;">Версия клиента: 3.0 (Global Crash Edition)</p>
            </div>
        </div>

        <script>
            const tg = window.Telegram.WebApp;
            tg.expand();
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
            
            document.getElementById('memoText').innerText = uid;
            const syms = ['🍒','🔔','💎','7️⃣','🍋'];

            function sh(n) {
                document.querySelectorAll('.page, .tab').forEach(e => e.classList.remove('active'));
                document.getElementById('pg'+n).classList.add('active');
                document.querySelectorAll('.tab')[n-1].classList.add('active');
                
                if(n === 3) loadTop();
                
                if(n === 2) {
                    if(!crashPollInterval) crashPollInterval = setInterval(pollCrashState, 250);
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

            function copy(t) { navigator.clipboard.writeText(t); tg.showAlert("Скопировано!"); }

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
                if(bet > bal) return tg.showAlert("Мало 💎 ХОТ ТАП!");
                const a = document.getElementById('bgm'); if(a.paused && !a.muted) a.play().catch(e=>{});
                
                isSlotGame = true; const btn = document.getElementById('btnSpin'); btn.disabled = true;
                
                try {
                    const r = await fetch('/api/spin', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, bet})});
                    const d = await r.json();
                    
                    if(d.err) { tg.showAlert(d.err); isSlotGame=false; btn.disabled=false; return; }
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
                        if(d.winSum > 0) { tg.showAlert("🎉 ВЫИГРЫШ: " + formatBal(d.winSum) + " 💎"); if(window.navigator.vibrate) window.navigator.vibrate([100,50,100,50,100]); }
                        isSlotGame = false; btn.disabled=false;
                    }, 2600);
                } catch(e) { isSlotGame = false; btn.disabled=false; }
            }

            // --- ИГРА: КРАШ (ГЛОБАЛЬНАЯ) ---
            async function pollCrashState() {
                try {
                    const r = await fetch('/api/crash/state', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid})});
                    const d = await r.json();
                    
                    const cx = document.getElementById('cX');
                    const cm = document.getElementById('cMsg');
                    const btn = document.getElementById('btnCrash');
                    
                    if (d.status === 'betting') {
                        cx.style.color = "#fff";
                        cx.innerText = "1.00x";
                        cm.innerText = "ДО ЗАПУСКА: " + d.timeLeft + " СЕК";
                        cm.style.color = "#aaa";
                        
                        if (d.bet > 0) {
                            btn.disabled = true;
                            btn.innerText = "СТАВКА " + formatBal(d.bet) + " 💎 ПРИНЯТА";
                            btn.style.background = "#555";
                            btn.style.boxShadow = "none";
                        } else {
                            btn.disabled = false;
                            btn.innerText = "ПОСТАВИТЬ";
                            btn.onclick = placeCrashBet;
                            btn.style.background = ""; // Родной градиент
                            btn.style.boxShadow = "";
                        }
                    } else if (d.status === 'flying') {
                        cx.style.color = "#fff";
                        cx.innerText = d.currentMultiplier + "x";
                        cm.innerText = "РАКЕТА ЛЕТИТ...";
                        cm.style.color = "#00f0ff";
                        
                        if (d.bet > 0 && !d.cashedOut) {
                            btn.disabled = false;
                            btn.innerText = "💰 ЗАБРАТЬ КУШ";
                            btn.onclick = cashoutCrashGlobal;
                            btn.style.background = "linear-gradient(90deg, #00ff00, #009900)";
                            btn.style.boxShadow = "0 0 20px rgba(0,255,0,0.5)";
                        } else if (d.bet > 0 && d.cashedOut) {
                            btn.disabled = true;
                            btn.innerText = "✅ ЗАБРАЛ +" + formatBal(d.winSum) + " 💎";
                            btn.style.background = "#555";
                            btn.style.boxShadow = "none";
                            cx.style.color = "#00ff00"; // Зеленый текст если забрал
                        } else {
                            btn.disabled = true;
                            btn.innerText = "ОЖИДАНИЕ...";
                            btn.style.background = "#555";
                            btn.style.boxShadow = "none";
                        }
                    } else if (d.status === 'crashed') {
                        cx.style.color = "#ff0000";
                        cx.innerText = d.crashedMultiplier + "x";
                        cm.innerText = "💥 РАКЕТА ВЗОРВАЛАСЬ!";
                        cm.style.color = "#ff0000";
                        
                        btn.disabled = true;
                        btn.innerText = "ВЗРЫВ";
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
                if(bet > bal) return tg.showAlert("Мало 💎 ХОТ ТАП!");
                
                const btn = document.getElementById('btnCrash');
                btn.disabled = true;
                
                const a = document.getElementById('bgm'); if(a.paused && !a.muted) a.play().catch(e=>{});
                
                try {
                    const r = await fetch('/api/crash/bet', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, bet})});
                    const d = await r.json();
                    if(d.err) { tg.showAlert(d.err); btn.disabled = false; }
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
                        // Если опоздал (crashed), сервер вернёт ошибку "Ракета уже взорвалась", 
                        // что обновится при следующем тике pollCrashState
                    } else if (d.success) {
                        if(window.navigator.vibrate) window.navigator.vibrate([100,50,100]);
                        updateBal(d.balance);
                        pollCrashState(); // Немедленно обновить UI
                    }
                } catch(e) {}
            }

            function withdraw() {
                const a = prompt("Кошелёк для вывода:"); if(!a) return;
                const sum = prompt("Сумма вывода (в 💎):"); if(!sum) return;
                fetch('/api/withdraw', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, address:a, amount:parseFloat(sum)})})
                .then(r=>r.json()).then(d=>{ tg.showAlert(d.msg||d.err); upd(); });
            }
            
            function promo() {
                const code = prompt("Введите промокод:"); if(!code) return;
                fetch('/api/promo', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, promo:code})})
                .then(r=>r.json()).then(d=>{ tg.showAlert(d.msg||d.err); upd(); });
            }

            setInterval(upd, 5000); upd();
            document.getElementById('bgm').muted = false; // Звук включен по умолчанию
        </script>
    </body>
    </html>`);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('Сервер запущен на порту ' + PORT));
