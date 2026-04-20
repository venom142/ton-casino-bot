require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const path = require('path');

// ==========================================
// ⚙️ КОНФИГУРАЦИЯ (ВСЕ ДАННЫЕ ВШИТЫ)
// ==========================================
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_ID = 5664124314; 
const TON_WALLET = 'UQDoTj0hCwJbI-9fziRCyUZzO2XHmtcDzuiAiGjxG21G3dIX'; 
const TON_API_KEY = process.env.TONCENTER_KEY; 
const WEB_APP_URL = 'https://ton-casino-bot.onrender.com';
const PORT = process.env.PORT || 3000;

const bot = new Telegraf(BOT_TOKEN);
const app = express();

// Настройки Express для работы с формами и JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================================
// 🗄 ПОДКЛЮЧЕНИЕ БАЗЫ ДАННЫХ
// ==========================================
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB подключена успешно'))
    .catch(err => console.error('❌ Ошибка подключения к MongoDB:', err));

const UserSchema = new mongoose.Schema({
    tgId: { type: Number, unique: true },
    username: String,
    firstName: String,
    balance: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    lvl: { type: Number, default: 1 },
    lastUpdate: { type: Date, default: Date.now }
});

const PromoSchema = new mongoose.Schema({
    code: String,
    reward: Number,
    limit: Number,
    usedBy: [Number]
});

const TransactionSchema = new mongoose.Schema({
    hash: { type: String, unique: true },
    amount: Number,
    sender: Number,
    date: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Promo = mongoose.model('Promo', PromoSchema);
const Transaction = mongoose.model('Transaction', TransactionSchema);

// ==========================================
// 💸 АВТОМАТИЧЕСКАЯ ПРОВЕРКА ПЛАТЕЖЕЙ TON
// ==========================================
async function scanTonTransactions() {
    try {
        const url = `https://toncenter.com/api/v2/getTransactions?address=${TON_WALLET}&limit=15&api_key=${TON_API_KEY}`;
        const response = await axios.get(url);
        const txs = response.data.result;

        for (const tx of txs) {
            const hash = tx.transaction_id.hash;
            const value = Number(tx.in_msg.value) / 1000000000; // перевод в TON
            const comment = tx.in_msg.message; // Тут должен быть TG ID юзера

            if (value > 0 && comment) {
                const userId = Number(comment.trim());
                if (!isNaN(userId)) {
                    const alreadyExists = await Transaction.findOne({ hash });
                    if (!alreadyExists) {
                        const user = await User.findOne({ tgId: userId });
                        if (user) {
                            user.balance += value;
                            await user.save();
                            await Transaction.create({ hash, amount: value, sender: userId });
                            
                            await bot.telegram.sendMessage(userId, `💰 **Пополнение подтверждено!**\nНа ваш баланс зачислено: ${value.toFixed(2)} TON.`).catch(() => {});
                            console.log(`[PAYMENT] Зачислено ${value} TON юзеру ${userId}`);
                        }
                    }
                }
            }
        }
    } catch (error) {
        // Ошибка сканирования (обычно лимиты API)
    }
}
setInterval(scanTonTransactions, 35000); // Проверка каждые 35 секунд

// ==========================================
// 🤖 ЛОГИКА ТЕЛЕГРАМ БОТА
// ==========================================

const getKeyboard = (userId) => {
    const buttons = [
        [Markup.button.webApp('🚀 ИГРАТЬ В КАЗИНО', WEB_APP_URL)],
        [Markup.button.callback('💳 ПОПОЛНИТЬ', 'menu_donate'), Markup.button.callback('🎁 ПРОМОКОД', 'menu_promo')],
        [Markup.button.callback('👤 ПРОФИЛЬ', 'menu_profile'), Markup.button.callback('📊 ТОП', 'menu_top')]
    ];

    if (userId === ADMIN_ID) {
        buttons.push([Markup.button.webApp('👑 УПРАВЛЕНИЕ (АДМИНКА)', `${WEB_APP_URL}/admin`)]);
    }

    return Markup.inlineKeyboard(buttons);
};

bot.start(async (ctx) => {
    const { id, first_name, username } = ctx.from;
    let user = await User.findOne({ tgId: id });

    if (!user) {
        user = await User.create({
            tgId: id,
            firstName: first_name,
            username: username || 'NoName',
            balance: 0
        });
    }

    const welcomeMsg = `💎 **ДОБРО ПОЖАЛОВАТЬ В TON CASINO!** 💎\n\n💰 Твой баланс: **${user.balance.toFixed(2)} TON**\n🆔 Твой ID: \`${id}\` (используй при пополнении)\n\nЖми на кнопку ниже, чтобы начать зарабатывать!`;
    
    ctx.replyWithPhoto('https://files.catbox.moe/78surr.mp3', { // Замени картинку если есть
        caption: welcomeMsg,
        parse_mode: 'Markdown',
        ...getKeyboard(id)
    }).catch(() => ctx.reply(welcomeMsg, { parse_mode: 'Markdown', ...getKeyboard(id) }));
});

// Обработка кнопок меню
bot.action('menu_profile', async (ctx) => {
    const user = await User.findOne({ tgId: ctx.from.id });
    const text = `👤 **ВАШ ПРОФИЛЬ**\n\n🆔 ID: \`${user.tgId}\`\n💰 Баланс: ${user.balance.toFixed(2)} TON\n🖱 Всего кликов: ${user.clicks}\n📈 Уровень: ${user.lvl}`;
    ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 НАЗАД', 'to_main')]]) });
});

bot.action('menu_donate', (ctx) => {
    const text = `💳 **ПОПОЛНЕНИЕ БАЛАНСА**\n\nДля автоматического пополнения отправьте любую сумму TON на этот кошелек:\n\n\`${TON_WALLET}\`\n\n⚠️ **ВАЖНО:** В комментарии к платежу укажите ваш ID:\n\`${ctx.from.id}\`\n\nБез комментария средства не будут зачислены автоматически!`;
    ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 НАЗАД', 'to_main')]]) });
});

bot.action('menu_promo', (ctx) => {
    ctx.reply('🎁 Введите ваш промокод:');
});

bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) return;

    const promoCode = ctx.message.text.trim();
    const promo = await Promo.findOne({ code: promoCode });

    if (promo) {
        if (promo.usedBy.includes(ctx.from.id)) {
            return ctx.reply('❌ Вы уже использовали этот промокод.');
        }
        if (promo.usedBy.length >= promo.limit) {
            return ctx.reply('❌ Лимит активаций промокода исчерпан.');
        }

        await User.updateOne({ tgId: ctx.from.id }, { $inc: { balance: promo.reward } });
        await Promo.updateOne({ code: promoCode }, { $push: { usedBy: ctx.from.id } });

        ctx.reply(`✅ Успех! Вы получили ${promo.reward} TON на баланс.`);
    }
});

// Админ команды в чате
bot.command('give', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const args = ctx.message.text.split(' ');
    if (args.length < 3) return ctx.reply('Используй: /give [ID] [СУММА]');
    
    const targetId = Number(args[1]);
    const amount = Number(args[2]);
    
    await User.updateOne({ tgId: targetId }, { $inc: { balance: amount } });
    ctx.reply(`✅ Выдано ${amount} TON пользователю ${targetId}`);
    bot.telegram.sendMessage(targetId, `🎁 Администратор выдал вам бонус: ${amount} TON!`);
});

bot.action('to_main', async (ctx) => {
    const user = await User.findOne({ tgId: ctx.from.id });
    ctx.editMessageText(`💎 **TON CASINO**\n\n💰 Баланс: ${user.balance.toFixed(2)} TON`, { parse_mode: 'Markdown', ...getKeyboard(ctx.from.id) });
});

bot.launch();

// ==========================================
// 🌐 ВЕБ-ПРИЛОЖЕНИЕ (ИГРА + АНИМАЦИИ)
// ==========================================

app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
        <title>TON CASINO GAME</title>
        <script src="https://telegram.org/js/telegram-web-app.js"></script>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;900&display=swap');
            body { background: #050505; color: white; font-family: 'Orbitron', sans-serif; margin: 0; height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; }
            .stats { position: absolute; top: 20px; text-align: center; }
            .balance-label { font-size: 14px; color: #00d4ff; letter-spacing: 3px; }
            .balance-value { font-size: 50px; font-weight: 900; text-shadow: 0 0 30px #00d4ff; }
            .btn-container { position: relative; width: 300px; height: 300px; margin-top: 50px; }
            .main-btn { width: 100%; height: 100%; border-radius: 50%; background: radial-gradient(circle, #0088cc 0%, #002233 100%); border: 10px solid #00d4ff; box-shadow: 0 0 60px rgba(0, 212, 255, 0.4); cursor: pointer; position: relative; z-index: 5; transition: transform 0.05s; outline: none; -webkit-tap-highlight-color: transparent; }
            .main-btn:active { transform: scale(0.9); box-shadow: 0 0 90px #00d4ff; }
            .pulse { position: absolute; top: 0; left: 0; width: 100%; height: 100%; border-radius: 50%; border: 4px solid #00d4ff; animation: pulse-ring 2s infinite; pointer-events: none; }
            @keyframes pulse-ring { 0% { transform: scale(1); opacity: 1; } 100% { transform: scale(1.8); opacity: 0; } }
            .floating-text { position: absolute; color: #00ffcc; font-size: 30px; font-weight: 900; animation: floatUp 0.7s forwards; pointer-events: none; z-index: 10; }
            @keyframes floatUp { from { transform: translateY(0); opacity: 1; } to { transform: translateY(-150px); opacity: 0; } }
            .footer { position: absolute; bottom: 30px; color: #444; font-size: 12px; }
        </style>
    </head>
    <body>
        <div class="stats">
            <div class="balance-label">TOTAL TON</div>
            <div class="balance-value" id="score">0.00</div>
        </div>

        <div class="btn-container">
            <div class="pulse"></div>
            <button class="main-btn" id="tapBtn"></button>
        </div>

        <div class="footer">POWERED BY TON BLOCKCHAIN</div>

        <audio id="bgMusic" src="https://files.catbox.moe/78surr.mp3" loop></audio>

        <script>
            let tg = window.Telegram.WebApp;
            let score = 0;
            let scoreEl = document.getElementById('score');
            let btn = document.getElementById('tapBtn');
            let music = document.getElementById('bgMusic');

            tg.expand();
            tg.enableClosingConfirmation();

            btn.addEventListener('pointerdown', (e) => {
                // Включение музыки при первом клике
                if (music.paused) music.play();

                score += 0.01;
                scoreEl.innerText = score.toFixed(2);
                
                // Вибрация
                tg.HapticFeedback.impactOccurred('heavy');

                // Создание вылетающего текста
                let text = document.createElement('div');
                text.className = 'floating-text';
                text.innerText = '+0.01';
                text.style.left = e.pageX + 'px';
                text.style.top = e.pageY - 50 + 'px';
                document.body.appendChild(text);

                setTimeout(() => text.remove(), 700);
            });
        </script>
    </body>
    </html>
    `);
});

// ==========================================
// 👑 ВЕБ-АДМИНКА (УПРАВЛЕНИЕ ЧЕРЕЗ БРАУЗЕР)
// ==========================================

app.get('/admin', async (req, res) => {
    const users = await User.find().sort({ balance: -1 });
    const promos = await Promo.find();

    let userRows = users.map(u => `
        <div class="user-card">
            <div class="user-info">
                <b>${u.firstName}</b> (@${u.username})<br>
                <small>ID: ${u.tgId}</small>
            </div>
            <div class="user-balance">${u.balance.toFixed(2)} TON</div>
            <form action="/admin/update-balance" method="POST">
                <input type="hidden" name="id" value="${u.tgId}">
                <input type="number" step="0.01" name="amount" placeholder="Сумма (+/-)">
                <button type="submit">OK</button>
            </form>
        </div>
    `).join('');

    res.send(`
    <!DOCTYPE html><html><head><meta charset="UTF-8">
    <style>
        body { background: #0a0a0a; color: #ccc; font-family: sans-serif; padding: 20px; }
        .user-card { background: #1a1a1a; padding: 15px; border-radius: 10px; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between; border-left: 4px solid #00d4ff; }
        .user-info { flex: 1; }
        .user-balance { font-size: 20px; font-weight: bold; color: #00ffcc; margin: 0 20px; }
        input { background: #333; border: 1px solid #444; color: #fff; padding: 5px; border-radius: 5px; width: 80px; }
        button { background: #00d4ff; border: none; color: #000; padding: 6px 12px; border-radius: 5px; font-weight: bold; cursor: pointer; }
        h1 { color: #00d4ff; }
    </style></head><body>
        <h1>👑 TON CASINO ADMIN</h1>
        <div class="admin-container">
            <h3>Список игроков (${users.length})</h3>
            ${userRows}
        </div>
    </body></html>
    `);
});

app.post('/admin/update-balance', async (req, res) => {
    const { id, amount } = req.body;
    await User.updateOne({ tgId: Number(id) }, { $inc: { balance: Number(amount) } });
    res.redirect('/admin');
});

// ==========================================
// 🚀 ЗАПУСК СЕРВЕРА
// ==========================================
app.listen(PORT, () => {
    console.log('====================================');
    console.log(`🚀 СЕРВЕР ЗАПУЩЕН НА ПОРТУ ${PORT}`);
    console.log(`📡 WEB APP: ${WEB_APP_URL}`);
    console.log('====================================');
});
