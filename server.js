const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 10000;

// === БЕЗОПАСНЫЙ КОНФИГ ===
const WALLET = "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn"; 
const ADMIN_ID = 8475323865; 

// Тянем пароли из настроек Render (Environment Variables)
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;

// Подключение к БД
mongoose.connect(MONGO_URI)
    .then(() => console.log("🚀 БАЗА ПОДКЛЮЧЕНА"))
    .catch((e) => console.log("❌ ОШИБКА БАЗЫ:", e.message));

const User = mongoose.model('User', { 
    uid: String, 
    balance: { type: Number, default: 0.10 }, 
    s: { type: Number, default: 0 }, 
    w: { type: Number, default: 0 }
});

const Tx = mongoose.model('Tx', { hash: String });
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
app.use(express.json());

// === ЛОГИКА БОТА ===
bot.onText(/\/start/, async (m) => {
    let u = await User.findOne({ uid: m.from.id.toString() }) || await new User({ uid: m.from.id.toString() }).save();
    bot.sendMessage(m.chat.id, `💎 VIP TON ХОТ ТАП 💎\n\n💰 Баланс: ${u.balance.toFixed(2)} TON`, {
        reply_markup: { inline_keyboard: [[{ text: "🚀 ИГРАТЬ", web_app: { url: "https://ton-casino-bot.onrender.com" } }]] }
    });
});

// === API ИГРЫ ===
app.post('/api/sync', async (req, res) => {
    try {
        const u = await User.findOne({ uid: req.body.uid.toString() }) || await new User({ uid: req.body.uid.toString() }).save();
        res.json(u);
    } catch (e) { res.status(500).json({ error: "Ошибка БД" }); }
});

app.post('/api/spin', async (req, res) => {
    const { uid, bet } = req.body;
    const bV = parseFloat(bet) || 0.1;
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

// === ДИЗАЙН И ФРОНТЕНД ===
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; margin: 0; padding: 0; }
        body { height: 100vh; overflow: hidden; background: #05050a; color: #fff; font-family: sans-serif; display: flex; flex-direction: column; }
        
        .nav { display: flex; gap: 5px; padding: 10px; background: #111; border-bottom: 1px solid #333; }
        .tab { flex: 1; padding: 12px; background: #1a1a2e; border-radius: 10px; font-size: 10px; text-align: center; color: #666; font-weight: bold; }
        .tab.active { color: #fff; background: #a200ff; box-shadow: 0 0 15px rgba(162,0,255,0.4); }

        .main { flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 20px; gap: 20px; }
        .bal-card { width: 100%; background: rgba(255,255,255,0.05); border: 1px solid #0ff; padding: 25px; border-radius: 20px; text-align: center; }
        .bal-val { font-size: 50px; font-weight: 900; color: #0ff; text-shadow: 0 0 10px #0ff; }

        .reels { display: flex; gap: 10px; }
        .slot { width: 85px; height: 100px; background: #000; border: 2px solid #f0f; border-radius: 15px; display: flex; align-items: center; justify-content: center; font-size: 45px; }

        .btn-spin { width: 100%; max-width: 300px; padding: 20px; border-radius: 20px; border: none; background: linear-gradient(to right, #f0f, #7000ff); color: #fff; font-size: 22px; font-weight: 800; box-shadow: 0 5px 20px rgba(255,0,255,0.3); }
        .btn-spin:active { transform: scale(0.95); }
        
        .hidden { display: none; }
        .copy-box { background: #111; padding: 10px; border: 1px dashed #0ff; color: #0ff; font-family: monospace; font-size: 11px; margin-top: 5px; border-radius: 5px; }
    </style>
</head>
<body>
    <audio id="mus" loop src="https://files.catbox.moe/78surr.mp3"></audio>
    <div class="nav">
        <div class="tab active" onclick="sw(1)" id="t1">ИГРА</div>
        <div class="tab" onclick="sw(2)" id="t2">ДЕПОЗИТ</div>
        <div class="tab" onclick="sw(3)" id="t3">ОПЦИИ</div>
    </div>

    <div class="main" id="p1">
        <div class="bal-card">
            <p style="font-size:12px; color:#555">БАЛАНС TON</p>
            <div class="bal-val" id="v-bal">0.00</div>
        </div>
        <div class="reels">
            <div class="slot" id="s1">💎</div><div class="slot" id="s2">💎</div><div class="slot" id="s3">💎</div>
        </div>
        <button class="btn-spin" onclick="spin()" id="spin-btn">КРУТИТЬ</button>
    </div>

    <div class="main hidden" id="p2">
        <div class="bal-card" style="text-align:left">
            <h3 style="color:#0ff">ДЕПОЗИТ</h3>
            <p style="font-size:12px; margin-top:10px;">Адрес:</p>
            <div class="copy-box" onclick="cp('${WALLET}')">${WALLET}</div>
            <p style="font-size:12px; margin-top:10px;">Комментарий (ID):</p>
            <div class="copy-box" id="v-cid" onclick="cp(this.innerText)">ID_...</div>
        </div>
    </div>

    <div class="main hidden" id="p3">
        <button class="btn-spin" onclick="tM()" id="m-btn">МУЗЫКА: OFF</button>
    </div>

    <script>
        const tg = window.Telegram.WebApp; tg.expand();
        const uid = tg.initDataUnsafe?.user?.id || "8475323865";
        let playing = false;

        async function sync(){
            const r = await fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid})});
            const d = await r.json();
            document.getElementById('v-bal').innerText = d.balance.toFixed(2);
            document.getElementById('v-cid').innerText = 'ID_'+uid;
        }

        async function spin(){
            if(playing) return;
            playing = true;
            const res = await fetch('/api/spin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid, bet: 0.1})});
            const d = await res.json();
            if(d.err) { tg.showAlert(d.err); playing = false; return; }

            let i = 0;
            const iv = setInterval(()=>{
                document.getElementById('s1').innerText = ['🍒','7️⃣','💎','💰','⭐','🎱'][Math.floor(Math.random()*6)];
                document.getElementById('s2').innerText = ['🍒','7️⃣','💎','💰','⭐','🎱'][Math.floor(Math.random()*6)];
                document.getElementById('s3').innerText = ['🍒','7️⃣','💎','💰','⭐','🎱'][Math.floor(Math.random()*6)];
                i++; if(i>15) {
                    clearInterval(iv);
                    document.getElementById('s1').innerText = d.r[0];
                    document.getElementById('s2').innerText = d.r[1];
                    document.getElementById('s3').innerText = d.r[2];
                    sync(); playing = false;
                    if(d.win > 0) tg.showAlert("ВИН! +"+d.win+" TON");
                }
            }, 100);
        }

        function sw(n){
            [1,2,3].forEach(i=>{
                document.getElementById('p'+i).classList.toggle('hidden',i!==n);
                document.getElementById('t'+i).classList.toggle('active',i===n);
            });
        }

        function tM(){
            const a = document.getElementById('mus');
            if(a.paused){ a.play(); document.getElementById('m-btn').innerText="МУЗЫКА: ON"; }
            else { a.pause(); document.getElementById('m-btn').innerText="МУЗЫКА: OFF"; }
        }

        function cp(t){ navigator.clipboard.writeText(t); tg.showAlert("Скопировано!"); }
        sync();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log("SERVER ON " + PORT));
