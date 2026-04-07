const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

// === ⚙️ НАСТРОЙКИ ===
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
    amount: Number
});

const Tx = mongoose.model('Tx', { hash: String });
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
app.use(express.json());

// === 🛠 АДМИН-ПАНЕЛЬ (В ТГ) ===
bot.onText(/\/addpromo (.+) (.+)/, async (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;
    const code = match[1].toUpperCase();
    const amount = parseFloat(match[2]);
    try {
        await new Promo({ code, amount }).save();
        bot.sendMessage(msg.chat.id, `✅ Промокод **${code}** на **${amount} TON** создан!`);
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ Ошибка создания."); }
});

// === 🎰 ОБРАБОТКА /START ===
bot.onText(/\/start/, async (m) => {
    let u = await User.findOne({ uid: m.from.id.toString() }) || await new User({ uid: m.from.id.toString() }).save();
    
    const welcome = `ДОБРО ПОЖАЛОВАТЬ В КАЗИК\n` +
                    `💎 VIP TON ХОТ ТАП 💎\n\n` +
                    `💰 Твой баланс: ${u.balance.toFixed(2)} TON\n\n` +
                    `⚠️ Игра в Альфа версии V0.1`;

    bot.sendMessage(m.chat.id, welcome, {
        reply_markup: { inline_keyboard: [[{ text: "🚀 ИГРАТЬ", web_app: { url: "https://ton-casino-bot.onrender.com" } }]] }
    });
});

// === 💎 TON SCANNER ===
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

// === 🔌 API ===
app.post('/api/sync', async (req, res) => {
    const u = await User.findOne({ uid: req.body.uid.toString() }) || await new User({ uid: req.body.uid.toString() }).save();
    res.json(u);
});

app.post('/api/promo', async (req, res) => {
    const { uid, code } = req.body;
    const u = await User.findOne({ uid: uid.toString() });
    const pr = await Promo.findOne({ code: code.toUpperCase().trim() });
    if (!u || !pr || u.promo.includes(pr.code)) return res.json({ err: "ОШИБКА" });
    u.balance = Number((u.balance + pr.amount).toFixed(2));
    u.promo.push(pr.code); await u.save();
    res.json({ ok: true, bonus: pr.amount, balance: u.balance });
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

// === 🎨 UI ===
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
        html, body { height: 100vh; width: 100vw; overflow: hidden; background: #03001c; color: #fff; font-family: sans-serif; display: flex; flex-direction: column; }
        .bg-grid { position: absolute; top:0; left:0; right:0; bottom:0; background: linear-gradient(0deg, #110029, transparent 70%), url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><path d="M0,0H40V40H0V0ZM1,1V39H39V1H1V1Z" fill="rgba(110,0,255,0.08)"/></svg>'); z-index: -1; transform: perspective(100vh) rotateX(60deg) translateY(-10%); transform-origin: top; }
        .nav-top { display: flex; gap: 5px; padding: 10px; z-index: 10; }
        .tab { flex: 1; padding: 12px; background: rgba(0,0,0,0.6); border: 1px solid #333; border-radius: 12px; font-size: 10px; font-weight: 800; color: #666; text-transform: uppercase; text-align: center; }
        .tab.active { border-color: #f0f; color: #fff; background: rgba(255,0,255,0.1); }
        .main-container { flex: 1; display: flex; flex-direction: column; justify-content: space-around; padding: 0 20px 30px; z-index: 5; }
        .sun { width: 50px; height: 50px; background: linear-gradient(#ff0, #f06); border-radius: 50%; margin: 0 auto; box-shadow: 0 0 20px #f06; }
        .card { background: rgba(0,0,0,0.85); border: 1px solid #0ff; padding: 20px; border-radius: 25px; text-align: center; }
        .bal { font-size: 44px; font-weight: 900; color: #fff; text-shadow: 0 0 10px #0ff; }
        .reels { display: flex; justify-content: center; gap: 10px; margin: 10px 0; }
        .reel { width: 30%; height: 85px; background: #000; border: 2px solid #f0f; border-radius: 18px; font-size: 40px; display: flex; align-items: center; justify-content: center; }
        .btn-spin { width: 100%; padding: 22px; border-radius: 20px; border: 1px solid #fff; background: linear-gradient(135deg, #f0f, #6e00ff); color: #fff; font-size: 20px; font-weight: 900; text-transform: uppercase; }
        .copy-box { background: #111; padding: 12px; border-radius: 12px; font-family: monospace; font-size: 12px; color: #0ff; border: 1px solid #333; margin-top: 10px; word-break: break-all; text-align: left; }
        .hidden { display: none !important; }
        .set-btn { width: 100%; padding: 15px; background: rgba(255,255,255,0.05); border: 1px solid #444; border-radius: 12px; color: #fff; margin-top: 10px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="bg-grid"></div>
    <audio id="bg-mus" loop src="https://files.catbox.moe/78surr.mp3"></audio>
    <div class="nav-top"><div class="tab active" id="t1" onclick="sw(1)">ИГРА</div><div class="tab" id="t4" onclick="sw(4)">ДЕПОЗИТ</div><div class="tab" id="t2" onclick="sw(2)">ИНФО</div><div class="tab" id="t3" onclick="sw(3)">ОПЦИИ</div></div>
    <div class="main-container">
        <div class="sun"></div>
        <div id="p-game">
            <div class="card"><p style="font-size:11px; opacity:0.5;">БАЛАНС TON</p><div class="bal" id="v-bal">0.00</div></div>
            <div class="reels"><div class="reel" id="r1">🍒</div><div class="reel" id="r2">7️⃣</div><div class="reel" id="r3">🍒</div></div>
            <button id="spin-btn" class="btn-spin" onclick="spin()">КРУТИТЬ (0.05)</button>
        </div>
        <div id="p-dep" class="hidden">
            <div class="card" style="text-align: left;">
                <h3 style="color:#0ff; margin-bottom: 5px;">ДЕПОЗИТ</h3>
                <p style="font-size: 10px; opacity: 0.7;">Адрес кошелька:</p>
                <div class="copy-box" onclick="cp('${WALLET}')">${WALLET}</div>
                <p style="font-size: 10px; opacity: 0.7; margin-top: 10px;">Твой ID для комментария:</p>
                <div class="copy-box" id="v-cid" onclick="cp(this.innerText)">ID_...</div>
            </div>
        </div>
        <div id="p-stat" class="hidden"><div class="card" style="text-align: left;"><h3>СТАТИСТИКА</h3><p>Всего игр: <span id="v-s">0</span></p><p>Побед: <span id="v-w" style="color:#0f0;">0</span></p></div></div>
        <div id="p-set" class="hidden"><div class="card"><button class="set-btn" onclick="tglM()" id="m-btn">🔊 МУЗЫКА: ВЫКЛ</button><button class="set-btn" style="background:#0ff; color:#000;" onclick="askPromo()">🎟 ВВЕСТИ ПРОМОКОД</button></div></div>
    </div>
    <script>
        const tg = window.Telegram.WebApp; tg.expand();
        const uid = tg.initDataUnsafe?.user?.id || "12345";
        const mus = document.getElementById('bg-mus'); let mOn = false;
        async function sync() {
            const r = await fetch('/api/sync', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({uid}) });
            const d = await r.json();
            document.getElementById('v-bal').innerText = d.balance.toFixed(2);
            document.getElementById('v-s').innerText = d.s; document.getElementById('v-w').innerText = d.w;
            document.getElementById('v-cid').innerText = 'ID_' + uid;
            document.getElementById('spin-btn').disabled = d.balance < 0.05;
        }
        async function askPromo() {
            const code = prompt("Введите промокод:"); if (!code) return;
            const r = await fetch('/api/promo', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({uid, code}) });
            const d = await r.json();
            if (d.err) tg.showAlert(d.err); else { tg.showAlert("✅ Успешно!"); sync(); }
        }
        async function spin() {
            tg.HapticFeedback.impactOccurred('medium');
            const r = await fetch('/api/spin', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({uid}) });
            const d = await r.json();
            if(d.err) return tg.showAlert(d.err);
            document.getElementById('r1').innerText = d.r[0]; document.getElementById('r2').innerText = d.r[1]; document.getElementById('r3').innerText = d.r[2];
            sync(); if(d.win > 0) { tg.HapticFeedback.notificationOccurred('success'); tg.showAlert("🔥 ПОБЕДА!"); }
        }
        function sw(n) {
            document.getElementById('p-game').classList.toggle('hidden', n !== 1); document.getElementById('p-stat').classList.toggle('hidden', n !== 2);
            document.getElementById('p-set').classList.toggle('hidden', n !== 3); document.getElementById('p-dep').classList.toggle('hidden', n !== 4);
            [1,2,3,4].forEach(i => document.getElementById('t'+i).classList.toggle('active', n === i));
        }
        function tglM() { if(mOn) mus.pause(); else mus.play(); mOn = !mOn; document.getElementById('m-btn').innerText = mOn ? "🔊 МУЗЫКА: ВКЛ" : "🔊 МУЗЫКА: ВЫКЛ"; }
        function cp(t) { navigator.clipboard.writeText(t); tg.showAlert("Скопировано!"); }
        setInterval(sync, 5000); sync();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log("SERVER READY"));
