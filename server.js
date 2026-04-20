/**
 * 💎 ULTIMATE TON CASINO ECOSYSTEM 2026
 * 🚀 ВЕРСИЯ: 4.0 (MEGA MONOLITH)
 * 🛠 СТЕК: Node.js, Telegraf, Express, MongoDB, CSS3 Next-Gen
 */

require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const crypto = require('crypto');

// ==========================================
// ⚙️ СИСТЕМНАЯ КОНФИГУРАЦИЯ
// ==========================================
const { 
    BOT_TOKEN, 
    MONGO_URI, 
    TONCENTER_KEY, 
    PORT = 3000,
    WEB_URL = 'https://ton-casino-bot.onrender.com'
} = process.env;

const ADMIN_ID = 5664124314; 
const TON_WALLET = 'UQDoTj0hCwJbI-9fziRCyUZzO2XHmtcDzuiAiGjxG21G3dIX';

// ==========================================
// 🗄 МОДЕЛИ ДАННЫХ (DATABASE STRUCTURE)
// ==========================================
const UserSchema = new mongoose.Schema({
    tgId: { type: Number, unique: true, required: true },
    username: String,
    name: String,
    balance: { type: Number, default: 0 },
    totalTaps: { type: Number, default: 0 },
    referrals: { type: Number, default: 0 },
    lvl: { type: Number, default: 1 },
    isBanned: { type: Boolean, default: false },
    regDate: { type: Date, default: Date.now }
});

const TxSchema = new mongoose.Schema({
    hash: { type: String, unique: true },
    amount: Number,
    userId: Number,
    status: { type: String, default: 'completed' },
    timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Transaction = mongoose.model('Transaction', TxSchema);

// ==========================================
// 🛰 ИНИЦИАЛИЗАЦИЯ СЕРВИСОВ
// ==========================================
const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

mongoose.connect(MONGO_URI)
    .then(() => console.log('🟢 [DATABASE] Связь с облаком установлена'))
    .catch(e => console.error('🔴 [DATABASE] Критическая ошибка:', e));

// ==========================================
// 💳 СИСТЕМА ПРОВЕРКИ ПЛАТЕЖЕЙ (TONCENTER API)
// ==========================================
async function checkPayments() {
    try {
        const response = await axios.get(`https://toncenter.com/api/v2/getTransactions?address=${TON_WALLET}&limit=20&api_key=${TONCENTER_KEY}`);
        const data = response.data.result;

        for (const tx of data) {
            const hash = tx.transaction_id.hash;
            const amount = Number(tx.in_msg.value) / 1e9;
            const comment = tx.in_msg.message; // ID пользователя в комментарии

            if (amount > 0 && comment) {
                const uid = parseInt(comment.trim());
                if (!isNaN(uid)) {
                    const exists = await Transaction.findOne({ hash });
                    if (!exists) {
                        const user = await User.findOne({ tgId: uid });
                        if (user) {
                            user.balance += amount;
                            await user.save();
                            await Transaction.create({ hash, amount, userId: uid });
                            bot.telegram.sendMessage(uid, `✅ **УСПЕХ!**\nВаш баланс пополнен на **${amount.toFixed(2)} TON**`).catch(() => {});
                        }
                    }
                }
            }
        }
    } catch (e) { /* Игнорируем ошибки сети */ }
}
setInterval(checkPayments, 40000);

// ==========================================
// 🤖 ТЕЛЕГРАМ БОТ (ADVANCED LOGIC)
// ==========================================
const buildKeyboard = (uid) => {
    let kb = [
        [Markup.button.webApp('🚀 ЗАПУСТИТЬ ИГРУ', WEB_URL)],
        [Markup.button.callback('💳 ДОНАТ', 'btn_don'), Markup.button.callback('⚙️ ПРОФИЛЬ', 'btn_prof')],
        [Markup.button.callback('🏆 ТОП ИГРОКОВ', 'btn_top')]
    ];
    if (uid === ADMIN_ID) kb.push([Markup.button.webApp('👑 ПАНЕЛЬ УПРАВЛЕНИЯ', `${WEB_URL}/admin`)]);
    return Markup.inlineKeyboard(kb);
};

bot.start(async (ctx) => {
    const u = await User.findOneAndUpdate(
        { tgId: ctx.from.id },
        { name: ctx.from.first_name, username: ctx.from.username },
        { upsert: true, new: true }
    );
    ctx.replyWithMarkdown(`💎 **TON CASINO ULTIMATE**\n\n💰 Твой баланс: \`${u.balance.toFixed(2)} TON\`\n\n*Добро пожаловать в элиту TON-гейминга!*`, buildKeyboard(ctx.from.id));
});

bot.action('btn_prof', async (ctx) => {
    const u = await User.findOne({ tgId: ctx.from.id });
    ctx.editMessageText(`👤 **ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ**\n\n🆔 ID: \`${u.tgId}\`\n📈 Уровень: ${u.lvl}\n🖱 Кликов: ${u.totalTaps}\n💰 Баланс: ${u.balance.toFixed(2)} TON`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔙 НАЗАД', 'btn_main')]])
    });
});

bot.action('btn_don', (ctx) => {
    ctx.replyWithMarkdown(`💳 **ПОПОЛНЕНИЕ СРЕДСТВ**\n\n1️⃣ Отправьте TON на кошелек:\n\`${TON_WALLET}\`\n\n2️⃣ В комментарии укажите свой ID:\n\`${ctx.from.id}\`\n\n*Средства зачисляются автоматически в течение 5 минут.*`);
});

bot.action('btn_main', async (ctx) => {
    const u = await User.findOne({ tgId: ctx.from.id });
    ctx.editMessageText(`💎 **TON CASINO ULTIMATE**\n\n💰 Твой баланс: \`${u.balance.toFixed(2)} TON\``, { parse_mode: 'Markdown', ...buildKeyboard(ctx.from.id) });
});

bot.launch();

// ==========================================
// 🌐 WEB APPLICATION (NEXT-GEN INTERFACE)
// ==========================================
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>TON CASINO WEB</title>
        <script src="https://telegram.org/js/telegram-web-app.js"></script>
        <style>
            :root { --main: #00f2ff; --bg: #030303; --accent: #0066ff; }
            * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
            body { background: var(--bg); color: #fff; font-family: 'Inter', system-ui, sans-serif; margin: 0; height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: space-between; overflow: hidden; }
            
            .header { padding: 40px 20px; text-align: center; width: 100%; background: linear-gradient(to bottom, rgba(0,242,255,0.1) 0%, transparent 100%); }
            .balance-container { position: relative; display: inline-block; }
            .balance-amount { font-size: 68px; font-weight: 900; color: var(--main); text-shadow: 0 0 40px rgba(0,242,255,0.5); font-variant-numeric: tabular-nums; }
            .ton-symbol { font-size: 24px; color: #fff; opacity: 0.5; margin-left: 10px; }

            .tap-section { position: relative; flex-grow: 1; display: flex; align-items: center; justify-content: center; width: 100%; }
            .main-button { 
                width: 300px; height: 300px; border-radius: 50%; border: none;
                background: radial-gradient(circle, #0088cc 0%, #001a33 100%);
                box-shadow: 0 0 50px rgba(0,102,255,0.3), inset 0 0 20px rgba(255,255,255,0.1);
                position: relative; z-index: 10; cursor: pointer; transition: transform 0.05s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                display: flex; align-items: center; justify-content: center;
            }
            .main-button::after { content: ''; position: absolute; width: 110%; height: 110%; border: 2px solid var(--main); border-radius: 50%; opacity: 0.3; animation: orbit 10s linear infinite; }
            .main-button:active { transform: scale(0.94); }
            .logo-img { width: 140px; filter: drop-shadow(0 0 20px var(--main)); }

            .particle { position: absolute; color: var(--main); font-weight: 900; font-size: 28px; pointer-events: none; animation: floatUp 0.8s ease-out forwards; z-index: 100; text-shadow: 0 0 10px rgba(0,0,0,0.5); }
            @keyframes floatUp { 0% { transform: translateY(0) scale(1) rotate(0); opacity: 1; } 100% { transform: translateY(-200px) scale(1.5) rotate(20deg); opacity: 0; } }
            @keyframes orbit { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

            .footer { padding: 30px; font-size: 10px; color: rgba(255,255,255,0.2); letter-spacing: 4px; text-transform: uppercase; }
        </style>
    </head>
    <body>
        <div class="header">
            <div style="font-size: 12px; opacity: 0.4; letter-spacing: 5px; margin-bottom: 5px;">CURRENT ASSETS</div>
            <div class="balance-container">
                <span class="balance-amount" id="score">0.00</span><span class="ton-symbol">TON</span>
            </div>
        </div>

        <div class="tap-section">
            <button class="main-button" id="tapBtn">
                <img src="https://ton.org/download/ton_symbol.png" class="logo-img">
            </button>
        </div>

        <div class="footer">Secured by TON Blockchain</div>

        <audio id="bgMusic" src="https://files.catbox.moe/78surr.mp3" loop preload="auto"></audio>

        <script>
            const tg = window.Telegram.WebApp;
            const scoreEl = document.getElementById('score');
            const btn = document.getElementById('tapBtn');
            const music = document.getElementById('bgMusic');
            let balance = 0;

            tg.expand();
            tg.enableClosingConfirmation();
            tg.headerColor = '#030303';

            btn.addEventListener('pointerdown', (e) => {
                if (music.paused) music.play().catch(() => {});
                
                balance += 0.01;
                scoreEl.innerText = balance.toFixed(2);
                
                tg.HapticFeedback.impactOccurred('medium');

                // Продвинутые частицы
                const p = document.createElement('div');
                p.className = 'particle';
                p.innerText = '+0.01';
                p.style.left = e.pageX + 'px';
                p.style.top = e.pageY + 'px';
                document.body.appendChild(p);
                
                setTimeout(() => p.remove(), 800);
            });
        </script>
    </body>
    </html>
    `);
});

// ==========================================
// 👑 MEGA ADMIN PANEL (FULL CRM INTERFACE)
// ==========================================
app.get('/admin', async (req, res) => {
    const users = await User.find().sort({ balance: -1 });
    const stats = {
        totalUsers: users.length,
        totalBalance: users.reduce((a, b) => a + b.balance, 0).toFixed(2),
        totalTaps: users.reduce((a, b) => a + b.totalTaps, 0)
    };

    res.send(`
    <!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>TON ADMIN PRO</title>
    <style>
        body { background: #0a0e14; color: #d1d5db; font-family: 'Segoe UI', sans-serif; margin: 0; padding: 40px; }
        .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 40px; }
        .stat-card { background: #161b22; padding: 25px; border-radius: 12px; border: 1px solid #30363d; }
        .stat-card h2 { margin: 0; color: #58a6ff; font-size: 32px; }
        
        .user-table { width: 100%; border-collapse: collapse; background: #161b22; border-radius: 12px; overflow: hidden; border: 1px solid #30363d; }
        th { text-align: left; background: #21262d; padding: 15px; color: #8b949e; }
        td { padding: 15px; border-top: 1px solid #30363d; }
        
        .balance-badge { background: rgba(35, 134, 54, 0.2); color: #3fb950; padding: 4px 10px; border-radius: 20px; font-weight: bold; }
        input[type="number"] { background: #0d1117; border: 1px solid #30363d; color: #fff; padding: 8px; border-radius: 6px; width: 80px; }
        button { background: #238636; color: #fff; border: none; padding: 8px 15px; border-radius: 6px; cursor: pointer; transition: 0.2s; }
        button:hover { background: #2ea043; }
        .id-link { color: #58a6ff; text-decoration: none; font-family: monospace; }
    </style></head>
    <body>
        <h1>👑 Управление проектом TON CASINO</h1>
        
        <div class="stats-grid">
            <div class="stat-card"><span>Всего игроков</span><h2>${stats.totalUsers}</h2></div>
            <div class="stat-card"><span>Общий баланс</span><h2>${stats.totalBalance} TON</h2></div>
            <div class="stat-card"><span>Всего кликов</span><h2>${stats.totalTaps}</h2></div>
        </div>

        <table class="user-table">
            <thead>
                <tr>
                    <th>Игрок</th>
                    <th>ID</th>
                    <th>Баланс</th>
                    <th>Клики</th>
                    <th>Управление</th>
                </tr>
            </thead>
            <tbody>
                ${users.map(u => `
                    <tr>
                        <td><b>${u.name || 'Аноним'}</b><br><small>@${u.username || '-'}</small></td>
                        <td><span class="id-link">${u.tgId}</span></td>
                        <td><span class="balance-badge">${u.balance.toFixed(2)} TON</span></td>
                        <td>${u.totalTaps}</td>
                        <td>
                            <form action="/admin/give" method="POST" style="display:flex; gap:10px">
                                <input type="hidden" name="id" value="${u.tgId}">
                                <input type="number" step="0.1" name="amount" placeholder="+/-">
                                <button type="submit">Применить</button>
                            </form>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </body></html>
    `);
});

app.post('/admin/give', async (req, res) => {
    const { id, amount } = req.body;
    if (id && amount) {
        await User.updateOne({ tgId: id }, { $inc: { balance: Number(amount) } });
    }
    res.redirect('/admin');
});

// ==========================================
// 🚀 ЗАПУСК СИСТЕМЫ
// ==========================================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ████████████████████████████████
    🚀 MEGA SCRIPT 2026 STARTED
    📡 PORT: ${PORT}
    🤖 BOT: ACTIVE
    👑 ADMIN: ${WEB_URL}/admin
    ████████████████████████████████
    `);
});
