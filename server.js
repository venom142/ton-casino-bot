const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const axios = require('axios');

/**
 * CONFIGURATION SECTION
 * Основные настройки сервера и ключи доступа
 */
const app = express();
const PORT = process.env.PORT || 10000;

const WALLET = "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn"; 
const TON_KEY = "fe9429836fd2dfdb009421c6dc389840c9cdadca238477b4e2910250e11fa6d3"; 
const ADMIN_ID = "8475323865"; 
const MONGO_URI = "mongodb+srv://sv2951605_db_user:zetatop123@cluster0.k5dri5s.mongodb.net/?appName=Cluster0";

// ПОДКЛЮЧЕНИЕ К БАЗЕ ДАННЫХ
mongoose.connect(MONGO_URI).then(() => {
    console.log(">>> [DATABASE] Online");
});

// МОДЕЛЬ ПОЛЬЗОВАТЕЛЯ
const User = mongoose.model('User', { 
    uid: String, 
    balance: { type: Number, default: 0.10 },
    s: { type: Number, default: 0 }, 
    w: { type: Number, default: 0 },
    last_lt: { type: String, default: "0" }, 
    used_p: [String]
});

// МОДЕЛЬ ПРОМОКОДОВ С ЛИМИТАМИ
const Promo = mongoose.model('Promo', { 
    code: String, 
    sum: Number, 
    limit: Number, 
    count: { type: Number, default: 0 } 
});

const bot = process.env.BOT_TOKEN ? new TelegramBot(process.env.BOT_TOKEN, { polling: true }) : null;
app.use(express.json());

/**
 * TON SCANNER LOGIC
 * Мониторинг входящих транзакций в реальном времени
 */
async function scanBlockchain() {
    try {
        const url = `https://toncenter.com/api/v2/getTransactions?address=${WALLET}&limit=5&api_key=${TON_KEY}`;
        const response = await axios.get(url);
        
        if (!response.data.ok) return;

        for (let tx of response.data.result) {
            const inMsg = tx.in_msg;
            if (!inMsg || !inMsg.message) continue;

            const amount = parseInt(inMsg.value) / 1000000000;
            const comment = inMsg.message.trim();
            const currentLt = tx.transaction_id.lt;

            const user = await User.findOne({ uid: comment });
            
            if (user && currentLt > user.last_lt) {
                user.balance = Number((user.balance + amount).toFixed(2));
                user.last_lt = currentLt;
                await user.save();
                if (bot) bot.sendMessage(user.uid, `✅ +${amount} TON получено!`);
            }
        }
    } catch (e) {
        console.log("Scan error - retrying...");
    }
}
setInterval(scanBlockchain, 25000);

/**
 * BACKEND API ROUTES
 */
app.post('/api/sync', async (req, res) => {
    let u = await User.findOne({ uid: req.body.uid.toString() });
    if (!u) u = await new User({ uid: req.body.uid.toString() }).save();
    res.json(u);
});

app.post('/api/promo', async (req, res) => {
    const { uid, code } = req.body;
    const p = await Promo.findOne({ code: code.toUpperCase() });
    const u = await User.findOne({ uid: uid.toString() });

    if (!p || p.count >= p.limit) {
        return res.json({ err: "ПРОМО ИСТЕК" });
    }

    if (u.used_p.includes(p.code)) {
        return res.json({ err: "УЖЕ ИСПОЛЬЗОВАН" });
    }

    u.balance += p.sum;
    u.used_p.push(p.code);
    p.count += 1;

    await u.save();
    await p.save();
    res.json({ msg: `+${p.sum} TON`, balance: u.balance });
});

app.post('/api/spin', async (req, res) => {
    const { uid, bet } = req.body;
    const u = await User.findOne({ uid: uid.toString() });

    if (!u || u.balance < bet) return res.json({ err: "МАЛО TON" });

    u.balance -= bet;
    u.s += 1;

    const items = ['🍒','7️⃣','💎','💰','⭐'];
    let result;

    if (Math.random() < 0.05) {
        const j = items[Math.floor(Math.random() * 5)];
        result = [j, j, j];
    } else {
        result = [0,0,0].map(() => items[Math.floor(Math.random() * 5)]);
        if (result[0] === result[1] && result[1] === result[2]) {
            result[2] = items[(items.indexOf(result[2]) + 1) % 5];
        }
    }

    let win = (result[0] === result[1] && result[1] === result[2]) ? bet * 10 : 0;
    u.balance += win;
    if (win > 0) u.w += 1;
    
    await u.save();
    res.json({ r: result, win, balance: u.balance });
});

app.post('/api/admin', async (req, res) => {
    if (req.body.admin_id.toString() !== ADMIN_ID) return res.status(403).send();
    
    if (req.body.type === 'promo') {
        await new Promo({ 
            code: req.body.code.toUpperCase(), 
            sum: req.body.sum, 
            limit: req.body.limit 
        }).save();
    }
    
    if (req.body.type === 'bc') {
        const users = await User.find();
        for (let u of users) {
            try { await bot.sendMessage(u.uid, req.body.text); } catch(e) {}
        }
    }
    res.json({ ok: true });
});

/**
 * FRONTEND GENERATION
 */
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        body { 
            margin: 0; 
            background: #000 url('https://files.catbox.moe/622ngf.jpg') center/cover; 
            color: #fff; 
            font-family: sans-serif; 
            text-align: center; 
            height: 100vh; 
            overflow: hidden; 
        }

        .nav { display: flex; background: rgba(0,0,0,0.9); padding: 10px; border-bottom: 2px solid #333; }
        .tab { flex: 1; padding: 10px; opacity: 0.3; font-size: 10px; color: #0ff; font-weight: bold; }
        .tab.active { opacity: 1; text-shadow: 0 0 10px #0ff; border-bottom: 2px solid #0ff; }
        .card { background: rgba(0,0,0,0.9); border: 2px solid #0ff; border-radius: 25px; margin: 12px; padding: 15px; }
        .reels { display: flex; justify-content: center; gap: 8px; margin: 15px 0; }
        .reel { width: 75px; height: 75px; background: #000; border: 2px solid #f0f; border-radius: 15px; font-size: 40px; display: flex; align-items: center; justify-content: center; }
        .btn { width: 90%; padding: 18px; background: linear-gradient(45deg, #f0f, #70f); border: none; border-radius: 15px; color: #fff; font-weight: 900; cursor: pointer; }
        input, textarea, select { width: 80%; background: #111; color: #0ff; border: 1px solid #333; border-radius: 12px; padding: 10px; margin: 5px 0; text-align: center; }
        .hidden { display: none !important; }
    </style>
</head>
<body>
    <audio id="bgm" loop src="https://files.catbox.moe/78surr.mp3"></audio>
    <div class="nav">
        <div class="tab active" onclick="sw(1)" id="t1">🎰 КАЗИНО</div>
        <div class="tab" onclick="sw(2)" id="t2">📊 СТАТЫ</div>
        <div class="tab" onclick="sw(3)" id="t3">💎 КАССА</div>
        <div class="tab" onclick="sw(4)" id="t4">⚙️ АДМИН</div>
    </div>
    <div id="p1">
        <div class="card">
            <div id="v-bal" style="font-size:45px; color:#0ff; font-weight:999;">0.00</div>
            <select id="v-bet">
                <option value="0.01">СТАВКА: 0.01</option>
                <option value="0.05">СТАВКА: 0.05</option>
            </select>
        </div>
        <div class="reels"><div class="reel" id="r1">?</div><div class="reel" id="r2">?</div><div class="reel" id="r3">?</div></div>
        <button class="btn" onclick="spin()" id="spin-btn">ИГРАТЬ</button>
        <div class="card">
            <h5>ПРОМОКОД</h5>
            <input id="p-code" placeholder="КОД...">
            <button onclick="useP()" style="background:#0ff; border:none; padding:8px; border-radius:10px; width:80%; margin-top:5px; font-weight:bold;">АКТИВИРОВАТЬ</button>
        </div>
    </div>
    <div id="p2" class="hidden"><div class="card"><h2>СТАТИСТИКА</h2><p id="stats"></p></div></div>
    <div id="p3" class="hidden"><div class="card"><h3>ДЕПОЗИТ</h3><div style="font-size:10px; border:1px dashed #0ff; padding:10px; word-break:break-all;" onclick="cp('${WALLET}')">${WALLET}</div><p>ID ДЛЯ КОММЕНТАРИЯ:</p><div id="v-id" style="font-size:30px; color:#0ff;">...</div></div></div>
    <div id="p4" class="hidden">
        <div id="adm-ui" class="hidden">
            <div class="card">
                <h3>РАССЫЛКА</h3>
                <textarea id="bc-t"></textarea>
                <button onclick="adm('bc')" style="background:orange; width:90%; padding:10px; border:none; border-radius:10px;">ОТПРАВИТЬ</button>
            </div>
            <div class="card">
                <h3>ПРОМО</h3>
                <input id="n-p" placeholder="КОД">
                <input id="n-s" placeholder="СУММА">
                <input id="n-l" placeholder="ЛИМИТ">
                <button onclick="adm('promo')" style="background:#0f0; width:90%; padding:10px; border:none; border-radius:10px; font-weight:bold;">СОЗДАТЬ</button>
            </div>
        </div>
        <div id="adm-off" class="card"><h2>НЕТ ДОСТУПА</h2></div>
    </div>
    <script>
        const tg = window.Telegram.WebApp; const uid = tg.initDataUnsafe?.user?.id || "12345";
        function sw(n) { [1,2,3,4].forEach(i => { document.getElementById('p'+i).classList.toggle('hidden', i!==n); if(i<5) document.getElementById('t'+i).classList.toggle('active', i===n); }); }
        function cp(t) { navigator.clipboard.writeText(t); tg.showAlert("ОК!"); }
        async function sync() {
            const r = await fetch('/api/sync', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid})});
            const d = await r.json(); document.getElementById('v-bal').innerText = d.balance.toFixed(2);
            document.getElementById('stats').innerText = "Игр: "+d.s+" | Побед: "+d.w; document.getElementById('v-id').innerText = uid;
            if(uid.toString() === "${ADMIN_ID}") { document.getElementById('adm-ui').classList.remove('hidden'); document.getElementById('adm-off').classList.add('hidden'); }
        }
        async function spin() {
            document.getElementById('bgm').play().catch(()=>{}); const btn = document.getElementById('spin-btn'); btn.disabled = true;
            const res = await fetch('/api/spin', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, bet:document.getElementById('v-bet').value})});
            const d = await res.json(); if(d.err) { tg.showAlert(d.err); btn.disabled = false; return; }
            let c = 0; const iv = setInterval(() => {
                ['r1','r2','r3'].forEach(id => document.getElementById(id).innerText = ['🍒','7️⃣','💎','💰','⭐'][Math.floor(Math.random()*5)]);
                if(++c > 15) { clearInterval(iv); document.getElementById('r1').innerText = d.r[0]; document.getElementById('r2').innerText = d.r[1]; document.getElementById('r3').innerText = d.r[2]; sync(); btn.disabled = false; }
            }, 70);
        }
        async function useP() {
            const r = await fetch('/api/promo', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, code: document.getElementById('p-code').value})});
            const d = await r.json(); tg.showAlert(d.err || d.msg); sync();
        }
        async function adm(t) {
            const b = {admin_id:uid, type:t, text:document.getElementById('bc-t').value, code:document.getElementById('n-p').value, sum:document.getElementById('n-s').value, limit:document.getElementById('n-l').value};
            await fetch('/api/admin', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(b)}); tg.showAlert("ГОТОВО");
        }
        sync(); tg.expand();
    </script>
</body>
</html>
    `);
});

/**
 * SERVER STARTUP
 * Запуск приложения
 */
app.listen(PORT, '0.0.0.0', () => {
    console.log("SERVER STATUS: 250 LINES LOADED");
});
