const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const crypto = require('crypto');

// --- НАСТРОЙКИ ---
const CFG = {
    DB: "mongodb+srv://sv2951605_db_user:zetatop123@cluster0.k5dri5s.mongodb.net/?appName=Cluster0",
    TOKEN: process.env.BOT_TOKEN || "ТВОЙ_ТОКЕН", 
    WALLET: "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn",
    GAME: {
        SYMBOLS: ['💎', '💰', '🔥', '👑', '🍀', '⚡'],
        WIN_X10: 10,
        WIN_X2: 1.5
    }
};

const app = express();
app.use(express.json());

// --- БАЗА ДАННЫХ ---
mongoose.connect(CFG.DB).then(() => console.log("💎 DB CONNECTED"));

const User = mongoose.model('User', {
    uid: String,
    balance: { type: Number, default: 106.00 },
    settings: {
        haptic: { type: Boolean, default: true },
        sound: { type: Boolean, default: true }
    }
});

// --- БОТ ---
const bot = new TelegramBot(CFG.TOKEN, { polling: true });
bot.onText(/\/start/, async (msg) => {
    const uid = msg.from.id.toString();
    let u = await User.findOne({ uid }) || await new User({ uid }).save();
    bot.sendMessage(uid, `💎 **VIP TON ХОТ ТАП**\n\nТвой баланс: ${u.balance.toFixed(2)} TON`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: "🎰 ИГРАТЬ", web_app: { url: "https://ton-casino-bot.onrender.com" } }]] }
    });
});

// --- API ---
app.post('/api/sync', async (req, res) => {
    const u = await User.findOne({ uid: req.body.uid });
    res.json(u || { balance: 0 });
});

app.post('/api/spin', async (req, res) => {
    const { uid, bet } = req.body;
    const u = await User.findOne({ uid });
    if (!u || u.balance < bet) return res.json({ err: "Недостаточно TON!" });

    u.balance -= bet;
    const resArr = [
        CFG.GAME.SYMBOLS[crypto.randomInt(0, 6)],
        CFG.GAME.SYMBOLS[crypto.randomInt(0, 6)],
        CFG.GAME.SYMBOLS[crypto.randomInt(0, 6)]
    ];

    let win = 0;
    if (resArr[0] === resArr[1] && resArr[1] === resArr[2]) win = bet * CFG.GAME.WIN_X10;
    else if (resArr[0] === resArr[1] || resArr[1] === resArr[2]) win = bet * CFG.GAME.WIN_X2;

    u.balance += win;
    await u.save();
    res.json({ resArr, win, balance: u.balance });
});

// --- FRONTEND (HTML + UI) ---
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
    <title>VIP TON TAP</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        :root { --p: #00ffff; --s: #a200ff; --bg: #050505; --panel: #111111; }
        body { margin: 0; background: var(--bg); color: #fff; font-family: -apple-system, sans-serif; overflow: hidden; height: 100vh; }
        
        .screen { display: none; flex-direction: column; padding: 20px; height: 100vh; box-sizing: border-box; }
        .active { display: flex; }

        /* ШАПКА */
        .card-bal { background: var(--panel); border-radius: 20px; padding: 20px; border: 1px solid #222; display: flex; justify-content: space-between; align-items: center; }
        .bal-label { font-size: 11px; color: #777; letter-spacing: 1px; margin-bottom: 5px; text-transform: uppercase; }
        .bal-value { font-size: 34px; font-weight: 900; color: var(--p); }
        .btn-settings { background: none; border: none; font-size: 26px; cursor: pointer; opacity: 0.7; }
        
        /* БАРАБАНЫ */
        .reels-box { flex: 1; display: flex; align-items: center; justify-content: center; gap: 15px; }
        .reel { width: 95px; height: 120px; background: var(--bg); border: 2px solid var(--s); border-radius: 18px; display: flex; align-items: center; justify-content: center; font-size: 50px; box-shadow: 0 0 15px rgba(162, 0, 255, 0.3); transition: 0.1s; }
        .spinning { animation: blur 0.1s infinite; }
        @keyframes blur { 0% { filter: blur(0px); transform: translateY(-3px); } 50% { filter: blur(5px); } 100% { filter: blur(0px); transform: translateY(3px); } }

        /* КНОПКИ УПРАВЛЕНИЯ */
        .buttons-group { display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }
        .btn-main { background: linear-gradient(135deg, #a200ff 0%, #7000ff 100%); border: none; padding: 22px; border-radius: 20px; color: white; font-size: 20px; font-weight: 800; text-transform: uppercase; box-shadow: 0 10px 20px rgba(112, 0, 255, 0.4); width: 100%; transition: 0.1s; }
        .btn-main:active { transform: scale(0.95); }
        
        .btn-donate { background: transparent; border: 2px solid var(--p); padding: 18px; border-radius: 20px; color: var(--p); font-size: 16px; font-weight: 700; text-transform: uppercase; width: 100%; transition: 0.1s; }
        .btn-donate:active { transform: scale(0.95); background: rgba(0, 255, 255, 0.1); }

        /* НАСТРОЙКИ И ДОНАТ */
        .header-top { display: flex; align-items: center; margin-bottom: 20px; }
        .back-btn { background: none; border: none; color: var(--p); font-size: 24px; padding: 0; margin-right: 15px; }
        
        .sett-list { background: var(--panel); border-radius: 20px; padding: 10px; }
        .sett-item { display: flex; justify-content: space-between; align-items: center; padding: 18px 16px; border-bottom: 1px solid #222; font-size: 16px; }
        .sett-item:last-child { border: none; }
        
        /* ПЕРЕКЛЮЧАТЕЛЬ */
        .switch { width: 48px; height: 26px; background: #333; border-radius: 13px; position: relative; }
        .switch.on { background: var(--p); }
        .switch::after { content: ''; position: absolute; width: 20px; height: 20px; background: #fff; border-radius: 50%; top: 3px; left: 3px; transition: 0.2s; }
        .switch.on::after { left: 25px; }

        .wallet-box { background: #000; border: 1px solid #333; padding: 15px; border-radius: 15px; font-size: 12px; color: var(--p); word-break: break-all; text-align: center; margin: 20px 0; }
    </style>
</head>
<body>

    <div id="game" class="screen active">
        <div class="card-bal">
            <div>
                <div class="bal-label">БАЛАНС TON</div>
                <div class="bal-value" id="val-bal">0.00</div>
            </div>
            <button class="btn-settings" onclick="go('settings')">⚙️</button>
        </div>
        
        <div class="reels-box">
            <div class="reel" id="r1">?</div>
            <div class="reel" id="r2">?</div>
            <div class="reel" id="r3">?</div>
        </div>
        
        <div class="buttons-group">
            <button class="btn-main" onclick="spin()" id="spin-btn">КРУТИТЬ (0.1)</button>
            <button class="btn-donate" onclick="go('donate')">💳 ПОПОЛНИТЬ</button>
        </div>
    </div>

    <div id="settings" class="screen">
        <div class="header-top">
            <button class="back-btn" onclick="go('game')">←</button>
            <h1 style="margin: 0; font-size: 24px;">НАСТРОЙКИ</h1>
        </div>
        <div class="sett-list">
            <div class="sett-item"><span>Вибрация (Haptic)</span><div class="switch on" id="s-haptic" onclick="tgl('haptic')"></div></div>
            <div class="sett-item"><span>Звуковые эффекты</span><div class="switch on" id="s-sound" onclick="tgl('sound')"></div></div>
            <div class="sett-item">
                <span>Тема оформления</span>
                <span style="color:#888; font-size:14px;">Neon Night</span>
            </div>
            <div class="sett-item"><span>Версия</span><span style="color:#555">V0.1 BETA</span></div>
        </div>
        <div style="text-align:center; color:#333; font-size:11px; margin-top:auto; padding-bottom:10px;">UID: <span id="u-id">...</span></div>
    </div>

    <div id="donate" class="screen">
        <div class="header-top">
            <button class="back-btn" onclick="go('game')">←</button>
            <h1 style="margin: 0; font-size: 24px;">ПОПОЛНЕНИЕ</h1>
        </div>
        <div class="sett-list" style="padding: 20px; text-align: center;">
            <p style="color: #aaa; font-size: 14px;">Для пополнения баланса переведите TON на указанный кошелек. Депозит зачислится автоматически.</p>
            <div class="wallet-box">${CFG.WALLET}</div>
            <button class="btn-main" style="padding: 15px; font-size: 16px;" onclick="copyWallet()">📋 СКОПИРОВАТЬ</button>
        </div>
    </div>

    <script>
        const tg = window.Telegram.WebApp;
        const uid = tg.initDataUnsafe?.user?.id || "8475323865";
        let sets = { haptic: true, sound: true };

        function go(id) {
            document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
            document.getElementById(id).classList.add('active');
        }

        function tgl(k) {
            sets[k] = !sets[k];
            document.getElementById('s-'+k).classList.toggle('on');
            if(sets.haptic) tg.HapticFeedback.impactOccurred('light');
        }

        function copyWallet() {
            navigator.clipboard.writeText("${CFG.WALLET}");
            tg.showAlert("Адрес кошелька скопирован!");
            if(sets.haptic) tg.HapticFeedback.notificationOccurred('success');
        }

        async function sync() {
            try {
                const r = await fetch('/api/sync', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({uid}) });
                const d = await r.json();
                document.getElementById('val-bal').innerText = d.balance.toFixed(2);
                document.getElementById('u-id').innerText = uid;
            } catch(e) {}
        }

        async function spin() {
            const btn = document.getElementById('spin-btn');
            btn.disabled = true;
            if(sets.haptic) tg.HapticFeedback.impactOccurred('heavy');

            const reels = [document.getElementById('r1'), document.getElementById('r2'), document.getElementById('r3')];
            reels.forEach(r => r.classList.add('spinning'));

            try {
                const r = await fetch('/api/spin', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({uid, bet: 0.1}) });
                const d = await r.json();

                if(d.err) {
                    reels.forEach(r => r.classList.remove('spinning'));
                    tg.showAlert(d.err);
                    btn.disabled = false;
                    return;
                }

                setTimeout(() => {
                    reels.forEach((r, i) => {
                        r.classList.remove('spinning');
                        r.innerText = d.resArr[i];
                    });
                    sync();
                    btn.disabled = false;
                    if(d.win > 0) {
                        if(sets.haptic) tg.HapticFeedback.notificationOccurred('success');
                        tg.showAlert("🔥 ВЫИГРЫШ: " + d.win + " TON");
                    }
                }, 800);
            } catch(e) {
                reels.forEach(r => r.classList.remove('spinning'));
                btn.disabled = false;
            }
        }

        sync();
        tg.expand();
    </script>
</body>
</html>
    `);
});

app.listen(process.env.PORT || 3000, () => console.log("💎 SERVER ONLINE"));
