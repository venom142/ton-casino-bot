const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

// === КОНФИГ ===
const WALLET = "UQCy28DFTxwwmUL (YOUR_WALLET_HERE)"; // Твой кошелек
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;

// === БАЗА ДАННЫХ ===
mongoose.connect(MONGO_URI)
    .then(() => console.log(">>> [DB] CONNECTED"))
    .catch(e => console.log(">>> [DB] ERR:", e.message));

const User = mongoose.model('User', {
    uid: { type: String, unique: true },
    balance: { type: Number, default: 0.10 },
    s: { type: Number, default: 0 }, // спины
    w: { type: Number, default: 0 }  // вины
});

const History = mongoose.model('History', { hash: String });

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
app.use(express.json());

// === СКАНЕР TON ===
async function scan() {
    try {
        const res = await axios.get(`https://toncenter.com/api/v2/getTransactions?address=${WALLET}&limit=10`);
        for (let tx of res.data.result) {
            const h = tx.transaction_id.hash;
            const m = tx.in_msg?.message;
            if (m && m.startsWith("ID_")) {
                if (await History.findOne({ hash: h })) continue;
                const uid = m.split("_")[1];
                const u = await User.findOne({ uid });
                if (u) {
                    u.balance += tx.in_msg.value / 1e9;
                    await u.save();
                    await new History({ hash: h }).save();
                    bot.sendMessage(uid, "✅ Баланс пополнен!");
                }
            }
        }
    } catch (e) {}
}
setInterval(scan, 60000);

// === БОТ ===
bot.onText(/\/start/, async (m) => {
    const uid = m.chat.id.toString();
    if (!await User.findOne({ uid })) await new User({ uid }).save();
    bot.sendMessage(uid, "🎰 **TON CASINO PRO**", {
        reply_markup: { inline_keyboard: [[{ text: "🚀 ИГРАТЬ", web_app: { url: "https://ton-casino-bot.onrender.com" } }]] }
    });
});

// === API ===
app.post('/api/init', async (req, res) => {
    const u = await User.findOne({ uid: req.body.uid.toString() }) || await new User({ uid: req.body.uid.toString() }).save();
    res.json(u);
});

app.post('/api/spin', async (req, res) => {
    const u = await User.findOne({ uid: req.body.uid.toString() });
    if (!u || u.balance < 0.05) return res.json({ err: "Мало TON" });
    
    u.balance = Number((u.balance - 0.05).toFixed(2));
    u.s += 1;

    const sym = ['💎', '💰', '7️⃣', '🍒', '⭐', '🔥'];
    const r = [sym[Math.floor(Math.random()*6)], sym[Math.floor(Math.random()*6)], sym[Math.floor(Math.random()*6)]];
    let win = 0;
    if (r[0] === r[1] && r[1] === r[2]) { win = 0.5; u.balance += win; u.w += 1; }
    
    await u.save();
    res.json({ r, win, b: u.balance, s: u.s, w: u.w });
});

// === ИНТЕРФЕЙС ===
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        :root { --blue: #38bdf8; --bg: #020617; --card: #0f172a; }
        body { background: var(--bg); color: #fff; font-family: sans-serif; margin: 0; padding: 15px; text-align: center; }
        .card { background: var(--card); padding: 20px; border-radius: 25px; border: 1px solid #1e293b; margin-bottom: 15px; }
        .bal { font-size: 45px; color: var(--blue); font-weight: 900; }
        .reels { display: flex; justify-content: center; gap: 10px; margin: 25px 0; }
        .reel { width: 80px; height: 100px; background: #000; border-radius: 20px; font-size: 40px; display: flex; align-items: center; justify-content: center; border: 2px solid #334155; }
        .btn { background: linear-gradient(135deg, var(--blue), #1d4ed8); border: none; color: #fff; padding: 18px; width: 100%; border-radius: 20px; font-size: 20px; font-weight: bold; }
        .btn:active { transform: scale(0.96); }
        .nav { display: flex; background: var(--card); border-radius: 20px; margin-top: 20px; padding: 5px; }
        .tab { flex: 1; padding: 10px; font-size: 12px; opacity: 0.5; }
        .tab.active { opacity: 1; color: var(--blue); font-weight: bold; }
        .modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.95); display: none; align-items: center; justify-content: center; z-index: 100; }
        .m-cnt { background: var(--card); width: 85%; padding: 25px; border-radius: 30px; border: 1px solid var(--blue); }
        .set-row { display: flex; justify-content: space-between; align-items: center; padding: 15px 0; border-bottom: 1px solid #1e293b; }
        .copy { background: #000; padding: 10px; border-radius: 10px; font-size: 11px; margin: 10px 0; color: var(--blue); word-break: break-all; }
        .hidden { display: none !important; }
    </style>
</head>
<body>
    <audio id="mus" loop src="https://files.catbox.moe/78surr.mp3"></audio>

    <div id="p-game">
        <div class="card">
            <div style="font-size: 11px; opacity: 0.5;">BALANCE</div>
            <div class="bal" id="v-bal">0.00</div>
        </div>
        <div class="reels">
            <div class="reel" id="r1">💎</div><div class="reel" id="r2">💎</div><div class="reel" id="r3">💎</div>
        </div>
        <button class="btn" onclick="spin()">SPIN (0.05)</button>
        <button class="btn" onclick="shMod(1)" style="background:#10b981; margin-top:10px;">ПОПОЛНИТЬ</button>
    </div>

    <div id="p-settings" class="hidden">
        <div class="card" style="text-align: left;">
            <h3 style="margin-top: 0;">НАСТРОЙКИ</h3>
            <div class="set-row">
                <span>Звук / Музыка</span>
                <button onclick="tglM()" id="m-btn" style="background:#1e293b; border:none; color:#fff; padding:5px 15px; border-radius:10px;">ВЫКЛ</button>
            </div>
            <div class="set-row">
                <span>Поддержка</span>
                <span style="color:var(--blue)">@venom142</span>
            </div>
        </div>
        <div class="card" style="text-align: left;">
            <h3 style="margin-top: 0;">СТАТИСТИКА</h3>
            <div class="set-row"><span>Всего игр:</span><span id="v-s">0</span></div>
            <div class="set-row"><span>Всего побед:</span><span id="v-w">0</span></div>
        </div>
    </div>

    <div class="nav">
        <div class="tab active" id="t1" onclick="sw(1)">🎰 ИГРА</div>
        <div class="tab" id="t2" onclick="sw(2)">⚙️ НАСТРОЙКИ</div>
    </div>

    <div class="modal" id="mod">
        <div class="m-cnt">
            <h3>ДЕПОЗИТ</h3>
            <div class="copy" onclick="cp('${WALLET}')">${WALLET}</div>
            <p style="color:#ef4444; font-size:12px;">КОММЕНТАРИЙ:</p>
            <div class="copy" id="v-cid" style="font-size:18px; color:#fff;" onclick="cp(this.innerText)">ID_...</div>
            <button onclick="shMod(0)" style="background:#334155; border:none; color:#fff; padding:10px; width:100%; border-radius:10px;">ЗАКРЫТЬ</button>
        </div>
    </div>

    <script>
        const tg = window.Telegram.WebApp;
        const uid = tg.initDataUnsafe?.user?.id || "666";
        const mu = document.getElementById('mus');
        let mOn = false;

        async function init() {
            const r = await fetch('/api/init', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({uid}) });
            const d = await r.json();
            upd(d);
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
            const d = await r.json();
            if(d.err) return tg.showAlert(d.err);
            
            let c = 0;
            const a = setInterval(() => {
                const s = ['🍒','7️⃣','💎','💰','⭐'];
                document.getElementById('r1').innerText = s[Math.floor(Math.random()*5)];
                document.getElementById('r2').innerText = s[Math.floor(Math.random()*5)];
                document.getElementById('r3').innerText = s[Math.floor(Math.random()*5)];
                if(c++ > 10) {
                    clearInterval(a);
                    document.getElementById('r1').innerText = d.r[0];
                    document.getElementById('r2').innerText = d.r[1];
                    document.getElementById('r3').innerText = d.r[2];
                    upd(d);
                    if(d.win > 0) { tg.HapticFeedback.notificationOccurred('success'); tg.showAlert("WIN! +0.50"); }
                }
            }, 70);
        }

        function sw(n) {
            document.getElementById('p-game').classList.toggle('hidden', n !== 1);
            document.getElementById('p-settings').classList.toggle('hidden', n !== 2);
            document.getElementById('t1').classList.toggle('active', n === 1);
            document.getElementById('t2').classList.toggle('active', n === 2);
        }
        function shMod(s) { document.getElementById('mod').style.display = s ? 'flex' : 'none'; }
        function cp(t) { navigator.clipboard.writeText(t); tg.showAlert("Скопировано!"); }
        function tglM() {
            if(mOn) { mu.pause(); document.getElementById('m-btn').innerText="ВЫКЛ"; }
            else { mu.play(); document.getElementById('m-btn').innerText="ВКЛ"; }
            mOn = !mOn;
        }
        init();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log(">>> SERVER LIVE"));
