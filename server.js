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

console.log("🛠 Запуск сервера VIP TON IMPERIAL...");

if (!process.env.BOT_TOKEN || !process.env.MONGO_URI) {
    console.error("❌ ОШИБКА: Заполни BOT_TOKEN и MONGO_URI!");
    process.exit(1);
}

const app = express();

// ==========================================
// ⚙️ НАСТРОЙКИ КАЗИНО
// ==========================================
const CONFIG = {
    ADMIN_ID: 8475323865, 
    WALLET: "UQDoTj0hCwJbI-9fziRCyUZzO2XHmtcDzuiAiGjxG21G3dIX", 
    TON_KEY: "fe9429836fd2dfdb009421c6dc389840c9cdadca238477b4e2910250e11fa6d3", 
    START_BALANCE: 0.10, 
    BG_VIDEO: "https://raw.githubusercontent.com/venom142/ton-casino-bot/main/gemini_generated_video_9fc75b5d.mp4", 
    BGM_URL: "https://files.catbox.moe/ef3c37.mp3"
};

let SETTINGS = { winChance: 0.15, multiplier: 10, minBet: 0.01 };

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
    used_promos: [String] 
});

const Promo = mongoose.model('Promo', {
    code: String, value: Number, limit: Number, usedCount: { type: Number, default: 0 }
});

// ==========================================
// 🤖 ТЕЛЕГРАМ БОТ (НОВАЯ АДМИНКА)
// ==========================================
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const adminState = {};

bot.onText(/\/start/, async (msg) => {
    const uid = msg.from.id.toString();
    await User.findOneAndUpdate({ uid }, { uid }, { upsert: true, setDefaultsOnInsert: true });
    
    let kb = [[{ text: "🎰 ВОЙТИ В VIP ЗАЛ", web_app: { url: process.env.APP_URL || "https://google.com" } }]];
    if (msg.from.id === CONFIG.ADMIN_ID) kb.push([{ text: "👑 ПАНЕЛЬ ВЛАДЕЛЬЦА", callback_data: "admin_menu" }]);
    
    bot.sendMessage(msg.chat.id, `💎 **VIP TON ХОТ ТАП**\nБонус за старт: **${CONFIG.START_BALANCE} TON**\nТвой ID: \`${uid}\``, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
});

bot.on('callback_query', async (q) => {
    if (q.from.id !== CONFIG.ADMIN_ID) return;
    
    if (q.data === "admin_menu") {
        bot.sendMessage(q.message.chat.id, `👑 **Админка**\n\n⚙️ Текущий шанс: **${Math.round(SETTINGS.winChance * 100)}%**\n✖️ Текущий икс: **x${SETTINGS.multiplier}**`, {
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
    if (q.data === "adm_set_chance") { adminState[q.from.id] = 'set_chance'; bot.sendMessage(q.message.chat.id, "Введите шанс от 0.01 до 1.00\n*(Например, 0.30 — это 30% на победу)*:"); }
    if (q.data === "adm_set_mult") { adminState[q.from.id] = 'set_mult'; bot.sendMessage(q.message.chat.id, "Введите множитель выигрыша\n*(Например, 5, 10 или 2.5)*:"); }
    
    if (q.data === "adm_wipe_all") {
        bot.sendMessage(q.message.chat.id, "⚠️ **ВНИМАНИЕ!** Это сбросит балансы, спины и победы **ВСЕМ ИГРОКАМ**! Уверены?", {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{text: "✅ ДА, СНЕСТИ", callback_data: "adm_wipe_confirm"}, {text: "❌ ОТМЕНА", callback_data: "admin_menu"}]] }
        });
    }
    if (q.data === "adm_wipe_confirm") {
        await User.updateMany({}, { balance: CONFIG.START_BALANCE, spins: 0, wins: 0, used_promos: [] });
        bot.sendMessage(q.message.chat.id, "✅ **БАЗА ДАННЫХ ОБНУЛЕНА!**", { parse_mode: 'Markdown' });
    }

    if (q.data === "adm_msg") { adminState[q.from.id] = 'msg'; bot.sendMessage(q.message.chat.id, "Текст рассылки:"); }
    if (q.data === "adm_bal") { adminState[q.from.id] = 'bal_id'; bot.sendMessage(q.message.chat.id, "ID игрока:"); }
    if (q.data === "adm_promo_add") { adminState[q.from.id] = 'p_code'; bot.sendMessage(q.message.chat.id, "Название промокода:"); }
    if (q.data === "adm_promo_del") { adminState[q.from.id] = 'p_del'; bot.sendMessage(q.message.chat.id, "Название для удаления:"); }
});

bot.on('message', async (msg) => {
    const s = adminState[msg.from.id]; if (!s || msg.text?.startsWith('/')) return;
    
    try {
        if (s === 'set_chance') {
            const val = parseFloat(msg.text);
            if (!isNaN(val) && val > 0 && val <= 1) { SETTINGS.winChance = val; bot.sendMessage(msg.chat.id, `✅ Шанс победы теперь: **${Math.round(val * 100)}%**`, { parse_mode: 'Markdown' }); }
            else bot.sendMessage(msg.chat.id, "❌ Ошибка! Нужно число от 0.01 до 1.00");
            delete adminState[msg.from.id];
        }
        else if (s === 'set_mult') {
            const val = parseFloat(msg.text);
            if (!isNaN(val) && val >= 1) { SETTINGS.multiplier = val; bot.sendMessage(msg.chat.id, `✅ Множитель теперь: **x${val}**`, { parse_mode: 'Markdown' }); }
            else bot.sendMessage(msg.chat.id, "❌ Ошибка! Нужно число больше 1");
            delete adminState[msg.from.id];
        }
        else if (s === 'msg') {
            const users = await User.find(); bot.sendMessage(msg.chat.id, "⏳ Начинаю рассылку...");
            for (let u of users) { try { await bot.sendMessage(u.uid, msg.text); } catch(e) {} }
            bot.sendMessage(msg.chat.id, "✅ Рассылка готова!"); delete adminState[msg.from.id];
        } 
        else if (s === 'bal_id') { adminState[msg.from.id] = `bal_v_${msg.text}`; bot.sendMessage(msg.chat.id, "Сумма:"); }
        else if (s.startsWith('bal_v_')) {
            const uid = s.split('_')[2]; const user = await User.findOne({ uid });
            if (user) { user.balance += parseFloat(msg.text); await user.save(); bot.sendMessage(msg.chat.id, `✅ Выдано!`); bot.sendMessage(uid, `🎁 Начислен бонус: +${msg.text} TON`).catch(()=>{}); }
            else bot.sendMessage(msg.chat.id, "❌ Юзер не найден!");
            delete adminState[msg.from.id];
        }
        else if (s === 'p_code') {
            const code = msg.text.trim().toUpperCase(); adminState[msg.from.id] = `p_val_${code}`;
            bot.sendMessage(msg.chat.id, `Сумма для промокода **${code}**:`, {parse_mode:'Markdown'});
        }
        else if (s.startsWith('p_val_')) {
            const code = s.split('_')[2], val = parseFloat(msg.text); adminState[msg.from.id] = `p_lim_${code}_${val}`;
            bot.sendMessage(msg.chat.id, `Лимит активаций для **${code}** (человек):`, {parse_mode:'Markdown'});
        }
        else if (s.startsWith('p_lim_')) {
            const [, , code, valStr] = s.split('_'), val = parseFloat(valStr), lim = parseInt(msg.text);
            await Promo.findOneAndUpdate({ code }, { code, value: val, limit: lim, usedCount: 0 }, { upsert: true });
            bot.sendMessage(msg.chat.id, `✅ **Промокод создан!**\nКод: \`${code}\` | Сумма: ${val} TON | Лимит: ${lim}`, {parse_mode:'Markdown'});
            delete adminState[msg.from.id];
        }
        else if (s === 'p_del') {
            await Promo.deleteOne({ code: msg.text.trim().toUpperCase() });
            bot.sendMessage(msg.chat.id, "🗑 Удалено."); delete adminState[msg.from.id];
        }
    } catch (e) { console.error("Ошибка в админке:", e); }
});

// ==========================================
// 💸 СКАНЕР ДОНАТОВ
// ==========================================
setInterval(async () => {
    try {
        const res = await axios.get(`https://toncenter.com/api/v2/getTransactions?address=${CONFIG.WALLET}&limit=10&api_key=${CONFIG.TON_KEY}`);
        if (!res.data?.ok) return;
        for (let tx of res.data.result) {
            const comment = tx.in_msg?.message?.trim(), lt = tx.transaction_id.lt, val = parseInt(tx.in_msg?.value || 0) / 1e9;
            if (!comment || isNaN(comment) || val <= 0) continue;
            const user = await User.findOne({ uid: comment });
            if (user && BigInt(lt) > BigInt(user.last_lt || "0")) { 
                user.balance = parseFloat((user.balance + val).toFixed(2)); user.last_lt = lt.toString(); await user.save();
                bot.sendMessage(user.uid, `💎 **ДЕПОЗИТ ЗАЧИСЛЕН!**\n+${val} TON`).catch(()=>{});
            }
        }
    } catch (err) {}
}, 15000);

// ==========================================
// 🌐 API ИГРЫ
// ==========================================
app.use(express.json());
// --- УМНЫЕ УВЕДОМЛЕНИЯ ---
app.use('/api', async (req, res, next) => {
    if (req.body && req.body.uid) await User.updateOne({uid: req.body.uid.toString()}, {last_active: Date.now(), notified_inactive: false}, {strict: false});
    next();
});
setInterval(async () => {
    try {
        const timeLimit = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48 часов
        const users = await User.find({ last_active: { $lt: timeLimit }, notified_inactive: false });
        for (let u of users) {
            bot.sendMessage(u.uid, "💎 Бро, твой баланс скучает!\nЗалетай в VIP ЗАЛ и сделай свой победный спин! 🎰", { 
                reply_markup: { inline_keyboard: [[{ text: "🚀 ВЕРНУТЬСЯ В ИГРУ", web_app: { url: process.env.APP_URL || "https://google.com" } }]] }
            }).catch(()=>{});
            await User.updateOne({uid: u.uid}, {notified_inactive: true}, {strict: false});
        }
    } catch(e) {}
}, 60 * 60 * 1000); // Проверка каждый час
// -------------------------
            
app.post('/api/sync', async (req, res) => {
    try {
        const user = await User.findOne({ uid: req.body.uid?.toString() });
        res.json(user || { balance: 0, spins: 0, wins: 0 });
    } catch (e) { res.json({ balance: 0 }); }
});

app.post('/api/leaderboard', async (req, res) => {
    try {
        const tops = await User.find().sort({ balance: -1 }).limit(10);
        res.json(tops.map(u => ({ uid: u.uid.substring(0, 3) + "***" + u.uid.substring(u.uid.length - 2), balance: u.balance })));
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
        res.json({ msg: `🎁 Начислено +${pr.value} TON.` });
    } catch (e) { res.json({ err: "Ошибка сервера" }); }
});

app.post('/api/spin', async (req, res) => {
    try {
        const { uid, bet } = req.body; const user = await User.findOne({ uid: uid.toString() });
        if (!user || user.balance < bet || bet < SETTINGS.minBet) return res.json({ err: "Мало TON!" });
        user.balance -= bet;
        const items = ['🍒','🔔','💎','7️⃣','🍋'];
        let result = [items[Math.floor(Math.random()*5)], items[Math.floor(Math.random()*5)], items[Math.floor(Math.random()*5)]];
        if (Math.random() < SETTINGS.winChance) result = ['7️⃣','7️⃣','7️⃣'];
        const isWin = result[0] === result[1] && result[1] === result[2], winSum = isWin ? bet * SETTINGS.multiplier : 0;
        user.balance += winSum; user.spins++; if(isWin) user.wins++; await user.save();
        res.json({ result, winSum, balance: parseFloat(user.balance.toFixed(2)) });
    } catch (e) { res.json({ err: "Ошибка спина" }); }
});

app.post('/api/withdraw', async (req, res) => {
    try {
        const { uid, amount, address } = req.body; const user = await User.findOne({ uid: uid.toString() });
        if (!user || user.balance < amount || amount < 0.1) return res.json({ err: "Мин. вывод 0.1 TON" });
        user.balance -= amount; await user.save();
        bot.sendMessage(CONFIG.ADMIN_ID, `🚨 **ВЫВОД**\nЮзер: \`${uid}\`\nСумма: **${amount} TON**\nКошель: \`${address}\``, { parse_mode: 'Markdown' });
        res.json({ msg: "Заявка принята!" });
    } catch (e) { res.json({ err: "Ошибка" }); }
});
// ==========================================
// 🎨 ФРОНТЕНД (СЛОТЫ + КРАШ)
// ==========================================
app.get('/', (req, res) => {
    const html = `<!DOCTYPE html>
    <html lang="ru">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>TON Casino</title>
        <script src="https://telegram.org/js/telegram-web-app.js"></script>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@800&display=swap');
            body { margin: 0; padding: 0; background-color: #000; color: #fff; font-family: 'Montserrat', sans-serif; overflow: hidden; }
            .back-video { position: fixed; top: 50%; left: 50%; min-width: 100%; min-height: 100%; z-index: -2; transform: translate(-50%, -50%); object-fit: cover; }
            .overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.6); z-index: -1; }
            .container { display: flex; flex-direction: column; align-items: center; padding: 20px; height: 100vh; box-sizing: border-box; }
            
            .header { width: 100%; display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
            .balance-box { background: rgba(255, 255, 255, 0.1); padding: 10px 20px; border-radius: 15px; border: 1px solid #00f0ff; box-shadow: 0 0 10px #00f0ff; }
            .balance-val { font-size: 24px; color: #00f0ff; text-shadow: 0 0 5px #00f0ff; }
            
            .tabs { display: flex; gap: 10px; margin-bottom: 20px; }
            .tab-btn { background: rgba(0,0,0,0.5); border: 2px solid #ff00ff; color: #fff; padding: 10px 20px; border-radius: 10px; font-weight: bold; width: 120px; transition: 0.2s; }
            .tab-btn.active { background: #ff00ff; box-shadow: 0 0 15px #ff00ff; }

            .game-screen { display: none; flex-direction: column; align-items: center; width: 100%; }
            .game-screen.active { display: flex; }

            /* Слоты */
            .slots-box { display: flex; gap: 10px; margin: 20px 0; background: rgba(0,0,0,0.8); padding: 20px; border-radius: 20px; border: 2px solid #00f0ff; box-shadow: inset 0 0 20px #00f0ff; }
            .slot { font-size: 50px; width: 60px; text-align: center; }
            
            /* Краш */
            .crash-box { width: 100%; height: 150px; background: rgba(0,0,0,0.8); border: 2px solid #ff00ff; border-radius: 20px; margin: 20px 0; display: flex; justify-content: center; align-items: center; flex-direction: column; box-shadow: inset 0 0 20px #ff00ff; }
            .crash-mult { font-size: 48px; color: #fff; text-shadow: 0 0 10px #fff; }
            .crash-msg { font-size: 16px; color: #aaa; margin-top: 10px; }
            .crash-inputs { display: flex; gap: 10px; width: 100%; margin-bottom: 15px; }

            .input-box { width: 100%; max-width: 300px; display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.5); padding: 15px; border-radius: 15px; border: 1px solid #fff; margin-bottom: 15px; box-sizing: border-box; }
            .input-box input { background: transparent; border: none; color: #fff; font-size: 20px; width: 80px; text-align: right; outline: none; font-weight: bold; }
            
            .btn-spin { background: linear-gradient(45deg, #00f0ff, #ff00ff); border: none; padding: 15px 40px; font-size: 24px; font-weight: bold; color: #fff; border-radius: 20px; box-shadow: 0 0 20px rgba(0,240,255,0.5); text-transform: uppercase; margin-bottom: 20px; width: 100%; max-width: 300px; }
            .btn-spin:active { transform: scale(0.95); }
            .btn-crash { background: linear-gradient(45deg, #ff00ff, #ff8c00); box-shadow: 0 0 20px rgba(255,140,0,0.5); }

            .nav-buttons { display: flex; gap: 10px; width: 100%; justify-content: center; margin-top: auto; padding-bottom: 20px; }
            .nav-btn { background: rgba(255,255,255,0.1); border: 1px solid #fff; color: #fff; padding: 10px; border-radius: 10px; width: 100%; font-size: 14px; }
        </style>
    </head>
    <body>
        <video class="back-video" autoplay loop muted playsinline>
            <source src="https://raw.githubusercontent.com/venom142/ton-casino-bot/main/gemini_generated_video_9fc75b5d.mp4" type="video/mp4">
        </video>
        <div class="overlay"></div>
        
        <div class="container">
            <div class="header">
                <div>User: <span id="uid" style="color:#ff00ff;">...</span></div>
                <div class="balance-box"><span class="balance-val" id="balance">0.00</span> TON</div>
            </div>

            <div class="tabs">
                <button class="tab-btn active" onclick="switchTab('slots', this)">🎰 Слоты</button>
                <button class="tab-btn" onclick="switchTab('crash', this)">🚀 Краш</button>
            </div>

            <div id="screen-slots" class="game-screen active">
                <div class="slots-box">
                    <div class="slot" id="s1">❓</div>
                    <div class="slot" id="s2">❓</div>
                    <div class="slot" id="s3">❓</div>
                </div>
                <div class="input-box">
                    <span>Ставка (TON):</span>
                    <input type="number" id="bet" value="0.1" step="0.1">
                </div>
                <button class="btn-spin" id="spinBtn" onclick="spin()">КРУТИТЬ</button>
            </div>

            <div id="screen-crash" class="game-screen">
                <div class="crash-box">
                    <div class="crash-mult" id="crashCounter">x1.00</div>
                    <div class="crash-msg" id="crashMsg">Ждет запуска...</div>
                </div>
                <div class="crash-inputs">
                    <div class="input-box" style="flex-direction: column; align-items: flex-start; padding: 10px;">
                        <span style="font-size:12px; color:#aaa;">Ставка:</span>
                        <input type="number" id="crashBet" value="0.1" step="0.1" style="width:100%; text-align:left;">
                    </div>
                    <div class="input-box" style="flex-direction: column; align-items: flex-start; padding: 10px;">
                        <span style="font-size:12px; color:#aaa;">Икс:</span>
                        <input type="number" id="crashTarget" value="2.0" step="0.1" style="width:100%; text-align:left;">
                    </div>
                </div>
                <button class="btn-spin btn-crash" id="crashBtn" onclick="playCrash()">ЗАПУСК 🚀</button>
            </div>

            <div class="nav-buttons">
                <button class="nav-btn" onclick="showPromo()">🎁 Промо</button>
                <button class="nav-btn" onclick="showLeaderboard()">🏆 Топ</button>
                <button class="nav-btn" onclick="withdraw()">💸 Вывод</button>
            </div>
        </div>

        <script>
            const tg = window.Telegram.WebApp;
            tg.expand();
            const uid = tg.initDataUnsafe?.user?.id || "123456789";
            document.getElementById('uid').innerText = uid.toString().slice(-4);
            let currentBalance = 0;

            function switchTab(tab, btn) {
                document.getElementById('screen-slots').classList.remove('active');
                document.getElementById('screen-crash').classList.remove('active');
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                
                document.getElementById('screen-' + tab).classList.add('active');
                btn.classList.add('active');
            }

            async function updateData() {
                try {
                    const res = await fetch('/api/sync', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({uid}) });
                    const data = await res.json();
                    currentBalance = data.balance;
                    document.getElementById('balance').innerText = currentBalance.toFixed(2);
                } catch(e) {}
            }

            async function spin() {
                const bet = parseFloat(document.getElementById('bet').value);
                if(bet > currentBalance) return tg.showAlert("Недостаточно средств!");
                const btn = document.getElementById('spinBtn');
                btn.disabled = true; btn.innerText = "КРУТИМ...";
                
                let ticks = 0;
                const items = ['🍒','🔔','💎','7️⃣','🍋'];
                const anim = setInterval(() => {
                    document.getElementById('s1').innerText = items[Math.floor(Math.random()*5)];
                    document.getElementById('s2').innerText = items[Math.floor(Math.random()*5)];
                    document.getElementById('s3').innerText = items[Math.floor(Math.random()*5)];
                    ticks++;
                }, 100);

                try {
                    const res = await fetch('/api/spin', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({uid, bet}) });
                    const data = await res.json();
                    
                    setTimeout(() => {
                        clearInterval(anim);
                        if(data.err) { tg.showAlert(data.err); }
                        else {
                            document.getElementById('s1').innerText = data.result[0];
                            document.getElementById('s2').innerText = data.result[1];
                            document.getElementById('s3').innerText = data.result[2];
                            document.getElementById('balance').innerText = data.balance.toFixed(2);
                            currentBalance = data.balance;
                            if(data.winSum > 0) tg.showAlert("🎉 ВЫИГРЫШ: " + data.winSum + " TON");
                        }
                        btn.disabled = false; btn.innerText = "КРУТИТЬ";
                    }, 1000);
                } catch(e) { clearInterval(anim); btn.disabled = false; btn.innerText = "КРУТИТЬ"; }
            }

            async function playCrash() {
                const bet = parseFloat(document.getElementById('crashBet').value);
                const target = parseFloat(document.getElementById('crashTarget').value);
                if(bet > currentBalance) return tg.showAlert("Недостаточно средств!");
                if(target < 1.01) return tg.showAlert("Икс должен быть больше 1.01");
                
                const btn = document.getElementById('crashBtn');
                const counter = document.getElementById('crashCounter');
                const msg = document.getElementById('crashMsg');
                
                btn.disabled = true;
                msg.innerText = "Ракета летит...";
                msg.style.color = "#fff";
                counter.style.color = "#fff";
                
                try {
                    const res = await fetch('/api/crash', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({uid, bet, target}) });
                    const data = await res.json();
                    
                    if(data.err) { tg.showAlert(data.err); btn.disabled = false; return; }
                    
                    currentBalance -= bet;
                    document.getElementById('balance').innerText = currentBalance.toFixed(2);

                    let currentX = 1.00;
                    const interval = setInterval(() => {
                        currentX += 0.01 + (currentX * 0.015);
                        
                        if (currentX >= Math.min(data.crashPoint, target)) {
                            clearInterval(interval);
                            
                            if (data.isWin) {
                                counter.innerText = "x" + target.toFixed(2);
                                counter.style.color = "#00ff00";
                                msg.innerText = "✅ ВЫВЕЛ! +" + data.winSum.toFixed(2) + " TON";
                                msg.style.color = "#00ff00";
                            } else {
                                counter.innerText = "x" + data.crashPoint.toFixed(2);
                                counter.style.color = "#ff0000";
                                msg.innerText = "💥 ВЗРЫВ!";
                                msg.style.color = "#ff0000";
                            }
                            
                            currentBalance = data.balance;
                            document.getElementById('balance').innerText = currentBalance.toFixed(2);
                            btn.disabled = false;
                        } else {
                            counter.innerText = "x" + currentX.toFixed(2);
                        }
                    }, 50);

                } catch(e) { btn.disabled = false; }
            }

            function showPromo() {
                const p = prompt("Введите промо:");
                if(p) fetch('/api/promo', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({uid, promo: p}) }).then(r=>r.json()).then(d => { tg.showAlert(d.msg || d.err); updateData(); });
            }
            function showLeaderboard() {
                fetch('/api/leaderboard', {method:'POST'}).then(r=>r.json()).then(d=>{
                    let t = "🏆 ТОП ИГРОКОВ 🏆\\n\\n";
                    d.forEach((u,i) => t += (i+1) + ". ID " + u.uid + " - " + u.balance.toFixed(2) + " TON\\n");
                    tg.showAlert(t);
                });
            }
            function withdraw() {
                const a = prompt("Адрес TON:");
                if(!a) return;
                const am = prompt("Сумма:");
                if(am) fetch('/api/withdraw', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({uid, amount: parseFloat(am), address: a}) }).then(r=>r.json()).then(d => { tg.showAlert(d.msg || d.err); updateData(); });
            }
            
            setInterval(updateData, 10000);
            updateData();
        </script>
    </body>
    </html>`;
    res.send(html);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Сервер запущен на порту ' + PORT));
