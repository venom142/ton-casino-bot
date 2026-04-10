const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

// --- НАСТРОЙКИ С ТВОИМ КЛЮЧОМ ---
const WALLET = "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn"; 
const TONCENTER_API_KEY = "fe9429836fd2dfdb009421c6dc389840c9cdadca238477b4e2910250e11fa6d3"; 
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = "mongodb+srv://sv2951605_db_user:zetatop123@cluster0.k5dri5s.mongodb.net/?appName=Cluster0";
const ADMIN_ID = "8475323865"; 

mongoose.connect(MONGO_URI).then(() => console.log("DB: Connected"));

const User = mongoose.model('User', { 
    uid: String, balance: { type: Number, default: 0.10 },
    s: { type: Number, default: 0 }, w: { type: Number, default: 0 },
    last_lt: { type: String, default: "0" }
});

const bot = BOT_TOKEN ? new TelegramBot(BOT_TOKEN, { polling: true }) : null;
app.use(express.json());

// --- АВТО-ПОПОЛНЕНИЕ (С ТВОИМ API KEY) ---
async function scanTON() {
    try {
        const url = `https://toncenter.com/api/v2/getTransactions?address=${WALLET}&limit=5&api_key=${TONCENTER_API_KEY}`;
        const res = await axios.get(url);
        if (!res.data.ok) return;
        for (let tx of res.data.result) {
            const msg = tx.in_msg;
            if (!msg || !msg.message) continue;
            const amount = parseInt(msg.value) / 1e9;
            const uid_comm = msg.message.trim();
            const lt = tx.transaction_id.lt;
            const u = await User.findOne({ uid: uid_comm });
            if (u && lt > u.last_lt) {
                u.balance += amount; u.last_lt = lt; await u.save();
                if (bot) bot.sendMessage(u.uid, `💎 +${amount} TON зачислено на баланс!`);
            }
        }
    } catch (e) { console.log("TON Error:", e.message); }
}
setInterval(scanTON, 25000);

// --- API ЛОГИКА ---
app.post('/api/sync', async (req, res) => {
    let u = await User.findOne({ uid: req.body.uid.toString() }) || await new User({ uid: req.body.uid.toString() }).save();
    res.json(u);
});

app.post('/api/spin', async (req, res) => {
    const { uid, bet } = req.body;
    const u = await User.findOne({ uid: uid.toString() });
    if (!u || u.balance < bet) return res.json({ err: "МАЛО TON" });
    u.balance -= bet; u.s += 1;
    const syms = ['🍒','7️⃣','💎','💰','⭐'];
    let r = (Math.random() < 0.05) ? Array(3).fill(syms[Math.floor(Math.random()*5)]) : [syms[Math.floor(Math.random()*5)], syms[Math.floor(Math.random()*5)], syms[Math.floor(Math.random()*5)]];
    if(r[0]===r[1] && r[1]===r[2] && Math.random() > 0.05) r[2] = syms[(syms.indexOf(r[2])+1)%5];
    let win = (r[0]===r[1] && r[1]===r[2]) ? bet * 10 : 0;
    u.balance += win; if(win > 0) u.w += 1;
    await u.save(); res.json({ r, win, balance: u.balance });
});

app.post('/api/admin/broadcast', async (req, res) => {
    if(req.body.admin_id.toString() !== ADMIN_ID) return res.status(403).send("No");
    const users = await User.find();
    let count = 0;
    for (let u of users) { try { await bot.sendMessage(u.uid, req.body.text); count++; } catch(e) {} }
    res.json({ sent: count });
});

// --- ИНТЕРФЕЙС "КОНФЕТКА" ---
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        body { margin:0; background:#000 url('https://files.catbox.moe/622ngf.jpg') center/cover; color:#fff; font-family:sans-serif; text-align:center; height:100vh; overflow:hidden; }
        .nav { display:flex; background:rgba(0,0,0,0.9); padding:5px; border-bottom:1px solid #333; }
        .tab { flex:1; padding:15px; opacity:0.4; font-size:12px; font-weight:bold; color:#0ff; transition:0.3s; }
        .tab.active { opacity:1; text-shadow:0 0 10px #0ff; border-bottom:2px solid #0ff; }
        .card { background:rgba(0,0,0,0.9); border:2px solid #0ff; border-radius:30px; margin:15px; padding:25px; box-shadow: 0 0 20px rgba(0,255,255,0.3); }
        .reels { display:flex; justify-content:center; gap:15px; margin:25px 0; }
        .reel { width:85px; height:85px; background:#000; border:3px solid #f0f; border-radius:20px; font-size:45px; display:flex; align-items:center; justify-content:center; box-shadow: inset 0 0 15px #f0f; }
        .btn { width:90%; padding:20px; background:linear-gradient(45deg, #f0f, #70f); border:none; border-radius:20px; color:#fff; font-weight:900; font-size:20px; box-shadow: 0 5px 20px rgba(255,0,255,0.4); }
        .btn:active { transform: scale(0.96); }
        .hidden { display:none !important; }
        textarea { width:100%; height:120px; background:#111; color:#0ff; border:1px solid #333; border-radius:15px; padding:15px; }
    </style>
</head>
<body>
    <audio id="bgm" loop src="https://files.catbox.moe/78surr.mp3"></audio>
    <div class="nav">
        <div class="tab active" onclick="sw(1)" id="t1">🎰 ИГРА</div>
        <div class="tab" onclick="sw(2)" id="t2">📊 ИНФО</div>
        <div class="tab" onclick="sw(3)" id="t3">💎 КАССА</div>
        <div class="tab" onclick="sw(4)" id="t4">⚙️ ЕЩЕ</div>
    </div>
    <div id="p1" style="padding-top:10px;">
        <div class="card">
            <div id="v-bal" style="font-size:50px; color:#0ff; font-weight:900;">0.00</div>
            <select id="v-bet" style="width:100%; background:#111; color:#fff; padding:12px; border-radius:12px; border:1px solid #333; margin-top:10px;">
                <option value="0.01">СТАВКА: 0.01 TON</option>
                <option value="0.05">СТАВКА: 0.05 TON</option>
            </select>
        </div>
        <div class="reels"><div class="reel" id="r1">?</div><div class="reel" id="r2">?</div><div class="reel" id="r3">?</div></div>
        <button class="btn" onclick="spin()" id="spin-btn">ИГРАТЬ</button>
    </div>
    <div id="p2" class="hidden"><div class="card"><h2>СТАТИСТИКА</h2><p id="stats" style="font-size:22px;"></p></div></div>
    <div id="p3" class="hidden">
        <div class="card">
            <h3>ДЕПОЗИТ</h3>
            <div style="background:#111; padding:15px; border-radius:15px; border:1px dashed #0ff; font-size:11px; margin:15px 0;" onclick="cp('${WALLET}')">${WALLET}</div>
            <p style="color:#f0f; font-weight:bold;">ВАШ ID ДЛЯ КОММЕНТАРИЯ:</p>
            <div id="v-id" style="font-size:30px; color:#0ff; font-weight:900;">...</div>
        </div>
    </div>
    <div id="p4" class="hidden">
        <div id="adm-ui" class="card hidden" style="border-color:yellow;">
            <h3 style="color:yellow;">РАССЫЛКА</h3>
            <textarea id="bc-text" placeholder="Текст сообщения..."></textarea>
            <button class="btn" onclick="sendBc()" style="background:orange; margin-top:10px;">ОТПРАВИТЬ</button>
        </div>
        <div id="adm-denied" class="card"><h2>ДОСТУП ЗАКРЫТ</h2></div>
    </div>
    <script>
        const tg = window.Telegram.WebApp;
        const uid = tg.initDataUnsafe?.user?.id || "12345";
        const syms = ['🍒','7️⃣','💎','💰','⭐'];
        function sw(n) { [1,2,3,4].forEach(i => { document.getElementById('p'+i).classList.toggle('hidden', i!==n); if(i<5) document.getElementById('t'+i).classList.toggle('active', i===n); }); }
        function cp(t) { navigator.clipboard.writeText(t); tg.showAlert("Скопировано!"); }
        async function sync() {
            const r = await fetch('/api/sync', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid})});
            const d = await r.json();
            document.getElementById('v-bal').innerText = d.balance.toFixed(2);
            document.getElementById('stats').innerText = "Игр: "+d.s+" | Побед: "+d.w;
            document.getElementById('v-id').innerText = uid;
            if(uid.toString() === "${ADMIN_ID}") { document.getElementById('adm-ui').classList.remove('hidden'); document.getElementById('adm-denied').classList.add('hidden'); }
        }
        async function spin() {
            document.getElementById('bgm').play().catch(()=>{});
            const btn = document.getElementById('spin-btn'); btn.disabled = true;
            const res = await fetch('/api/spin', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, bet: document.getElementById('v-bet').value})});
            const d = await res.json();
            if(d.err) { tg.showAlert(d.err); btn.disabled = false; return; }
            let c = 0; const iv = setInterval(() => {
                document.getElementById('r1').innerText = syms[Math.floor(Math.random()*5)];
                document.getElementById('r2').innerText = syms[Math.floor(Math.random()*5)];
                document.getElementById('r3').innerText = syms[Math.floor(Math.random()*5)];
                if(++c > 12) {
                    clearInterval(iv); document.getElementById('r1').innerText = d.r[0]; document.getElementById('r2').innerText = d.r[1]; document.getElementById('r3').innerText = d.r[2];
                    sync(); btn.disabled = false; if(d.win > 0) tg.showAlert("🏆 ВЫИГРЫШ: " + d.win + " TON!");
                }
            }, 80);
        }
        async function sendBc() {
            const text = document.getElementById('bc-text').value; if(!text) return;
            const r = await fetch('/api/admin/broadcast', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({admin_id: uid, text})});
            const d = await r.json(); tg.showAlert("Готово!");
        }
        sync(); tg.expand();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, '0.0.0.0', () => console.log("Server Running"));
