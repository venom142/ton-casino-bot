const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

// === КОНФИГУРАЦИЯ ===
const WALLET = "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn"; 
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = "mongodb+srv://sv2951605_db_user:zetatop123@cluster0.k5dri5s.mongodb.net/?appName=Cluster0";

mongoose.connect(MONGO_URI).then(() => console.log("БАЗА: OK")).catch(e => console.log("БАЗА: ERR"));

const User = mongoose.model('User', { uid: String, balance: { type: Number, default: 0.10 }, s: { type: Number, default: 0 }, w: { type: Number, default: 0 } });
const Tx = mongoose.model('Tx', { hash: String });

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
app.use(express.json());

// === СКАНЕР ===
async function scan() {
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
}
setInterval(scan, 30000);

bot.onText(/\/start/, (m) => {
    bot.sendMessage(m.chat.id, "🎰 **NEON TON CASINO**", {
        reply_markup: { inline_keyboard: [[{ text: "ЗАПУСТИТЬ", web_app: { url: "https://ton-casino-bot.onrender.com" } }]] }
    });
});

// === API ===
app.post('/api/init', async (req, res) => {
    let u = await User.findOne({ uid: req.body.uid.toString() }) || await new User({ uid: req.body.uid.toString() }).save();
    res.json(u);
});

app.post('/api/spin', async (req, res) => {
    const u = await User.findOne({ uid: req.body.uid.toString() });
    if (!u || u.balance < 0.05) return res.json({ err: "МАЛО TON" });
    u.balance = Number((u.balance - 0.05).toFixed(2));
    u.s += 1;
    const syms = ['🍒','7️⃣','💎','💰','⭐','🎱'];
    const r = [syms[Math.floor(Math.random()*6)], syms[Math.floor(Math.random()*6)], syms[Math.floor(Math.random()*6)]];
    let win = 0; if (r[0] === r[1] && r[1] === r[2]) { win = 0.5; u.balance = Number((u.balance + win).toFixed(2)); u.w += 1; }
    await u.save(); res.json({ r, win, balance: u.balance, s: u.s, w: u.w });
});

// === ДИЗАЙН (NEON RETROWAVE) ===
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
        body { background: #03001c; color: #fff; font-family: -apple-system, sans-serif; margin: 0; padding: 20px; text-align: center; height: 100vh; overflow: hidden; position: relative; }
        
        /* Сетка фона */
        body::before { content: ''; position: absolute; top:0; left:0; width:100%; height:100%; background: linear-gradient(0deg, #110029, transparent 50%), url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><path d="M0,0H50V50H0V0ZM1,1V49H49V1H1V1Z" fill="rgba(110,0,255,0.2)"/></svg>'); z-index: -1; transform: perspective(100vh) rotateX(60deg) translateY(-10%); }
        .sun { width: 100px; height: 100px; background: linear-gradient(#ffe100, #ff006a); border-radius: 50%; margin: 0 auto 15px; box-shadow: 0 0 40px rgba(255,0,106,0.5); }

        .card { background: rgba(0,0,0,0.6); border: 1px solid #ff00ff; padding: 15px; border-radius: 20px; margin-bottom: 15px; box-shadow: 0 0 15px rgba(255,0,255,0.2); }
        .bal { font-size: 42px; font-weight: 900; color: #fff; text-shadow: 0 0 10px #00d4ff; }
        
        .reels { display: flex; justify-content: center; gap: 8px; margin: 20px 0; }
        .reel { width: 30%; height: 90px; background: #000; border: 2px solid #00d4ff; border-radius: 15px; font-size: 40px; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 10px rgba(0,212,255,0.2); }

        /* Кнопки управления */
        .controls { display: flex; flex-direction: column; gap: 10px; margin-top: 20px; }
        .btn { width: 100%; border: none; font-size: 20px; font-weight: bold; padding: 18px; border-radius: 15px; text-transform: uppercase; transition: 0.1s; }
        .btn-spin { background: linear-gradient(135deg, #ff00ff, #6e00ff); color: #fff; box-shadow: 0 5px 20px rgba(255,0,255,0.4); border: 1px solid #fff; }
        .btn-dep { background: rgba(0,212,255,0.1); border: 1px solid #00d4ff; color: #00d4ff; font-size: 15px; }
        .btn:active { transform: scale(0.97); opacity: 0.8; }

        /* Таб-бар снизу */
        .nav { position: fixed; bottom: 15px; left: 15px; right: 15px; display: flex; gap: 10px; }
        .tab { flex: 1; padding: 12px; background: rgba(0,0,0,0.8); border: 1px solid #333; border-radius: 12px; font-size: 13px; color: #888; font-weight: bold; }
        .tab.active { border-color: #ff00ff; color: #fff; background: rgba(255,0,255,0.1); }

        .stat-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #222; }
        .hidden { display: none !important; }
    </style>
</head>
<body>
    <div class="sun"></div>

    <div id="p-game">
        <div class="card">
            <small style="opacity:0.5; letter-spacing:1px;">БАЛАНС TON</small>
            <div class="bal" id="v-bal">0.00</div>
        </div>
        
        <div class="reels">
            <div class="reel" id="r1">💎</div><div class="reel" id="r2">7️⃣</div><div class="reel" id="r3">💎</div>
        </div>

        <div class="controls">
            <button class="btn btn-spin" onclick="spin()">КРУТИТЬ (0.05)</button>
            <button class="btn btn-dep" onclick="tg.showAlert('Твой ID для пополнения: ID_'+uid)">ПОПОЛНИТЬ</button>
        </div>
    </div>

    <div id="p-info" class="hidden">
        <div class="card" style="text-align: left;">
            <h3 style="margin-top:0; color:#ff00ff;">СТАТИСТИКА</h3>
            <div class="stat-row">Всего игр: <span id="v-s" style="color:#fff;">0</span></div>
            <div class="stat-row">Побед: <span id="v-w" style="color:#00ff00;">0</span></div>
            <p style="font-size:12px; color:#555; margin-top:15px;">Support: @venom142</p>
        </div>
    </div>

    <div class="nav">
        <div class="tab active" id="t1" onclick="sw(1)">ИГРА</div>
        <div class="tab" id="t2" onclick="sw(2)">ИНФО</div>
    </div>

    <script>
        const tg = window.Telegram.WebApp;
        const uid = tg.initDataUnsafe?.user?.id || "12345";
        
        async function load() {
            const r = await fetch('/api/init', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({uid}) });
            const d = await r.json();
            upd(d);
        }

        function upd(d) {
            document.getElementById('v-bal').innerText = d.balance.toFixed(2);
            document.getElementById('v-s').innerText = d.s;
            document.getElementById('v-w').innerText = d.w;
        }

        async function spin() {
            tg.HapticFeedback.impactOccurred('medium');
            const r = await fetch('/api/spin', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({uid}) });
            const d = await r.json();
            if(d.err) return tg.showAlert(d.err);
            
            document.getElementById('r1').innerText = d.r[0];
            document.getElementById('r2').innerText = d.r[1];
            document.getElementById('r3').innerText = d.r[2];
            upd(d);
            if(d.win > 0) {
                tg.HapticFeedback.notificationOccurred('success');
                tg.showAlert("ВЫИГРЫШ: " + d.win + " TON!");
            }
        }

        function sw(n) {
            document.getElementById('p-game').classList.toggle('hidden', n === 2);
            document.getElementById('p-info').classList.toggle('hidden', n === 1);
            document.getElementById('t1').classList.toggle('active', n === 1);
            document.getElementById('t2').classList.toggle('active', n === 2);
        }
        load();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log("OK"));
