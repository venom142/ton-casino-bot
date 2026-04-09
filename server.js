/**
 * 💎 VIP TON ХОТ ТАП — ULTIMATE ALL-IN-ONE EDITION
 * --------------------------------------------------
 * В ЭТОМ ФАЙЛЕ СОБРАНО 100% КОДА ПРОЕКТА:
 * СЕРВЕР + БАЗА + МАТЕМАТИКА + ДИЗАЙН + ЛОГИКА
 * --------------------------------------------------
 */

const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());

// [ СЕКЦИЯ 1: КОНФИГУРАЦИЯ ]
const CONFIG = {
    PORT: process.env.PORT || 3000,
    DB_URI: "mongodb+srv://sv2951605_db_user:zetatop123@cluster0.k5dri5s.mongodb.net/?appName=Cluster0",
    ADMIN_ID: "8475323865",
    MIN_BET: 0.1,
    SYMBOLS: [
        { char: '💎', weight: 1, mult: 100 },
        { char: '👑', weight: 5, mult: 50 },
        { char: '💰', weight: 10, mult: 20 },
        { char: '🔥', weight: 20, mult: 10 },
        { char: '⚡', weight: 35, mult: 5 },
        { char: '🍀', weight: 50, mult: 2 },
        { char: '🍒', weight: 80, mult: 1.5 }
    ]
};

// [ СЕКЦИЯ 2: МОДЕЛЬ ДАННЫХ ]
mongoose.connect(CONFIG.DB_URI).then(() => console.log("✅ DB CONNECTED"));

const User = mongoose.model('User', {
    uid: { type: String, unique: true },
    username: String,
    balance: { type: Number, default: 106.00 },
    level: { type: Number, default: 1 },
    xp: { type: Number, default: 0 },
    stats: { totalSpins: { type: Number, default: 0 } },
    settings: { haptic: { type: Boolean, default: true } }
});

// [ СЕКЦИЯ 3: МАТЕМАТИЧЕСКИЙ ДВИЖОК ]
function getSpinResult() {
    let result = [];
    for (let i = 0; i < 3; i++) {
        const rand = Math.floor(Math.random() * 100);
        let selected = CONFIG.SYMBOLS[CONFIG.SYMBOLS.length - 1];
        for (let s of CONFIG.SYMBOLS) {
            if (rand < s.weight) { selected = s; break; }
        }
        result.push(selected);
    }
    return result;
}

// [ СЕКЦИЯ 4: API РОУТЫ ]

// Синхронизация при старте
app.post('/api/sync', async (req, res) => {
    let user = await User.findOne({ uid: req.body.uid });
    if (!user) {
        user = new User({ uid: req.body.uid, username: req.body.first_name });
        await user.save();
    }
    res.json(user);
});

// Логика крутки
app.post('/api/spin', async (req, res) => {
    const { uid } = req.body;
    const user = await User.findOne({ uid });

    if (!user || user.balance < CONFIG.MIN_BET) return res.status(400).json({ error: "Low balance" });

    const result = getSpinResult();
    let winMult = 0;

    if (result[0].char === result[1].char && result[1].char === result[2].char) {
        winMult = result[0].mult;
    } else if (result[0].char === result[1].char || result[1].char === result[2].char || result[0].char === result[2].char) {
        winMult = 1.2;
    }

    const winAmount = CONFIG.MIN_BET * winMult;
    user.balance = Number((user.balance - CONFIG.MIN_BET + winAmount).toFixed(2));
    user.stats.totalSpins += 1;
    user.xp += 10;
    
    if (user.xp >= 100) { user.level += 1; user.xp = 0; }
    
    await user.save();
    res.json({ icons: result.map(s => s.char), win: winAmount, balance: user.balance });
});

// [ СЕКЦИЯ 5: ВЕСЬ ИНТЕРФЕЙС (HTML) ]
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>💎 VIP TON ХОТ ТАП</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        :root { --p: #00ffff; --s: #a200ff; --bg: #050505; }
        body { background: var(--bg); color: #fff; font-family: sans-serif; margin: 0; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
        .app { padding: 20px; flex: 1; display: flex; flex-direction: column; }
        .header { background: #111; padding: 20px; border-radius: 25px; display: flex; justify-content: space-between; border: 1px solid #222; }
        .bal-val { font-size: 32px; font-weight: 900; color: var(--p); }
        .reels { flex: 1; display: flex; align-items: center; justify-content: center; gap: 10px; }
        .reel { width: 90px; height: 130px; background: #000; border: 2px solid var(--s); border-radius: 20px; display: flex; align-items: center; justify-content: center; font-size: 50px; box-shadow: 0 0 15px rgba(162,0,255,0.3); }
        .spin-btn { background: linear-gradient(135deg, var(--s), #7000ff); border: none; padding: 25px; border-radius: 25px; color: #fff; font-size: 22px; font-weight: 900; width: 100%; box-shadow: 0 10px 20px rgba(112,0,255,0.4); margin-bottom: 20px; }
        .spin-btn:active { transform: scale(0.95); }
        .active { animation: blur 0.1s infinite; }
        @keyframes blur { 0%, 100% { filter: blur(0px); } 50% { filter: blur(4px); } }
        .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.9); display: none; padding: 30px; flex-direction: column; }
    </style>
</head>
<body>
    <div class="app">
        <div class="header">
            <div><div style="font-size:10px; color:#666">BALANCE TON</div><div class="bal-val" id="bal">0.00</div></div>
            <div style="text-align:right"><div style="font-size:10px; color:#666">LEVEL</div><div id="lvl" style="font-size:24px; color:var(--s)">1</div></div>
        </div>
        <div class="reels">
            <div class="reel" id="r1">💎</div>
            <div class="reel" id="r2">💎</div>
            <div class="reel" id="r3">💎</div>
        </div>
        <button class="spin-btn" id="btn" onclick="play()">HOT TAP SPIN</button>
        <button style="background:none; border:1px solid #333; color:#777; padding:15px; border-radius:15px;" onclick="document.getElementById('dep').style.display='flex'">💳 DEPOSIT</button>
    </div>

    <div id="dep" class="overlay" onclick="this.style.display='none'">
        <h1 style="color:var(--p)">DEPOSIT</h1>
        <p>Send TON to address:</p>
        <div style="background:#111; padding:20px; border-radius:15px; word-break:break-all; font-family:monospace; color:var(--s)">UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn</div>
        <button class="spin-btn" style="margin-top:20px">COPY</button>
    </div>

    <script>
        const tg = window.Telegram.WebApp;
        const uid = tg.initDataUnsafe?.user?.id || "8475323865";
        
        async function sync() {
            const r = await fetch('/api/sync', { 
                method: 'POST', 
                headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify({ uid, first_name: tg.initDataUnsafe?.user?.first_name || "Admin" }) 
            });
            const d = await r.json();
            document.getElementById('bal').innerText = d.balance.toFixed(2);
            document.getElementById('lvl').innerText = d.level;
        }

        async function play() {
            const btn = document.getElementById('btn');
            btn.disabled = true;
            tg.HapticFeedback.impactOccurred('heavy');
            
            const rs = [document.getElementById('r1'), document.getElementById('r2'), document.getElementById('r3')];
            rs.forEach(r => r.classList.add('active'));

            const r = await fetch('/api/spin', { 
                method: 'POST', 
                headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify({ uid }) 
            });
            const d = await r.json();

            setTimeout(() => {
                rs.forEach((r, i) => {
                    r.classList.remove('active');
                    r.innerText = d.icons[i];
                });
                sync();
                btn.disabled = false;
                if(d.win > 0) tg.showAlert("🔥 WIN: " + d.win + " TON");
            }, 800);
        }

        sync();
        tg.expand();
    </script>
</body>
</html>
    `);
});

app.listen(CONFIG.PORT, () => console.log("🚀 SERVER READY ON PORT " + CONFIG.PORT));
