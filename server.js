require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const mongoose = require('mongoose');

const { BOT_TOKEN, MONGO_URI, PORT = 3000 } = process.env;
const ADMIN_ID = 5664124314; 
const TON_WALLET = 'UQDoTj0hCwJbI-9fziRCyUZzO2XHmtcDzuiAiGjxG21G3dIX';
const WEB_URL = 'https://ton-casino-bot.onrender.com';

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// === БАЗА ДАННЫХ ===
mongoose.connect(MONGO_URI).then(() => console.log('🟢 SYSTEM READY'));

const User = mongoose.model('User', {
    tgId: { type: Number, unique: true },
    name: String,
    balance: { type: Number, default: 0 },
    energy: { type: Number, default: 1000 },
    total_clicks: { type: Number, default: 0 }
});

const Promo = mongoose.model('Promo', {
    code: String,
    reward: Number,
    uses: { type: Number, default: 1 }
});

// === ФУНКЦИИ БОТА ===

// Главное меню
const getMenu = (uid) => Markup.inlineKeyboard([
    [Markup.button.webApp('🚀 ИГРАТЬ (WEB APP)', WEB_URL)],
    [Markup.button.callback('💳 ПОПОЛНИТЬ', 'dep'), Markup.button.callback('🎁 ПРОМОКОД', 'promo')],
    ...(uid === ADMIN_ID ? [[Markup.button.callback('👑 АДМИН-МЕНЮ', 'admin_panel')]] : [])
]);

bot.start(async (ctx) => {
    await User.updateOne({ tgId: ctx.from.id }, { name: ctx.from.first_name }, { upsert: true });
    ctx.reply(`🏗 **TON MINING COMPLEX**\n\nДобро пожаловать в систему.`, getMenu(ctx.from.id));
});

// Система промокодов
bot.action('promo', (ctx) => ctx.reply('Введите ваш промокод:'));
bot.on('text', async (ctx) => {
    const code = ctx.message.text;
    const found = await Promo.findOne({ code });
    if (found && found.uses > 0) {
        await User.updateOne({ tgId: ctx.from.id }, { $inc: { balance: found.reward } });
        await Promo.updateOne({ code }, { $inc: { uses: -1 } });
        ctx.reply(`✅ Код активирован! +${found.reward} TON`);
    }
});

// Админ-панель в Боте
bot.action('admin_panel', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    ctx.reply('Управление системой:', Markup.inlineKeyboard([
        [Markup.button.webApp('📊 Веб-Админка', `${WEB_URL}/admin`)],
        [Markup.button.callback('📢 Рассылка', 'broadcast')]
    ]));
});

bot.launch();

// === WEB APP ENGINE (API ФУНКЦИИ) ===

// Синхронизация кликов с сервером
app.post('/api/sync', async (req, res) => {
    const { tgId, clicks } = req.body;
    const reward = clicks * 0.0005; // Коэффициент добычи
    await User.updateOne({ tgId }, { $inc: { balance: reward, energy: -clicks, total_clicks: clicks } });
    const u = await User.findOne({ tgId });
    res.json({ balance: u.balance.toFixed(4), energy: u.energy });
});

app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html><html><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
    <style>
        body { background: #000; color: #fff; font-family: sans-serif; height: 100vh; margin: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; }
        .score { font-size: 50px; font-weight: 900; color: #00f2ff; margin-bottom: 20px; }
        .coin { width: 240px; height: 240px; border-radius: 50%; background: radial-gradient(circle, #0088cc, #001); border: 5px solid #00f2ff; cursor: pointer; transition: 0.1s; display: flex; align-items: center; justify-content: center; }
        .coin:active { transform: scale(0.95); }
        .energy { width: 80%; height: 10px; background: #222; border-radius: 5px; margin-top: 30px; }
        .fill { height: 100%; background: #00f2ff; width: 100%; transition: 0.2s; }
    </style></head>
    <body>
        <div class="score" id="s">0.0000</div>
        <div class="coin" id="b"><img src="https://ton.org/download/ton_symbol.png" width="100"></div>
        <div class="energy"><div class="fill" id="f"></div></div>
        <audio id="bgm" src="https://files.catbox.moe/78surr.mp3" loop></audio>
        <script src="https://telegram.org/js/telegram-web-app.js"></script>
        <script>
            let tg = window.Telegram.WebApp; let clicks = 0; let bal = 0; let en = 1000;
            tg.expand();
            document.getElementById('b').onpointerdown = () => {
                if(en <= 0) return;
                if(document.getElementById('bgm').paused) document.getElementById('bgm').play();
                bal += 0.0005; en -= 1; clicks++;
                document.getElementById('s').innerText = bal.toFixed(4);
                document.getElementById('f').style.width = (en/10) + "%";
                tg.HapticFeedback.impactOccurred('medium');
            };
            // Функция авто-сохранения в базу каждые 3 секунды
            setInterval(() => {
                if(clicks > 0) {
                    fetch('/api/sync', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ tgId: tg.initDataUnsafe.user.id, clicks: clicks })
                    }).then(r => r.json()).then(data => { bal = parseFloat(data.balance); en = data.energy; });
                    clicks = 0;
                }
            }, 3000);
        </script>
    </body></html>
    `);
});

// === ПОЛНОЦЕННАЯ АДМИНКА ===
app.get('/admin', async (req, res) => {
    const users = await User.find().sort({balance: -1});
    const promos = await Promo.find();
    res.send(`
        <body style="background:#111; color:#fff; font-family:sans-serif; padding:20px;">
            <h1>👑 SYSTEM CONTROL</h1>
            <h3>Пользователи:</h3>
            ${users.map(u => `<div>${u.name} (ID: ${u.tgId}) - <b>${u.balance.toFixed(2)} TON</b></div>`).join('<hr>')}
            <br>
            <h3>Создать Промокод:</h3>
            <form action="/admin/promo" method="POST">
                Код: <input name="c"> Награда: <input name="r"> <button>Создать</button>
            </form>
        </body>
    `);
});

app.post('/admin/promo', async (req, res) => {
    await Promo.create({ code: req.body.c, reward: Number(req.body.r) });
    res.redirect('/admin');
});

app.listen(PORT, '0.0.0.0', () => console.log('🚀 SERVER READY'));
