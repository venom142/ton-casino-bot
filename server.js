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
    START_BALANCE: 0, 
    HOTTAP_RATE: 10000,
    BG_VIDEO: "https://raw.githubusercontent.com/venom142/ton-casino-bot/main/gemini_generated_video_9fc75b5d.mp4", 
    BGM_URL: "https://files.catbox.moe/ef3c37.mp3"
};

let SETTINGS = { winChance: 0.15, multiplier: 10, minBet: 10 };

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
    
    // --- ПОДТВЕРЖДЕНИЕ ВЫВОДА ---
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

    // --- ОТКЛОНЕНИЕ ВЫВОДА ---
    if (q.data.startsWith('withdraw_no_')) {
        const [, , uid] = q.data.split('_');
        
        bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: q.message.chat.id, message_id: q.message.message_id });

        bot.sendMessage(uid, "❌ Заявка на вывод отклонена.").catch(()=>{});
        bot.sendMessage(q.message.chat.id, "❌ Заявка отклонена. Баланс не изменён.");
        return;
    }

    // --- ОСНОВНОЕ МЕНЮ АДМИНА ---
    if (q.data === "admin_menu") {
        bot.sendMessage(q.message.chat.id, `👑 **Админка**\n\n⚙️ Шанс: **${Math.round(SETTINGS.winChance * 100)}%**\n✖️ Икс: **x${SETTINGS.multiplier}**`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: "📢 Рассылка", callback_data: "adm_msg" }, { text: "💰 Баланс", callback_data: "adm_bal" }],
                [{ text: "🎁 Создать ПРОМО", callback_data: "adm_promo_add" }, { text: "🗑 Удал. ПРОМО", callback_data: "adm_promo_del" }],
                [{ text: "⚙️ Изменить ШАНС", callback_data: "adm_set_chance" }, { text: "✖️ Изменить ИКС", callback_data: "adm_set_mult" }],
                [{ text: "📊 Статистика", callback_data: "adm_stat" }, { text: "💀 ОБНУЛИТЬ ВСЕХ", callback_data: "adm_wipe_all" }]
            ]}
        });
    }
    if (q.data === "adm_stat") {
        const users = await User.countDocuments(); const promos = await Promo.countDocuments();
        bot.sendMessage(q.message.chat.id, `📊 Игроков: **${users}**\n🎁 Активных промо: **${promos}**`, { parse_mode: 'Markdown' });
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

// --- ЛОГИКА ИГРЫ КРАШ ---
const crashRounds = {}; // Память активных раундов

app.post('/api/crash/start', async (req, res) => {
    try {
        const { uid, bet } = req.body; 
        const user = await User.findOne({ uid: uid.toString() });
        
        if (!user || user.balance < bet || bet < SETTINGS.minBet) return res.json({ err: "Мало 💎 ХОТ ТАП!" });
        
        user.balance -= bet;
        user.spins++;
        await user.save();
        
        let crashPoint = 1.00;
        if (Math.random() > 0.05) crashPoint = parseFloat((1 / Math.random() * 0.95).toFixed(2));
        if (crashPoint < 1.00) crashPoint = 1.00;
        
        crashRounds[uid] = {
            bet: bet,
            crashPoint: crashPoint,
            startTime: Date.now(),
            active: true
        };
        
        res.json({ success: true, balance: Math.floor(user.balance) });
    } catch (e) { res.json({ err: "Ошибка старта краша" }); }
});

app.post('/api/crash/cashout', async (req, res) => {
    try {
        const { uid } = req.body;
        const round = crashRounds[uid];
        
        if (!round || !round.active) return res.json({ err: "Раунд не найден или уже завершён" });
        
        round.active = false; // Блокируем двойной клик
        
        const elapsedMs = Date.now() - round.startTime;
        let currentMult = elapsedMs < 0 ? 1.00 : Math.pow(1.05, elapsedMs / 500);
        
        // Проверка: взорвалась ли ракета до нажатия?
        if (currentMult >= round.crashPoint) {
            return res.json({ crashed: true, crashPoint: round.crashPoint });
        }
        
        // Успешный вывод
        const winSum = Math.floor(round.bet * currentMult);
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
            
            .card { background: rgba(20,20,25,0.85); border: 1px solid rgba(0,240,255,0.3); padding: 20px; margin-bottom: 20px; border-radius: 16px; box-shadow: inset 0 0 20px rgba(0,240,255,0.1), 0 5px 15px rgba(0,0,0,0.6); backdrop-filter: blur(5px); }
            .bal-wrapper { display: flex; justify-content: flex-end; align-items: center; margin-bottom: 20px; }
            .bal-box { text-align: right; }
            .bal-val { font-size: 32px; color: var(--neon-cyan); font-weight: 900; text-shadow: 0 0 15px rgba(0,240,255,0.6); }
            
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

            .copy-box { background: rgba(0,0,0,0.8); border: 1px dashed var(--neon-cyan); padding: 15px; border-radius: 12px; font-family: monospace; color: var(--neon-cyan); word-break: break-all; margin: 15px 0; font-size: 16px; }
            .top-row { display: flex; justify-content: space-between; align-items: center; padding: 15px 10px; border-bottom: 1px solid rgba(255,255,255,0.05); }
            .top-rank { color: var(--gold); font-weight: 900; width: 30px; font-size: 18px; }
        </style>
    </head>
    <body>
        <video autoplay loop muted playsinline class="back-video"><source src="${CONFIG.BG_VIDEO}" type="video/mp4"></video>
        <audio id="bgm" loop src="${CONFIG.BGM_URL}"></audio>
        
        <div class="nav">
            <div class="tab active" onclick="sh(1)">🎰 Слоты</div>
            <div class="tab" onclick="sh(2)">🚀 Краш</div>
            <div class="tab" onclick="sh(3)">🏆 Топ</div>
            <div class="tab" onclick="sh(4)">💎 Банк</div>
            <div class="tab" onclick="sh(5)">⚙️ Настр.</div>
        </div>

        <!-- ВКЛАДКА 1: СЛОТЫ -->
        <div id="pg1" class="page active">
            <div class="bal-wrapper">
                <div class="bal-box"><div style="font-size:10px; color:#aaa;">БАЛАНС ХОТ ТАП</div><div class="bal-val" id="bal1">0 💎</div></div>
            </div>
            
            <div class="reel-cont">
                <div class="reel"><div class="strip" id="s1"></div></div>
                <div class="reel"><div class="strip" id="s2"></div></div>
                <div class="reel"><div class="strip" id="s3"></div></div>
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
            <div class="bal-wrapper">
                <div class="bal-box"><div style="font-size:10px; color:#aaa;">БАЛАНС ХОТ ТАП</div><div class="bal-val" id="bal2">0 💎</div></div>
            </div>
            
            <div class="crash-monitor">
                <div class="crash-x" id="cX">1.00x</div>
                <div class="crash-status" id="cMsg">Готов к запуску</div>
            </div>
            
            <div class="input-group">
                <div class="input-box" style="flex: 0.3;" onclick="chBet(-10, 'bet2')"><div style="text-align:center; font-size:24px; color:#aaa; margin-top:5px;">-</div></div>
                <div class="input-box"><span style="text-align:center;">Ставка (💎)</span><input type="number" id="bet2" value="10" step="10" style="text-align:center;" readonly></div>
                <div class="input-box" style="flex: 0.3;" onclick="chBet(10, 'bet2')"><div style="text-align:center; font-size:24px; color:#aaa; margin-top:5px;">+</div></div>
            </div>
            <button class="btn-main magenta" onclick="startCrash()" id="btnCrash">ЗАПУСК РАКЕТЫ 🚀</button>
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
                <p style="color:#666; font-size:11px; margin-top:20px;">Версия клиента: 2.3 (Manual Cashout)</p>
            </div>
        </div>

        <script>
            const tg = window.Telegram.WebApp;
            tg.expand();
            const uid = tg.initDataUnsafe?.user?.id || 123456789;
            let bal = 0, isGame = false;
            let crashAnimInterval;
            
            document.getElementById('memoText').innerText = uid;

            const syms = ['🍒','🔔','💎','7️⃣','🍋'];
            function initR() {
                let h = ''; for(let i=0; i<30; i++) h += '<div class="sym">'+syms[Math.floor(Math.random()*5)]+'</div>';
                ['s1','s2','s3'].forEach(id => document.getElementById(id).innerHTML = h);
            }
            initR();

            function sh(n) {
                document.querySelectorAll('.page, .tab').forEach(e => e.classList.remove('active'));
                document.getElementById('pg'+n).classList.add('active');
                document.querySelectorAll('.tab')[n-1].classList.add('active');
                if(n===3) loadTop();
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

            function updateBal(newBal) {
                bal = Math.floor(newBal);
                document.getElementById('bal1').innerText = bal + " 💎";
                document.getElementById('bal2').innerText = bal + " 💎";
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
                    h += '<div class="top-row"><div class="top-rank">'+rank+'</div><div style="flex:1; text-align:left; color:#ccc;">ID '+u.uid+'</div><div style="color:var(--neon-cyan); font-weight:900;">'+Math.floor(u.balance)+' 💎</div></div>';
                });
                document.getElementById('topList').innerHTML = h;
            }

            function draw(id, res) {
                const st = document.getElementById(id);
                st.style.transition = 'none'; st.style.transform = 'translateY(0)';
                setTimeout(() => {
                    st.innerHTML = '<div class="sym">'+res+'</div>' + st.innerHTML;
                    st.style.transition = 'transform 2s cubic-bezier(0.15, 1, 0.3, 1)';
                    st.style.transform = 'translateY(-'+(st.children.length-1)*120+'px)';
                }, 50);
            }

            // --- ИГРА: СЛОТЫ ---
            async function playSpin() {
                if(isGame) return;
                const bet = parseFloat(document.getElementById('bet1').value);
                if(bet > bal) return tg.showAlert("Мало 💎 ХОТ ТАП!");
                const a = document.getElementById('bgm'); if(a.paused && !a.muted) a.play().catch(e=>{});
                
                isGame = true; const btn = document.getElementById('btnSpin'); btn.disabled = true;
                
                try {
                    const r = await fetch('/api/spin', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, bet})});
                    const d = await r.json();
                    
                    if(d.err) { tg.showAlert(d.err); isGame=false; btn.disabled=false; return; }
                    updateBal(bal - bet); initR();
                    draw('s1', d.result[0]); setTimeout(()=>draw('s2', d.result[1]), 300); setTimeout(()=>draw('s3', d.result[2]), 600);
                    
                    setTimeout(() => {
                        updateBal(d.balance);
                        if(d.winSum > 0) { tg.showAlert("🎉 ВЫИГРЫШ: " + Math.floor(d.winSum) + " 💎"); if(window.navigator.vibrate) window.navigator.vibrate([100,50,100,50,100]); }
                        isGame = false; btn.disabled=false;
                    }, 2600);
                } catch(e) { isGame = false; btn.disabled=false; }
            }

            // --- ИГРА: КРАШ (РУЧНОЙ ВЫВОД) ---
            async function startCrash() {
                if(isGame) return;
                const bet = parseFloat(document.getElementById('bet2').value);
                if(bet > bal) return tg.showAlert("Мало 💎 ХОТ ТАП!");
                
                const a = document.getElementById('bgm'); if(a.paused && !a.muted) a.play().catch(e=>{});
                
                isGame = true; 
                const btn = document.getElementById('btnCrash'); 
                btn.disabled = true;
                btn.innerText = "РАЗГОН...";
                
                const cx = document.getElementById('cX'); const cm = document.getElementById('cMsg');
                cx.style.color = "#fff"; cx.innerText = "1.00x"; cm.innerText = "ПОДГОТОВКА...";
                
                try {
                    const r = await fetch('/api/crash/start', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, bet})});
                    const d = await r.json();
                    
                    if(d.err) { tg.showAlert(d.err); resetCrashBtn(); return; }
                    
                    updateBal(d.balance);
                    const startTime = Date.now();
                    cm.innerText = "РАКЕТА ЛЕТИТ...";
                    
                    // Меняем кнопку на ЗАБРАТЬ КУШ
                    btn.disabled = false;
                    btn.innerText = "💰 ЗАБРАТЬ КУШ";
                    btn.onclick = cashoutCrash;
                    btn.style.background = "linear-gradient(90deg, #00ff00, #009900)";
                    btn.style.boxShadow = "0 0 20px rgba(0,255,0,0.5)";
                    
                    crashAnimInterval = setInterval(() => {
                        const elapsed = Date.now() - startTime;
                        let curr = Math.pow(1.05, elapsed / 500);
                        
                        cx.innerText = curr.toFixed(2) + "x";
                    }, 40);
                } catch(e) { resetCrashBtn(); }
            }

            async function cashoutCrash() {
                const btn = document.getElementById('btnCrash');
                btn.disabled = true;
                btn.innerText = "ОБРАБОТКА...";
                
                try {
                    const r = await fetch('/api/crash/cashout', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid})});
                    const d = await r.json();
                    
                    clearInterval(crashAnimInterval);
                    const cx = document.getElementById('cX'); const cm = document.getElementById('cMsg');
                    
                    if(d.crashed) {
                        crashBoom(d.crashPoint);
                    } else if(d.success) {
                        cx.innerText = d.multiplier + "x"; cx.style.color = "#00ff00";
                        cm.innerText = "✅ ЗАБРАЛ +" + Math.floor(d.winSum) + " 💎";
                        if(window.navigator.vibrate) window.navigator.vibrate([100,50,100]);
                        updateBal(d.balance);
                        resetCrashBtn();
                    } else {
                        tg.showAlert(d.err);
                        resetCrashBtn();
                    }
                } catch(e) { resetCrashBtn(); }
            }

            function crashBoom(point) {
                const cx = document.getElementById('cX'); const cm = document.getElementById('cMsg');
                cx.innerText = point.toFixed(2) + "x"; cx.style.color = "#ff0000";
                cm.innerText = "💥 РАКЕТА ВЗОРВАЛАСЬ!";
                if(window.navigator.vibrate) window.navigator.vibrate([500]);
                resetCrashBtn();
                upd(); // Синхронизируем баланс на всякий случай
            }

            function resetCrashBtn() {
                isGame = false;
                const btn = document.getElementById('btnCrash');
                btn.disabled = false;
                btn.innerText = "ЗАПУСК РАКЕТЫ 🚀";
                btn.onclick = startCrash;
                btn.style.background = ""; // Возвращаем родной градиент
                btn.style.boxShadow = "";
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
