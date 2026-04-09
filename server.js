const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 10000;

// === КОНФИГ ===
const WALLET = "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn"; 
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = "mongodb+srv://sv2951605_db_user:zetatop123@cluster0.k5dri5s.mongodb.net/ton_casino?retryWrites=true&w=majority";
const ADMIN_ID = 8475323865; 

// Подключение к БД с фиксом ошибок таймаута
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("🚀 DB CONNECTED"))
    .catch((e) => console.log("❌ DB ERROR:", e.message));

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

// === БОТ И АДМИНКА ===
bot.onText(/\/start/, async (m) => {
    let u = await User.findOne({ uid: m.from.id.toString() }) || await new User({ uid: m.from.id.toString() }).save();
    bot.sendMessage(m.chat.id, `💎 VIP TON ХОТ ТАП 💎\n\n💰 Баланс: ${u.balance.toFixed(2)} TON`, {
        reply_markup: { inline_keyboard: [[{ text: "🚀 ИГРАТЬ", web_app: { url: "https://ton-casino-bot.onrender.com" } }]] }
    });
});

bot.onText(/\/addpromo (.+) (.+) (.+)/, async (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;
    const code = match[1].toUpperCase();
    const amount = parseFloat(match[2]);
    const limit = parseInt(match[3]);
    try {
        await new Promo({ code, amount, limit }).save();
        bot.sendMessage(msg.chat.id, `✅ Код ${code} создан (${amount} TON)`);
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ Ошибка"); }
});

// === СКАНЕР ТРАНЗАКЦИЙ ===
setInterval(async () => {
    try {
        const res = await axios.get(`https://toncenter.com/api/v2/getTransactions?address=${WALLET}&limit=10`);
        for (let tx of res.data.result) {
            const h = tx.transaction_id.hash;
            const m = tx.in_msg?.message;
            const val = tx.in_msg.value / 1e9;
            if (m && m.startsWith("ID_")) {
                if (await Tx.findOne({ hash: h })) continue;
                const uid = m.split("_")[1];
                const u = await User.findOne({ uid });
                if (u && val >= 0.01) {
                    u.balance += val;
                    await u.save(); await new Tx({ hash: h }).save();
                    bot.sendMessage(u.uid, `💎 Зачислено +${val} TON!`);
                }
            }
        }
    } catch (e) {}
}, 20000);

// === API ДЛЯ ИГРЫ ===
app.post('/api/sync', async (req, res) => {
    const u = await User.findOne({ uid: req.body.uid.toString() }) || await new User({ uid: req.body.uid.toString() }).save();
    res.json(u);
});

app.post('/api/spin', async (req, res) => {
    const { uid, bet } = req.body;
    const bV = parseFloat(bet);
    const u = await User.findOne({ uid: uid.toString() });
    if (!u || u.balance < bV) return res.json({ err: "МАЛО TON" });

    u.balance -= bV; u.s += 1;
    const syms = ['🍒','7️⃣','💎','💰','⭐','🎱'];
    const r = [syms[Math.floor(Math.random()*6)], syms[Math.floor(Math.random()*6)], syms[Math.floor(Math.random()*6)]];
    let win = (r[0] === r[1] && r[1] === r[2]) ? (bV * 10) : 0;
    if(win > 0) { u.balance += win; u.w += 1; }
    await u.save(); 
    res.json({ r, win, balance: u.balance, s: u.s, w: u.w });
});

// === ВЕБ-ИНТЕРФЕЙС ===
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; margin: 0; padding: 0; }
        body { height: 100vh; overflow: hidden; background: #0a0a1a; color: #fff; font-family: 'Segoe UI', sans-serif; display: flex; flex-direction: column; }
        
        .nav-top { display: flex; gap: 8px; padding: 15px; background: rgba(0,0,0,0.3); }
        .tab { flex: 1; padding: 12px; background: #1a1a2e; border: 1px solid #333; border-radius: 12px; font-size: 11px; font-weight: 800; color: #666; text-align: center; transition: 0.3s; }
        .tab.active { border-color: #f0f; color: #fff; background: rgba(255,0,255,0.1); box-shadow: 0 0 10px rgba(255,0,255,0.3); }

        .main { flex: 1; display: flex; flex-direction: column; justify-content: space-around; padding: 20px; }
        .card { background: rgba(255,255,255,0.05); border: 1px solid rgba(0,255,255,0.3); padding: 20px; border-radius: 20px; text-align: center; }
        .bal { font-size: 48px; font-weight: 900; color: #0ff; text-shadow: 0 0 15px #0ff; }
        
        .reels { display: flex; justify-content: center; gap: 10px; margin: 20px 0; }
        .slot { width: 90px; height: 100px; background: #000; border: 2px solid #f0f; border-radius: 15px; display: flex; align-items: center; justify-content: center; font-size: 50px; transition: 0.1s; }
        
        .btn-spin { width: 100%; padding: 20px; border-radius: 20px; border: none; background: linear-gradient(135deg, #f0f, #60f); color: #fff; font-size: 22px; font-weight: 900; box-shadow: 0 5px 20px rgba(255,0,255,0.4); }
        .btn-spin:active { transform: scale(0.98); }
        
        .copy-box { background: #111; padding: 12px; border-radius: 10px; font-family: monospace; font-size: 12px; color: #0ff; border: 1px solid #333; margin-top: 10px; cursor: pointer; }
        .hidden { display: none !important; }
    </style>
</head>
<body>
    <audio id="mus" loop src="https://files.catbox.moe/78surr.mp3"></audio>
    <div class="nav-top">
        <div class="tab active" onclick="sw(1)" id="t1">ИГРА</div>
        <div class="tab" onclick="sw(2)" id="t2">ДЕПОЗИТ</div>
        <div class="tab" onclick="sw(3)" id="t3">ИНФО</div>
        <div class="tab" onclick="sw(4)" id="t4">ОПЦИИ</div>
    </div>

    <div class="main">
        <div id="p-game">
            <div class="card"><p style="font-size:12px; opacity:0.6;">БАЛАНС TON</p><div class="bal" id="v-bal">0.00</div></div>
            <div class="reels">
                <div class="slot" id="s1">💎</div><div class="slot" id="s2">🍒</div><div class="slot" id="s3">🔥</div>
            </div>
            <button id="spin-btn" class="btn-spin" onclick="spin()">КРУТИТЬ (0.1)</button>
        </div>

        <div id="p-dep" class="hidden">
            <div class="card" style="text-align:left;">
                <h3 style="color:#0ff">ДЕПОЗИТ</h3>
                <p style="font-size:12px; margin-top:10px;">Отправьте TON на адрес:</p>
                <div class="copy-box" onclick="cp('${WALLET}')">${WALLET}</div>
                <p style="font-size:12px; margin-top:10px;">С комментарием (ОБЯЗАТЕЛЬНО):</p>
                <div class="copy-box" id="v-cid" onclick="cp(this.innerText)">ID_...</div>
            </div>
        </div>

        <div id="p-info" class="hidden">
            <div class="card" style="text-align:left;">
                <h3>СТАТЫ</h3>
                <p id="v-s">Игр: 0</p><p id="v-w">Побед: 0</p>
            </div>
        </div>

        <div id="p-opt" class="hidden">
            <button class="btn-spin" style="margin-bottom:10px;" onclick="tM()" id="m-btn">МУЗЫКА: OFF</button>
            <button class="btn-spin" style="background:#0ff; color:#000;" onclick="aP()">ПРОМОКОД</button>
        </div>
    </div>

    <script>
        const tg = window.Telegram.WebApp; tg.expand();
        const uid = tg.initDataUnsafe?.user?.id || "8475323865";
        let mO = false;

        async function sync(){
            const r = await fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid})});
            const d = await r.json();
            document.getElementById('v-bal').innerText = d.balance.toFixed(2);
            document.getElementById('v-s').innerText = 'Игр: '+d.s;
            document.getElementById('v-w').innerText = 'Побед: '+d.w;
            document.getElementById('v-cid').innerText = 'ID_'+uid;
        }

        async function spin(){
            const btn = document.getElementById('spin-btn'); btn.disabled = true;
            const r = await fetch('/api/spin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid, bet: 0.1})});
            const d = await r.json();
            if(d.err) { tg.showAlert(d.err); btn.disabled = false; return; }

            const iv = setInterval(()=>{
                document.getElementById('s1').innerText = ['🍒','7️⃣','💎','💰','⭐','🎱'][Math.floor(Math.random()*6)];
                document.getElementById('s2').innerText = ['🍒','7️⃣','💎','💰','⭐','🎱'][Math.floor(Math.random()*6)];
                document.getElementById('s3').innerText = ['🍒','7️⃣','💎','💰','⭐','🎱'][Math.floor(Math.random()*6)];
            }, 100);

            setTimeout(()=>{
                clearInterval(iv);
                document.getElementById('s1').innerText = d.r[0];
                document.getElementById('s2').innerText = d.r[1];
                document.getElementById('s3').innerText = d.r[2];
                sync(); btn.disabled = false;
                if(d.win > 0) tg.showAlert("ВИН! +"+d.win+" TON");
            }, 2000);
        }

        function sw(n){
            document.getElementById('p-game').classList.toggle('hidden',n!==1);
            document.getElementById('p-dep').classList.toggle('hidden',n!==2);
            document.getElementById('p-info').classList.toggle('hidden',n!==3);
            document.getElementById('p-opt').classList.toggle('hidden',n!==4);
            [1,2,3,4].forEach(i=>document.getElementById('t'+i).classList.toggle('active',n===i));
        }

        function tM(){ 
            const m = document.getElementById('mus');
            if(mO){ m.pause(); document.getElementById('m-btn').innerText="МУЗЫКА: OFF"; }
            else { m.play(); document.getElementById('m-btn').innerText="МУЗЫКА: ON"; }
            mO = !mO;
        }

        function cp(t){ navigator.clipboard.writeText(t); tg.showAlert("Скопировано!"); }
        sync();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log("SERVER READY ON PORT " + PORT));
