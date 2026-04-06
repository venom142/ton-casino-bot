const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

// === КОНФИГУРАЦИЯ ===
const WALLET = "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn"; 
const BOT_TOKEN = process.env.BOT_TOKEN;
// Твоя исправленная ссылка с паролем zetatop123
const MONGO_URI = "mongodb+srv://sv2951605_db_user:zetatop123@cluster0.k5dri5s.mongodb.net/?appName=Cluster0";

// === ПОДКЛЮЧЕНИЕ К БАЗЕ ===
mongoose.connect(MONGO_URI)
    .then(() => console.log(">>> БАЗА ДАННЫХ ПОДКЛЮЧЕНА [OK]"))
    .catch(e => console.log(">>> ОШИБКА АВТОРИЗАЦИИ БД:", e.message));

const User = mongoose.model('User', { uid: String, balance: { type: Number, default: 0.10 }, s: { type: Number, default: 0 }, w: { type: Number, default: 0 } });
const Tx = mongoose.model('Tx', { hash: String });

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
app.use(express.json());

// === СКАНЕР ТРАНЗАКЦИЙ TON ===
async function scan() {
    try {
        const res = await axios.get(`https://toncenter.com/api/v2/getTransactions?address=${WALLET}&limit=10`);
        if (!res.data.result) return;
        for (let tx of res.data.result) {
            const h = tx.transaction_id.hash;
            const m = tx.in_msg?.message;
            if (m && m.startsWith("ID_")) {
                if (await Tx.findOne({ hash: h })) continue;
                const uid = m.split("_")[1];
                const u = await User.findOne({ uid });
                if (u) {
                    u.balance += tx.in_msg.value / 1e9;
                    await u.save(); await new Tx({ hash: h }).save();
                    bot.sendMessage(uid, "💎 **БАЛАНС ПОПОЛНЕН!**\nУдачи в неоновом зале!");
                }
            }
        }
    } catch (e) {}
}
setInterval(scan, 60000);

bot.onText(/\/start/, async (m) => {
    const uid = m.chat.id.toString();
    if (!await User.findOne({ uid })) await new User({ uid }).save();
    bot.sendMessage(uid, "🎰 **ДОБРО ПОЖАЛОВАТЬ В NEON TON CASINO**", {
        reply_markup: { inline_keyboard: [[{ text: "🚀 ЗАПУСТИТЬ ИГРУ", web_app: { url: "https://ton-casino-bot.onrender.com" } }]] }
    });
});

// === API ===
app.post('/api/init', async (req, res) => {
    try {
        const u = await User.findOne({ uid: req.body.uid.toString() }) || await new User({ uid: req.body.uid.toString() }).save();
        res.json(u);
    } catch (e) { res.status(500).json({err: "Ошибка БД"}); }
});

app.post('/api/spin', async (req, res) => {
    try {
        const u = await User.findOne({ uid: req.body.uid.toString() });
        if (!u || u.balance < 0.05) return res.json({ err: "НЕДОСТАТОЧНО TON" });
        u.balance = Number((u.balance - 0.05).toFixed(2)); u.s += 1;
        const s = ['🍒','7️⃣','💎','💰','⭐','🎱'];
        const r = [s[Math.floor(Math.random()*6)], s[Math.floor(Math.random()*6)], s[Math.floor(Math.random()*6)]];
        let win = 0; if (r[0] === r[1] && r[1] === r[2]) { win = 0.5; u.balance += win; u.w += 1; }
        await u.save(); res.json({ r, win, b: u.balance, s: u.s, w: u.w });
    } catch (e) { res.json({err: "Ошибка сервера"}); }
});

// === ИНТЕРФЕЙС (NEON STYLE + РУССКИЙ ЯЗЫК) ===
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        :root { --neon-p: #ff00ff; --neon-b: #00d4ff; --bg: #03001c; }
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        body { background: var(--bg); color: #fff; font-family: sans-serif; margin: 0; padding: 15px; text-align: center; height: 100vh; position: relative; overflow: hidden; }
        
        /* Сетка Retrowave */
        body::before { content: ''; position: absolute; top:0; left:0; width:100%; height:100%; background: linear-gradient(0deg, #110029, rgba(3,0,28,0.5) 40%, var(--bg)), url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><path d="M0,0H60V60H0V0ZM1,1V59H59V1H1V1Z" fill="rgba(110,0,255,0.15)"/></svg>'); z-index: -1; transform: perspective(100vh) rotateX(50deg) translateY(-15%); }
        .sun { position: absolute; width: 140px; height: 140px; top: 10px; left: 50%; transform: translateX(-50%); border-radius: 50%; background: linear-gradient(to bottom, #ffe100, #ff006a, var(--bg)); z-index: -1; box-shadow: 0 0 40px #ff006a44; }

        .card { background: rgba(10,5,30,0.85); padding: 15px; border-radius: 20px; border: 1px solid var(--neon-p); box-shadow: 0 0 20px #ff00ff22; margin-bottom: 15px; backdrop-filter: blur(8px); }
        .bal { font-size: 48px; font-weight: 900; color: #fff; text-shadow: 0 0 10px var(--neon-b); margin: 5px 0; }
        
        .reels { display: flex; justify-content: center; gap: 8px; margin: 25px 0; }
        .reel { width: 30%; height: 100px; background: #000; border-radius: 15px; font-size: 45px; display: flex; align-items: center; justify-content: center; border: 2px solid var(--neon-b); box-shadow: 0 0 15px #00d4ff33; }

        .btn { width: 100%; border: none; font-size: 22px; font-weight: bold; padding: 22px; border-radius: 40px; text-transform: uppercase; margin-bottom: 10px; transition: 0.2s; }
        .btn-spin { background: linear-gradient(135deg, var(--neon-p), #6e00ff); color: #fff; box-shadow: 0 0 25px #ff00ff66; border: 1px solid #fff; }
        .btn-dep { background: rgba(0,212,255,0.1); border: 1px solid var(--neon-b); color: var(--neon-b); font-size: 16px; }
        .btn:active { transform: scale(0.96); opacity: 0.8; }

        .nav { display: flex; gap: 5px; margin-top: 15px; }
        .tab { flex: 1; padding: 12px; background: rgba(0,0,0,0.6); border-radius: 12px; border: 1px solid #222; font-size: 13px; color: #888; }
        .tab.active { border-color: var(--neon-p); color: #fff; background: rgba(255,0,255,0.1); }

        .modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.95); display: none; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
        .m-cnt { background: #0a051e; width: 100%; padding: 25px; border-radius: 25px; border: 1px solid var(--neon-b); text-align: left; }
        .copy-box { background: #000; padding: 15px; border-radius: 12px; margin: 10px 0; border: 1px solid #333; color: var(--neon-b); font-family: monospace; word-break: break-all; }
        
        .hidden { display: none !important; }
    </style>
</head>
<body>
    <audio id="mus" loop src="https://files.catbox.moe/78surr.mp3"></audio>
    <div class="sun"></div>

    <div id="p-game">
        <div class="card">
            <div style="font-size:11px; opacity:0.6; letter-spacing:1px;">БАЛАНС TON</div>
            <div class="bal" id="v-bal">0.00</div>
        </div>
        <div class="reels">
            <div class="reel" id="r1">💎</div><div class="reel" id="r2">💎</div><div class="reel" id="r3">💎</div>
        </div>
        <button class="btn btn-spin" onclick="spin()">КРУТИТЬ (0.05)</button>
        <button class="btn btn-dep" onclick="shMod(1)">ПОПОЛНИТЬ</button>
        <button onclick="tglM()" id="m-btn" style="background:none; border:none; color:var(--neon-b); font-size: 11px; width:100%; opacity:0.6;">МУЗЫКА: ВЫКЛ</button>
    </div>

    <div id="p-info" class="hidden">
        <div class="card" style="text-align: left;">
            <h3 style="margin:0 0 15px 0; color:var(--neon-p);">СТАТИСТИКА</h3>
            <div style="display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px solid #222;">Всего игр:<span id="v-s">0</span></div>
            <div style="display:flex; justify-content:space-between; padding:10px 0;">Всего побед:<span id="v-w" style="color:#28a745;">0</span></div>
            <p style="font-size:12px; color:#555; margin-top:20px;">Поддержка: @venom142</p>
        </div>
    </div>

    <div class="nav">
        <div class="tab active" id="t1" onclick="sw(1)">ИГРА</div>
        <div class="tab" id="t2" onclick="sw(2)">ИНФО</div>
    </div>

    <div class="modal" id="mod">
        <div class="m-cnt">
            <h2 style="margin:0; color:#fff;">ДЕПОЗИТ</h2>
            <p style="font-size:12px; color:#888;">Адрес кошелька (нажми):</p>
            <div class="copy-box" onclick="cp('${WALLET}')">${WALLET}</div>
            <p style="font-size:12px; color:#ff4444; font-weight:bold; margin-top:20px;">КОММЕНТАРИЙ (ОБЯЗАТЕЛЬНО):</p>
            <div class="copy-box" id="v-cid" style="font-size:22px; color:#fff;" onclick="cp(this.innerText)">ID_...</div>
            <button onclick="shMod(0)" style="width:100%; padding:15px; border:none; border-radius:15px; background:#222; color:#fff; margin-top:20px;">ЗАКРЫТЬ</button>
        </div>
    </div>

    <script>
        const tg = window.Telegram.WebApp; tg.expand();
        const uid = tg.initDataUnsafe?.user?.id || "USER";
        const mu = document.getElementById('mus'); let mOn = false;

        async function init() {
            try {
                const r = await fetch('/api/init', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({uid}) });
                const d = await r.json(); upd(d);
            } catch(e) { console.log("БД еще грузится..."); }
        }

        function upd(d) {
            document.getElementById('v-bal').innerText = d.balance.toFixed(2);
            document.getElementById('v-s').innerText = d.s || 0;
            document.getElementById('v-w').innerText = d.w || 0;
            document.getElementById('v-cid').innerText = 'ID_' + uid;
        }

        async function spin() {
            tg.HapticFeedback.impactOccurred('medium');
            const r = await fetch('/api/spin', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({uid}) });
            const d = await r.json(); if(d.err) return tg.showAlert(d.err);
            
            let c = 0;
            const reels = [document.getElementById('r1'),document.getElementById('r2'),document.getElementById('r3')];
            const a = setInterval(() => {
                const sym = ['🍒','7️⃣','💎','💰','⭐','🎱'];
                reels.forEach(re => re.innerText = sym[Math.floor(Math.random()*6)]);
                if(c++ > 15) {
                    clearInterval(a);
                    reels[0].innerText = d.r[0]; reels[1].innerText = d.r[1]; reels[2].innerText = d.r[2];
                    upd(d); if(d.win > 0) { tg.HapticFeedback.notificationOccurred('success'); tg.showAlert("ВЫИГРЫШ! +0.50 TON"); }
                }
            }, 60);
        }

        function sw(n) {
            document.getElementById('p-game').classList.toggle('hidden', n !== 1);
            document.getElementById('p-info').classList.toggle('hidden', n !== 2);
            document.getElementById('t1').classList.toggle('active', n === 1);
            document.getElementById('t2').classList.toggle('active', n === 2);
        }
        function shMod(s) { document.getElementById('mod').style.display = s ? 'flex' : 'none'; }
        function cp(t) { navigator.clipboard.writeText(t); tg.showAlert("Скопировано!"); }
        function tglM() {
            if(mOn) { mu.pause(); document.getElementById('m-btn').innerText="МУЗЫКА: ВЫКЛ"; }
            else { mu.play(); document.getElementById('m-btn').innerText="МУЗЫКА: ВКЛ"; }
            mOn = !mOn;
        }
        init();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log("СЕРВЕР ЗАПУЩЕН"));
