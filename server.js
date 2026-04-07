const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

// === CONFIG ===
const WALLET = "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn"; 
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = "mongodb+srv://sv2951605_db_user:zetatop123@cluster0.k5dri5s.mongodb.net/?appName=Cluster0";

mongoose.connect(MONGO_URI).then(() => console.log("DB: OK")).catch(() => console.log("DB: ERR"));

const User = mongoose.model('User', { uid: String, balance: { type: Number, default: 0.10 }, s: { type: Number, default: 0 }, w: { type: Number, default: 0 } });
const Tx = mongoose.model('Tx', { hash: String });

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
app.use(express.json());

// === TON SCANNER ===
setInterval(async () => {
    try {
        const res = await axios.get(`https://toncenter.com/api/v2/getTransactions?address=${WALLET}&limit=5`);
        for (let tx of res.data.result) {
            const h = tx.transaction_id.hash;
            const m = tx.in_msg?.message;
            if (m && m.startsWith("ID_")) {
                if (await Tx.findOne({ hash: h })) continue;
                const u = await User.findOne({ uid: m.split("_")[1] });
                if (u) {
                    u.balance += tx.in_msg.value / 1e9;
                    await u.save(); await new Tx({ hash: h }).save();
                    bot.sendMessage(u.uid, "💎 Баланс пополнен!");
                }
            }
        }
    } catch (e) {}
}, 20000);

bot.onText(/\/start/, (m) => {
    bot.sendMessage(m.chat.id, "🎰 **NEON CASINO**", {
        reply_markup: { inline_keyboard: [[{ text: "🚀 ЗАПУСТИТЬ", web_app: { url: "https://ton-casino-bot.onrender.com" } }]] }
    });
});

// === API ===
app.post('/api/sync', async (req, res) => {
    const u = await User.findOne({ uid: req.body.uid.toString() }) || await new User({ uid: req.body.uid.toString() }).save();
    res.json(u);
});

app.post('/api/spin', async (req, res) => {
    const u = await User.findOne({ uid: req.body.uid.toString() });
    if (!u || u.balance < 0.05) return res.json({ err: "МАЛО TON" });
    u.balance = Number((u.balance - 0.05).toFixed(2)); u.s += 1;
    const syms = ['🍒','7️⃣','💎','💰','⭐','🎱'];
    const r = [syms[Math.floor(Math.random()*6)], syms[Math.floor(Math.random()*6)], syms[Math.floor(Math.random()*6)]];
    let win = 0; if (r[0] === r[1] && r[1] === r[2]) { win = 0.5; u.balance += win; u.w += 1; }
    await u.save(); res.json({ r, win, balance: u.balance, s: u.s, w: u.w });
});

// === UI (TOP MENU EDITION) ===
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        body { background: #03001c; color: #fff; font-family: sans-serif; margin: 0; padding: 10px; text-align: center; height: 100vh; overflow: hidden; position: relative; }
        
        /* Сетка и солнце */
        body::before { content: ''; position: absolute; top:0; left:0; width:100%; height:100%; background: linear-gradient(0deg, #110029, transparent 60%), url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><path d="M0,0H40V40H0V0ZM1,1V39H39V1H1V1Z" fill="rgba(110,0,255,0.15)"/></svg>'); z-index: -1; transform: perspective(100vh) rotateX(60deg) translateY(-10%); }
        .sun { width: 70px; height: 70px; background: linear-gradient(#ff0, #f06); border-radius: 50%; margin: 5px auto; box-shadow: 0 0 20px #f06; }

        /* Верхнее меню */
        .nav-top { display: flex; gap: 5px; margin-bottom: 15px; }
        .tab { flex: 1; padding: 12px 5px; background: rgba(0,0,0,0.6); border: 1px solid #444; border-radius: 10px; font-size: 11px; font-weight: bold; color: #888; text-transform: uppercase; }
        .tab.active { border-color: #f0f; color: #fff; box-shadow: 0 0 10px rgba(255,0,255,0.3); background: rgba(255,0,255,0.1); }

        .card { background: rgba(0,0,0,0.7); border: 1px solid #0ff; padding: 15px; border-radius: 20px; box-shadow: 0 0 15px rgba(0,212,255,0.1); }
        .bal { font-size: 40px; font-weight: bold; color: #fff; text-shadow: 0 0 10px #0ff; margin: 5px 0; }
        
        .reels { display: flex; justify-content: center; gap: 8px; margin: 15px 0; }
        .reel { width: 30%; height: 80px; background: #000; border: 2px solid #f0f; border-radius: 15px; font-size: 35px; display: flex; align-items: center; justify-content: center; }

        .btn-spin { width: 100%; padding: 20px; border-radius: 20px; border: 1px solid #fff; background: linear-gradient(135deg, #f0f, #6e00ff); color: #fff; font-size: 20px; font-weight: bold; text-transform: uppercase; box-shadow: 0 5px 20px rgba(255,0,255,0.4); }
        .btn-spin:active { transform: scale(0.95); }

        .copy-box { background: #111; padding: 10px; border-radius: 10px; font-family: monospace; font-size: 11px; color: #0ff; margin: 5px 0; word-break: break-all; border: 1px solid #333; }
        .hidden { display: none !important; }
    </style>
</head>
<body>
    <div class="nav-top">
        <div class="tab active" id="t1" onclick="sw(1)">ИГРА</div>
        <div class="tab" id="t2" onclick="sw(2)">СТАТИСТИКА</div>
        <div class="tab" id="t3" onclick="sw(3)">НАСТРОЙКИ</div>
    </div>

    <div class="sun"></div>

    <div id="p-game">
        <div class="card">
            <small style="opacity:0.5;">БАЛАНС TON</small>
            <div class="bal" id="v-bal">0.00</div>
        </div>
        <div class="reels">
            <div class="reel" id="r1">💎</div><div class="reel" id="r2">7️⃣</div><div class="reel" id="r3">💎</div>
        </div>
        <button class="btn-spin" onclick="spin()">КРУТИТЬ (0.05)</button>
    </div>

    <div id="p-stat" class="hidden">
        <div class="card" style="text-align: left;">
            <h3 style="margin-top:0; color:#f0f;">ВАША АКТИВНОСТЬ</h3>
            <div style="display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px solid #222;">Всего игр: <span id="v-s">0</span></div>
            <div style="display:flex; justify-content:space-between; padding:10px 0;">Побед: <span id="v-w" style="color:#0f0;">0</span></div>
        </div>
    </div>

    <div id="p-set" class="hidden">
        <div class="card" style="text-align: left;">
            <h3 style="margin-top:0; color:#0ff;">ПОПОЛНЕНИЕ</h3>
            <p style="font-size:12px; margin-bottom:5px;">Кошелек для перевода:</p>
            <div class="copy-box" onclick="cp('${WALLET}')">${WALLET}</div>
            <p style="font-size:12px; margin:15px 0 5px; color:#ff4444;">ID (ОБЯЗАТЕЛЬНО В КОММЕНТАРИЙ):</p>
            <div class="copy-box" id="v-cid" onclick="cp(this.innerText)">ID_...</div>
            <p style="font-size:10px; opacity:0.4; margin-top:10px;">Нажми на адрес или ID, чтобы скопировать</p>
        </div>
    </div>

    <script>
        const tg = window.Telegram.WebApp;
        const uid = tg.initDataUnsafe?.user?.id || "12345";
        
        async function sync() {
            try {
                const r = await fetch('/api/sync', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({uid}) });
                const d = await r.json();
                document.getElementById('v-bal').innerText = d.balance.toFixed(2);
                document.getElementById('v-s').innerText = d.s;
                document.getElementById('v-w').innerText = d.w;
                document.getElementById('v-cid').innerText = 'ID_' + uid;
            } catch(e) {}
        }

        async function spin() {
            tg.HapticFeedback.impactOccurred('medium');
            const r = await fetch('/api/spin', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({uid}) });
            const d = await r.json();
            if(d.err) return tg.showAlert(d.err);
            
            document.getElementById('r1').innerText = d.r[0];
            document.getElementById('r2').innerText = d.r[1];
            document.getElementById('r3').innerText = d.r[2];
            sync();
            if(d.win > 0) {
                tg.HapticFeedback.notificationOccurred('success');
                tg.showAlert("ПОБЕДА! +0.50 TON");
            }
        }

        function sw(n) {
            document.getElementById('p-game').classList.toggle('hidden', n !== 1);
            document.getElementById('p-stat').classList.toggle('hidden', n !== 2);
            document.getElementById('p-set').classList.toggle('hidden', n !== 3);
            document.getElementById('t1').classList.toggle('active', n === 1);
            document.getElementById('t2').classList.toggle('active', n === 2);
            document.getElementById('t3').classList.toggle('active', n === 3);
        }

        function cp(t) { navigator.clipboard.writeText(t); tg.showAlert("Скопировано!"); }
        
        setInterval(sync, 5000); sync();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log("OK"));
