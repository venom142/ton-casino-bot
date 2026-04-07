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

const User = mongoose.model('User', { 
    uid: String, 
    balance: { type: Number, default: 0.10 }, 
    s: { type: Number, default: 0 }, 
    w: { type: Number, default: 0 },
    promo: { type: [String], default: [] } 
});
const Tx = mongoose.model('Tx', { hash: String });

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
app.use(express.json());

const PROMO_LIST = { "START2026": 0.10, "RETRO": 0.05 };

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
                    u.balance = Number((u.balance + tx.in_msg.value / 1e9).toFixed(2));
                    await u.save(); await new Tx({ hash: h }).save();
                    bot.sendMessage(u.uid, "💎 Баланс пополнен!");
                }
            }
        }
    } catch (e) {}
}, 15000);

bot.onText(/\/start/, (m) => {
    bot.sendMessage(m.chat.id, "🎰 **VIP TON HOT TAP**", {
        reply_markup: { inline_keyboard: [[{ text: "🚀 ЗАПУСТИТЬ", web_app: { url: "https://ton-casino-bot.onrender.com" } }]] }
    });
});

// === API ===
app.post('/api/sync', async (req, res) => {
    const u = await User.findOne({ uid: req.body.uid.toString() }) || await new User({ uid: req.body.uid.toString() }).save();
    res.json(u);
});

app.post('/api/promo', async (req, res) => {
    const { uid, code } = req.body;
    const u = await User.findOne({ uid: uid.toString() });
    const pr = code.toUpperCase();
    if (!u || !PROMO_LIST[pr] || u.promo.includes(pr)) return res.json({ err: "ОШИБКА" });
    u.balance = Number((u.balance + PROMO_LIST[pr]).toFixed(2));
    u.promo.push(pr); await u.save();
    res.json({ ok: true, bonus: PROMO_LIST[pr], balance: u.balance });
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

// === UI ===
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
        html, body { height: 100vh; width: 100vw; overflow: hidden; background: #03001c; color: #fff; font-family: sans-serif; position: fixed; }
        .bg-grid { position: absolute; top:0; left:0; right:0; bottom:0; background: linear-gradient(0deg, #110029, transparent 70%), url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><path d="M0,0H40V40H0V0ZM1,1V39H39V1H1V1Z" fill="rgba(110,0,255,0.08)"/></svg>'); z-index: -1; transform: perspective(100vh) rotateX(60deg) translateY(-10%); transform-origin: top; }
        
        .nav-top { display: flex; gap: 5px; padding: 10px; flex-wrap: wrap; }
        .tab { flex: 1 1 45%; padding: 10px; background: rgba(0,0,0,0.6); border: 1px solid #333; border-radius: 10px; font-size: 10px; font-weight: 800; color: #666; text-transform: uppercase; text-align: center; }
        .tab.active { border-color: #f0f; color: #fff; background: rgba(255,0,255,0.1); box-shadow: 0 0 10px rgba(255,0,255,0.2); }

        .main-container { display: flex; flex-direction: column; height: calc(100vh - 110px); justify-content: space-between; padding: 0 20px 20px; }
        .sun { width: 50px; height: 50px; background: linear-gradient(#ff0, #f06); border-radius: 50%; margin: 5px auto; box-shadow: 0 0 20px #f06; }

        .card { background: rgba(0,0,0,0.8); border: 1px solid #0ff; padding: 15px; border-radius: 20px; box-shadow: 0 0 15px rgba(0,212,255,0.2); }
        .bal { font-size: 40px; font-weight: 900; color: #fff; text-shadow: 0 0 10px #0ff; }
        
        .reels { display: flex; justify-content: center; gap: 8px; margin: 15px 0; }
        .reel { width: 30%; height: 80px; background: #000; border: 2px solid #f0f; border-radius: 15px; font-size: 36px; display: flex; align-items: center; justify-content: center; transition: 0.1s; }

        .btn-spin { width: 100%; padding: 20px; border-radius: 15px; border: 1px solid #fff; background: linear-gradient(135deg, #f0f, #6e00ff); color: #fff; font-size: 20px; font-weight: 900; text-transform: uppercase; box-shadow: 0 5px 20px rgba(255,0,255,0.4); }
        .btn-spin:active { transform: scale(0.95); }
        .btn-spin:disabled { opacity: 0.3; }

        .copy-box { background: #111; padding: 10px; border-radius: 10px; font-family: monospace; font-size: 11px; color: #0ff; border: 1px solid #333; margin-top: 5px; word-break: break-all; }
        .hidden { display: none !important; }
        .set-btn { width: 100%; padding: 12px; background: rgba(255,255,255,0.05); border: 1px solid #444; border-radius: 10px; color: #fff; margin-top: 10px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="bg-grid"></div>
    <audio id="bg-mus" loop src="https://files.catbox.moe/78surr.mp3"></audio>

    <div class="nav-top">
        <div class="tab active" id="t1" onclick="sw(1)">ИГРА</div>
        <div class="tab" id="t4" onclick="sw(4)">ДЕПОЗИТ</div>
        <div class="tab" id="t2" onclick="sw(2)">ИНФО</div>
        <div class="tab" id="t3" onclick="sw(3)">ОПЦИИ</div>
    </div>

    <div class="main-container">
        <div class="sun"></div>

        <div id="p-game">
            <div class="card"><p style="font-size:11px; opacity:0.5;">БАЛАНС TON</p><div class="bal" id="v-bal">0.00</div></div>
            <div class="reels"><div class="reel" id="r1">🍒</div><div class="reel" id="r2">💎</div><div class="reel" id="r3">🍒</div></div>
            <button id="spin-btn" class="btn-spin" onclick="spin()">КРУТИТЬ (0.05)</button>
        </div>

        <div id="p-dep" class="hidden">
            <div class="card" style="text-align: left;">
                <h3 style="color:#0ff; font-size:16px;">ПОПОЛНЕНИЕ БАЛАНСА</h3>
                <p style="font-size:11px; margin:10px 0 5px;">1. Отправь TON на кошелек:</p>
                <div class="copy-box" onclick="cp('${WALLET}')">${WALLET}</div>
                <p style="font-size:11px; margin:15px 0 5px; color:#ff4444;">2. В комментарий укажи СВОЙ ID (ОБЯЗАТЕЛЬНО):</p>
                <div class="copy-box" id="v-cid" onclick="cp(this.innerText)" style="font-size:16px; color:#fff;">ID_...</div>
                <p style="font-size:10px; opacity:0.5; margin-top:10px;">* Нажми на текст, чтобы скопировать</p>
            </div>
        </div>

        <div id="p-stat" class="hidden">
            <div class="card" style="text-align: left;">
                <h3 style="color:#f0f;">СТАТИСТИКА</h3>
                <p style="margin:10px 0;">Всего игр: <span id="v-s">0</span></p>
                <p>Побед: <span id="v-w" style="color:#0f0;">0</span></p>
            </div>
        </div>

        <div id="p-set" class="hidden">
            <div class="card">
                <button class="set-btn" onclick="tglM()" id="m-btn">🔊 МУЗЫКА: ВЫКЛ</button>
                <button class="set-btn" style="background:#0ff; color:#000;" onclick="askPromo()">🎟 ВВЕСТИ ПРОМОКОД</button>
            </div>
        </div>
    </div>

    <script>
        const tg = window.Telegram.WebApp;
        tg.expand();
        const uid = tg.initDataUnsafe?.user?.id || "12345";
        const mus = document.getElementById('bg-mus');
        let mOn = false;

        async function sync() {
            try {
                const r = await fetch('/api/sync', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({uid}) });
                const d = await r.json();
                document.getElementById('v-bal').innerText = d.balance.toFixed(2);
                document.getElementById('v-s').innerText = d.s;
                document.getElementById('v-w').innerText = d.w;
                document.getElementById('v-cid').innerText = 'ID_' + uid;
                document.getElementById('spin-btn').disabled = d.balance < 0.05;
            } catch(e) {}
        }

        async function spin() {
            tg.HapticFeedback.impactOccurred('medium');
            const r = await fetch('/api/spin', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({uid}) });
            const d = await r.json();
            if(d.err) return tg.showAlert(d.err);
            
            const rls = [document.getElementById('r1'), document.getElementById('r2'), document.getElementById('r3')];
            rls.forEach(el => el.style.opacity = '0.3');
            setTimeout(() => {
                rls.forEach((el, i) => { el.innerText = d.r[i]; el.style.opacity = '1'; });
                sync();
                if(d.win > 0) { tg.HapticFeedback.notificationOccurred('success'); tg.showAlert("🔥 ПОБЕДА!"); }
            }, 200);
        }

        function sw(n) {
            document.getElementById('p-game').classList.toggle('hidden', n !== 1);
            document.getElementById('p-stat').classList.toggle('hidden', n !== 2);
            document.getElementById('p-set').classList.toggle('hidden', n !== 3);
            document.getElementById('p-dep').classList.toggle('hidden', n !== 4);
            [1,2,3,4].forEach(i => document.getElementById('t'+i).classList.toggle('active', n === i));
        }

        async function askPromo() {
            const code = prompt("Введите промокод:");
            if (!code) return;
            const r = await fetch('/api/promo', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({uid, code}) });
            const d = await r.json();
            if (d.err) tg.showAlert("Ошибка или уже использован");
            else { tg.showAlert("Успешно! + " + d.bonus + " TON"); sync(); }
        }

        function tglM() {
            if(mOn) { mus.pause(); document.getElementById('m-btn').innerText = "🔊 МУЗЫКА: ВЫКЛ"; }
            else { mus.play(); document.getElementById('m-btn').innerText = "🔊 МУЗЫКА: ВКЛ"; }
            mOn = !mOn;
        }

        function cp(t) { navigator.clipboard.writeText(t); tg.showAlert("Скопировано!"); }
        setInterval(sync, 5000); sync();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log("READY"));
