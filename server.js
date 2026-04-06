const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

// === CONFIG (Твои данные!) ===
const WALLET = "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn"; 
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;

// === DATABASE CONNECTION ===
mongoose.connect(MONGO_URI)
    .then(() => console.log(">>> DATABASE OK"))
    .catch(e => console.log(">>> DATABASE ERR:", e.message));

// Модели
const User = mongoose.model('User', { uid: String, balance: { type: Number, default: 0.10 }, s: { type: Number, default: 0 }, w: { type: Number, default: 0 } });
const Tx = mongoose.model('Tx', { hash: String });

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
app.use(express.json());

// === С К А Н Е Р Т Р А Н З А К Ц И Й TON ===
async function scan() {
    try {
        const res = await axios.get(`https://toncenter.com/api/v2/getTransactions?address=${WALLET}&limit=10`);
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
                    bot.sendMessage(uid, "💎 **БАЛАНС ПОПОЛНЕН!**\nУдачи в игре!");
                }
            }
        }
    } catch (e) {}
}
setInterval(scan, 60000);

// === Л О Г И К А Б О Т А ===
bot.onText(/\/start/, async (m) => {
    const uid = m.chat.id.toString();
    if (!await User.findOne({ uid })) await new User({ uid }).save();
    bot.sendMessage(uid, "🎰 **VIP TON CASINO (RETROWAVE)**", {
        reply_markup: { inline_keyboard: [[{ text: "🚀 ВОЙТИ В ЗАЛ", web_app: { url: "https://ton-casino-bot.onrender.com" } }]] }
    });
});

// === A P I Д Л Я И Г Р Ы ===
app.post('/api/init', async (req, res) => {
    const u = await User.findOne({ uid: req.body.uid.toString() }) || await new User({ uid: req.body.uid.toString() }).save();
    res.json(u);
});

app.post('/api/spin', async (req, res) => {
    const u = await User.findOne({ uid: req.body.uid.toString() });
    if (!u || u.balance < 0.05) return res.json({ err: "МАЛО TON" });
    u.balance = Number((u.balance - 0.05).toFixed(2)); u.s += 1;
    const s = ['🍒','7️⃣','💎','💰','⭐','🎱'];
    const r = [s[Math.floor(Math.random()*6)], s[Math.floor(Math.random()*6)], s[Math.floor(Math.random()*6)]];
    let win = 0; if (r[0] === r[1] && r[1] === r[2]) { win = 0.5; u.balance += win; u.w += 1; }
    await u.save(); res.json({ r, win, b: u.balance, s: u.s, w: u.w });
});

// === U I (RETROWAVE EDITION) ===
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        :root { --neon-p: #ff00ff; --neon-b: #00d4ff; --neon-y: #ffd700; --bg: #03001c; }
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        body { background: var(--bg); color: #fff; font-family: 'Segoe UI', system-ui, sans-serif; margin: 0; padding: 20px; text-align: center; overflow: hidden; height: 100vh; position: relative; }
        
        /* Неоновая сетка фона */
        body::before { content: ''; position: absolute; top:0; left:0; width:100%; height:100%; background: linear-gradient(0deg, #110029, rgba(3,0,28,0.7) 30%, var(--bg)), url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path d="M0,0H100V100H0V0ZM1,1V99H99V1H1V1Z" fill="rgba(110,0,255,0.2)"/></svg>'); z-index: -1; transform: perspective(100vh) rotateX(45deg) translateY(-20%); }

        /* Элементы дизайна (Пальмы и Солнце) */
        .decor { position: absolute; z-index: -1; pointer-events: none; }
        .sun { width: 150px; height: 150px; top: 20px; left: 50%; transform: translateX(-50%); border-radius: 50%; background: linear-gradient(to bottom, #ffe100, #ff006a, var(--bg)); box-shadow: 0 0 50px #ff006a33; }
        .palm-l { width: 60px; height: 100px; bottom: 100px; left: 10px; opacity: 0.3; }
        .palm-r { width: 60px; height: 100px; bottom: 100px; right: 10px; opacity: 0.3; transform: scaleX(-1); }

        /* Основные карточки */
        .card { background: rgba(10,5,30,0.8); padding: 20px; border-radius: 20px; border: 1px solid var(--neon-p); box-shadow: 0 0 30px #ff00ff22; margin-bottom: 20px; backdrop-filter: blur(5px); }
        .lbl { font-size: 11px; color: #a0a0a0; text-transform: uppercase; letter-spacing: 1px; }
        .bal { font-size: 52px; color: #fff; font-weight: 900; line-height: 1; margin: 10px 0; text-shadow: 0 0 10px var(--neon-b), 0 0 3px #fff; }

        /* Барабаны (супер-неон) */
        .reels { display: flex; justify-content: center; gap: 10px; margin: 40px 0; position: relative; }
        .reel { width: 85px; height: 110px; background: rgba(0,0,0,0.5); border-radius: 15px; font-size: 45px; display: flex; align-items: center; justify-content: center; border: 2px solid var(--neon-b); box-shadow: 0 0 20px #00d4ff1a; overflow: hidden; position: relative; }
        .reel::after { content:''; position:absolute; top:0; left:0; width:100%; height:100%; background: linear-gradient(to bottom, transparent, rgba(0,212,255,0.05) 50%, transparent); animation: sweep 2s infinite; }

        /* Кнопки */
        .btn { width: 100%; border: none; font-size: 20px; font-weight: bold; padding: 20px; border-radius: 40px; text-transform: uppercase; cursor: pointer; transition: 0.2s; box-shadow: 0 10px 30px rgba(0,0,0,0.3); }
        .btn-spin { background: linear-gradient(135deg, var(--neon-p), #6e00ff); color: #fff; border: 1px solid #fff; box-shadow: 0 0 20px #ff00ff44; }
        .btn-spin:active { transform: scale(0.97); box-shadow: 0 0 5px #ff00ff11; }
        .btn-dep { background: rgba(30,212,255,0.05); border: 1px solid var(--neon-b); color: var(--neon-b); margin-top: 15px; padding: 15px; }

        /* Навигация */
        .nav { display: flex; gap: 4px; margin-top: 25px; }
        .tab { flex: 1; padding: 10px; background: rgba(10,5,30,0.5); text-align: center; font-size: 12px; color: #888; border-radius: 12px; border: 1px solid #1a1a1a; }
        .tab.active { border-color: var(--neon-p); color: #fff; background: rgba(255,0,255,0.05); font-weight: bold; }

        /* Модалка (NANO-STYLE) */
        .hidden { display: none !important; }
        .modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: #000; display: none; align-items: center; justify-content: center; z-index: 100; padding: 25px; }
        .copy { background: #111; border: 1px solid #333; padding: 15px; border-radius: 12px; font-size: 12px; margin: 15px 0; color: var(--neon-b); word-break: break-all; text-align: left; position: relative; }
        .copy::after { content: 'TAP'; position: absolute; bottom: 2px; right: 5px; font-size: 8px; opacity: 0.3; color: var(--neon-b); }
        .btn-close { background: none; border: 1px solid #ff4444; color: #ff4444; padding: 10px 20px; border-radius: 10px; margin-top: 20px; }

        @keyframes sweep { 0% { top: -100%; } 100% { top: 100%; } }
    </style>
</head>
<body>
    <audio id="mus" loop src="https://files.catbox.moe/78surr.mp3"></audio>

    <div class="decor sun"></div>
    <img class="decor palm-l" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAAsTAAALEwEAmpwYAAABHklEQVR4nO2WsW6DQAxFn///f2W4pT8w9Aeg4W7Bggw9506wIEvS5bW4BfL99vV6EAAAAAAAAAAAAAAAAAAAAAAA/sA6wB78G+j7vY993/fc94+9EwAAsFngWwIAAAAAAAAAAAAAAAAAAPADpIA5KABwA5iDAgA3gDkoAHADmIMCADeAOShb4FvU5f6XAn8VwBwUAAAAAAAAAAAAAAAAAAAA5pXgHwXwHygFAAAAAAAAAAAAAAAAAAAAAOYfAXYAAAAAAAAAAAAAAAAAAAAA4BbwSgKAAAAAAAAAAAAAAAAAAAAAzC/BOwrgPywFAAAAAOYXALgBwAzwSwHAAAAAAAAAAAAAAAAsAb4UAAAAAAAAADAzgDkoAHADmIMCADeAOShb4FvU5b565X7V8wAAAAAAAAAAAAAAAAAAAACY91/v9567v/e+9/7v79q/HwAAAAAAAAAAAAAAAAAAAAB8AYp0A95UAAAAAAAAAAAAADXUFAAAAAAAAACN8G+g7vY993/fc94+9EwAAsFngGygAAAAAAAAAAAAAAAAAAEBngT99n7v7e+9//wXNzgAAAAAAAABq5QAAAAA" alt="palm">
    <img class="decor palm-r" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAAsTAAALEwEAmpwYAAABHklEQVR4nO2WsW6DQAxFn///f2W4pT8w9Aeg4W7Bggw9506wIEvS5bW4BfL99vV6EAAAAAAAAAAAAAAAAAAAAAAA/sA6wB78G+j7vY993/fc94+9EwAAsFngWwIAAAAAAAAAAAAAAAAAAPADpIA5KABwA5iDAgA3gDkoAHADmIMCADeAOShb4FvU5f6XAn8VwBwUAAAAAAAAAAAAAAAAAAAA5pXgHwXwHygFAAAAAAAAAAAAAAAAAAAAAOYfAXYAAAAAAAAAAAAAAAAAAAAA4BbwSgKAAAAAAAAAAAAAAAAAAAAAzC/BOwrgPywFAAAAAOYXALgBwAzwSwHAAAAAAAAAAAAAAAAsAb4UAAAAAAAAADAzgDkoAHADmIMCADeAOShb4FvU5b565X7V8wAAAAAAAAAAAAAAAAAAAACY91/v9567v/e+9/7v79q/HwAAAAAAAAAAAAAAAAAAAAB8AYp0A95UAAAAAAAAAAAAADXUFAAAAAAAAACN8G+g7vY993/fc94+9EwAAsFngGygAAAAAAAAAAAAAAAAAAEBngT99n7v7e+9//wXNzgAAAAAAAABq5QAAAAA" alt="palm">

    <div id="g-page">
        <div class="card">
            <span class="lbl">VIP TON BALANCE</span>
            <div class="bal" id="v-bal">0.00</div>
            <span style="font-size:12px; color: #fff;">TON</span>
        </div>
        <div class="reels">
            <div class="reel" id="r1">🎱</div><div class="reel" id="r2">🎱</div><div class="reel" id="r3">🎱</div>
        </div>
        <button class="btn btn-spin" onclick="spin()">SPIN (0.05)</button>
        <button class="btn btn-dep" onclick="shMod(1)">DEPOSIT FUNDS</button>
        <button onclick="tglM()" id="m-btn" style="background:none; border:none; color:var(--neon-b); font-size: 11px; margin-top: 10px; width:100%;">Atmosphere Audio: OFF</button>
    </div>

    <div id="i-page" class="hidden">
        <div class="card" style="text-align: left;">
            <h3 style="margin:0 0 15px 0; border-bottom:1px solid #222; padding-bottom:10px;">PROTOCOL STATISTICS</h3>
            <p>Spins total:<span style="color:#fff; float:right;" id="v-s">0</span></p>
            <p>Wins total:<span style="color:#28a745; float:right;" id="v-w">0</span></p>
            <p>Protocol:<a href="https://t.me/venom142" style="color:var(--neon-b); text-decoration:none; float:right;">@venom142</a></p>
        </div>
    </div>

    <div class="nav">
        <div class="tab active" id="t1" onclick="sw(1)">DAPP</div>
        <div class="tab" id="t2" onclick="sw(2)">INFO</div>
    </div>

    <div class="modal" id="mod">
        <div class="m-cnt" style="text-align: left;">
            <h3 style="margin-top:0;">VIP DEPOSIT</h3>
            <p class="lbl">Network Wallet Address:</p>
            <div class="copy" onclick="cp('${WALLET}')">${WALLET}</div>
            <p class="lbl" style="color:#ff4444; font-weight:bold; margin-top:20px;">Required Comment (CRITICAL):</p>
            <div class="copy" id="v-cid" style="font-size:22px; color:#fff;" onclick="cp(this.innerText)">ID_...</div>
            <button class="btn-close" onclick="shMod(0)">[ABORT WINDOW]</button>
        </div>
    </div>

    <script>
        const tg = window.Telegram.WebApp; tg.expand();
        const uid = tg.initDataUnsafe?.user?.id || "USER";
        const mu = document.getElementById('mus'); let mOn = false;

        async function init() {
            const r = await fetch('/api/init', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({uid}) });
            const d = await r.json(); upd(d);
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
            
            let c = 0; const reels = [document.getElementById('r1'),document.getElementById('r2'),document.getElementById('r3')];
            const a = setInterval(() => {
                const sym = ['🍒','7️⃣','💎','💰','🎱'];
                reels.forEach(re => re.innerText = sym[Math.floor(Math.random()*sym.length)]);
                if(c++ > 15) {
                    clearInterval(a);
                    reels[0].innerText = d.r[0]; reels[1].innerText = d.r[1]; reels[2].innerText = d.r[2];
                    upd(d); if(d.win > 0) { tg.HapticFeedback.notificationOccurred('success'); tg.showAlert("PROTOCOL: WIN!"); }
                }
            }, 60);
        }

        function sw(n) {
            document.getElementById('g-page').classList.toggle('hidden', n !== 1);
            document.getElementById('i-page').classList.toggle('hidden', n !== 2);
            document.getElementById('t1').classList.toggle('active', n === 1);
            document.getElementById('t2').classList.toggle('active', n === 2);
        }
        function shMod(s) { document.getElementById('mod').style.display = s ? 'flex' : 'none'; }
        function cp(t) { navigator.clipboard.writeText(t); tg.showAlert("COPIED!"); }
        function tglM() {
            if(mOn) { mu.pause(); document.getElementById('m-btn').innerText="Atmosphere Audio: OFF"; }
            else { mu.play(); document.getElementById('m-btn').innerText="Atmosphere Audio: ON"; }
            mOn = !mOn;
        }
        init();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log("OK"));
