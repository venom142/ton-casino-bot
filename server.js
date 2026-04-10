const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

const WALLET = "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn"; 
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = "mongodb+srv://sv2951605_db_user:zetatop123@cluster0.k5dri5s.mongodb.net/?appName=Cluster0";
const ADMIN_ID = 8475323865; 

mongoose.connect(MONGO_URI).then(() => console.log("DB: OK")).catch(() => console.log("DB: ERR"));

const User = mongoose.model('User', { 
    uid: String, 
    balance: { type: Number, default: 0.10 }, 
    s: { type: Number, default: 0 }, 
    w: { type: Number, default: 0 },
    promo: { type: [String], default: [] } 
});

const Promo = mongoose.model('Promo', {
    code: { type: String, uppercase: true, unique: true },
    amount: Number,
    limit: { type: Number, default: 1 },
    used: { type: Number, default: 0 }
});

const Tx = mongoose.model('Tx', { hash: String });
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
app.use(express.json());

bot.onText(/\/start/, async (m) => {
    let u = await User.findOne({ uid: m.from.id.toString() }) || await new User({ uid: m.from.id.toString() }).save();
    bot.sendMessage(m.chat.id, `💎 VIP TON ХОТ ТАП 💎\n\n💰 Баланс: ${u.balance.toFixed(2)} TON`, {
        reply_markup: { inline_keyboard: [[{ text: "🚀 ИГРАТЬ", web_app: { url: "https://ton-casino-bot.onrender.com" } }]] }
    });
});

// === API SPIN С УЛУЧШЕННЫМИ ШАНСАМИ ===
app.post('/api/spin', async (req, res) => {
    const { uid, bet } = req.body;
    const betVal = parseFloat(bet);
    const u = await User.findOne({ uid: uid.toString() });
    if (!u || u.balance < betVal) return res.json({ err: "МАЛО TON" });

    u.balance = Number((u.balance - betVal).toFixed(2)); u.s += 1;
    const syms = ['🍒','7️⃣','💎','💰','⭐','🎱'];
    let r;
    
    // ШАНС ПОБЕДЫ ~12%
    if (Math.random() < 0.12) {
        const winSym = syms[Math.floor(Math.random() * syms.length)];
        r = [winSym, winSym, winSym];
    } else {
        r = [syms[Math.floor(Math.random()*6)], syms[Math.floor(Math.random()*6)], syms[Math.floor(Math.random()*6)]];
        if (r[0] === r[1] && r[1] === r[2]) r[2] = syms[(syms.indexOf(r[2]) + 1) % 6];
    }

    let win = 0; 
    if (r[0] === r[1] && r[1] === r[2]) { 
        let mult = 5; 
        if (r[0] === '7️⃣') mult = 15;
        if (r[0] === '💎') mult = 10;
        win = Number((betVal * mult).toFixed(2));
        u.balance += win; u.w += 1; 
    }
    
    await u.save(); 
    res.json({ r, win, balance: u.balance, s: u.s, w: u.w });
});

app.post('/api/sync', async (req, res) => {
    const u = await User.findOne({ uid: req.body.uid.toString() }) || await new User({ uid: req.body.uid.toString() }).save();
    res.json(u);
});

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; margin: 0; padding: 0; }
        body { 
            height: 100vh; overflow: hidden; 
            background: url('https://files.catbox.moe/622ngf.jpg') no-repeat center center fixed; 
            background-size: cover; color: #fff; font-family: sans-serif; display: flex; flex-direction: column; 
        }
        .nav-top { display: flex; gap: 5px; padding: 10px; z-index: 10; }
        .tab { flex: 1; padding: 12px; background: rgba(0,0,0,0.7); border: 1px solid #333; border-radius: 12px; font-size: 10px; font-weight: 800; color: #666; text-transform: uppercase; text-align: center; }
        .tab.active { border-color: #f0f; color: #fff; background: rgba(255,0,255,0.2); }
        .main-container { flex: 1; display: flex; flex-direction: column; justify-content: space-around; padding: 0 15px 25px; z-index: 5; }
        .card { background: rgba(0,0,0,0.85); border: 1px solid #0ff; padding: 20px; border-radius: 20px; text-align: center; box-shadow: 0 0 15px rgba(0,255,255,0.3); }
        .bal { font-size: 40px; font-weight: 900; color: #fff; text-shadow: 0 0 10px #0ff; }
        .reels { display: flex; justify-content: center; gap: 8px; margin: 15px 0; }
        .reel-window { width: 30%; height: 80px; background: rgba(0,0,0,0.9); border: 2px solid #f0f; border-radius: 15px; overflow: hidden; position: relative; box-shadow: inset 0 0 10px #f0f; }
        .reel-strip { position: absolute; width: 100%; display: flex; flex-direction: column; align-items: center; top: 0; }
        .symbol { height: 80px; display: flex; align-items: center; justify-content: center; font-size: 40px; }
        .btn-spin { width: 100%; padding: 20px; border-radius: 18px; border: none; background: linear-gradient(135deg, #ff00ff, #6e00ff); color: #fff; font-size: 20px; font-weight: 900; text-transform: uppercase; box-shadow: 0 0 20px rgba(255, 0, 255, 0.5); }
        .hidden { display: none !important; }
        .stat-grid { display: flex; justify-content: space-around; margin-top: 15px; }
        .stat-item { text-align: center; }
        .stat-val { font-size: 24px; font-weight: 900; color: #fff; }
        .stat-label { font-size: 9px; color: #0ff; text-transform: uppercase; }
    </style>
</head>
<body>
    <audio id="bg-mus" loop src="https://files.catbox.moe/78surr.mp3"></audio>
    <div class="nav-top">
        <div class="tab active" id="t1" onclick="sw(1)">ИГРА</div>
        <div class="tab" id="t2" onclick="sw(2)">ИНФО</div>
        <div class="tab" id="t4" onclick="sw(4)">ДЕПОЗИТ</div>
    </div>
    <div class="main-container">
        <div id="p-game">
            <div class="card"><p style="font-size:10px; opacity:0.5;">БАЛАНС TON</p><div class="bal" id="v-bal">0.00</div></div>
            <div class="reels">
                <div class="reel-window"><div class="reel-strip" id="rs1"></div></div>
                <div class="reel-window"><div class="reel-strip" id="rs2"></div></div>
                <div class="reel-window"><div class="reel-strip" id="rs3"></div></div>
            </div>
            <button id="spin-btn" class="btn-spin" onclick="spin()">ИГРАТЬ</button>
        </div>
        
        <div id="p-stat" class="hidden">
            <div class="card" style="border-color: #f0f; box-shadow: 0 0 15px rgba(255,0,255,0.3);">
                <h3 style="color: #f0f; margin-bottom: 10px;">СТАТИСТИКА</h3>
                <div class="stat-grid">
                    <div class="stat-item"><div class="stat-val" id="v-s">0</div><div class="stat-label">Игр</div></div>
                    <div class="stat-item"><div class="stat-val" id="v-w" style="color: #0ff;">0</div><div class="stat-label">Побед</div></div>
                </div>
                <div style="margin-top: 15px; font-size: 12px; color: #aaa;">Удача: <span id="v-luck" style="color:#fff">0</span>%</div>
            </div>
        </div>
    </div>
    <script>
        const tg = window.Telegram.WebApp;
        const uid = tg.initDataUnsafe?.user?.id || "12345";
        const syms = ['🍒','7️⃣','💎','💰','⭐','🎱'];

        async function sync() {
            const r = await fetch('/api/sync', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({uid}) });
            const d = await r.json();
            document.getElementById('v-bal').innerText = d.balance.toFixed(2);
            document.getElementById('v-s').innerText = d.s; 
            document.getElementById('v-w').innerText = d.w;
            const luck = d.s > 0 ? ((d.w / d.s) * 100).toFixed(1) : 0;
            document.getElementById('v-luck').innerText = luck;
        }

        function sw(n) {
            document.getElementById('p-game').classList.toggle('hidden', n !== 1);
            document.getElementById('p-stat').classList.toggle('hidden', n !== 2);
            [1,2,4].forEach(i => { if(document.getElementById('t'+i)) document.getElementById('t'+i).classList.toggle('active', n === i) });
        }
        setInterval(sync, 5000); sync();
        // (Остальные функции spin и initReels остаются как были)
    </script>
</body>
</html>
    `);
});
app.listen(PORT, () => console.log("SERVER LIVE V0.4"));
