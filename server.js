const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const axios = require('axios');

/**
 * CASINO ULTIMATE V9.0 - FULL FUNCTIONALITY
 * Исправлены функции, возвращена музыка и админка.
 */
const app = express();
const PORT = process.env.PORT || 10000;

const WALLET = "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn"; 
const TON_KEY = "fe9429836fd2dfdb009421c6dc389840c9cdadca238477b4e2910250e11fa6d3"; 
const ADMIN_ID = "8475323865"; 
const MONGO_URI = "mongodb+srv://sv2951605_db_user:zetatop123@cluster0.k5dri5s.mongodb.net/?appName=Cluster0";

// ПОДКЛЮЧЕНИЕ К DATABASE
mongoose.connect(MONGO_URI).then(() => {
    console.log(">>> [DATABASE] Online and Ready");
});

const User = mongoose.model('User', { 
    uid: String, 
    balance: { type: Number, default: 0.10 },
    spins: { type: Number, default: 0 }, 
    wins: { type: Number, default: 0 },
    last_lt: { type: String, default: "0" }, 
    used_promos: [String]
});

const Promo = mongoose.model('Promo', { 
    code: String, 
    sum: Number, 
    limit: Number, 
    count: { type: Number, default: 0 } 
});

const bot = process.env.BOT_TOKEN ? new TelegramBot(process.env.BOT_TOKEN, { polling: true }) : null;
app.use(express.json());

// СКАНЕР ТРАНЗАКЦИЙ TON
async function checkTransactions() {
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
                if (bot) bot.sendMessage(user.uid, `✅ Баланс пополнен: +${amount} TON`);
            }
        }
    } catch (e) { console.log("Blockchain scan error..."); }
}
setInterval(checkTransactions, 25000);

// API: СИНХРОНИЗАЦИЯ ДАННЫХ
app.post('/api/sync', async (req, res) => {
    let user = await User.findOne({ uid: req.body.uid.toString() });
    if (!user) {
        user = await new User({ uid: req.body.uid.toString() }).save();
    }
    res.json(user);
});

// API: АКТИВАЦИЯ ПРОМОКОДА
app.post('/api/promo', async (req, res) => {
    const { uid, code } = req.body;
    const promo = await Promo.findOne({ code: code.toUpperCase() });
    const user = await User.findOne({ uid: uid.toString() });

    if (!promo || promo.count >= promo.limit) {
        return res.json({ err: "ПРОМОКОД НЕ СУЩЕСТВУЕТ ИЛИ ИСТЕК" });
    }
    if (user.used_promos.includes(promo.code)) {
        return res.json({ err: "ВЫ УЖЕ ИСПОЛЬЗОВАЛИ ЭТОТ КОД" });
    }

    user.balance = Number((user.balance + promo.sum).toFixed(2));
    user.used_promos.push(promo.code);
    promo.count += 1;

    await user.save();
    await promo.save();
    res.json({ msg: `✅ Начислено +${promo.sum} TON`, balance: user.balance });
});

// API: ЛОГИКА ИГРЫ (SLOTS)
app.post('/api/spin', async (req, res) => {
    const { uid, bet } = req.body;
    const user = await User.findOne({ uid: uid.toString() });

    if (!user || user.balance < bet) return res.json({ err: "НЕДОСТАТОЧНО СРЕДСТВ" });

    user.balance = Number((user.balance - bet).toFixed(2));
    user.spins += 1;

    const items = ['🍒','7️⃣','💎','💰','⭐'];
    let result;

    if (Math.random() < 0.08) { // Шанс выигрыша 8%
        const jackpot = items[Math.floor(Math.random() * 5)];
        result = [jackpot, jackpot, jackpot];
    } else {
        result = [0,0,0].map(() => items[Math.floor(Math.random() * 5)]);
        if (result[0] === result[1] && result[1] === result[2]) {
            result[2] = items[(items.indexOf(result[2]) + 1) % 5];
        }
    }

    let winAmount = (result[0] === result[1] && result[1] === result[2]) ? Number((bet * 10).toFixed(2)) : 0;
    user.balance = Number((user.balance + winAmount).toFixed(2));
    if (winAmount > 0) user.wins += 1;

    await user.save();
    res.json({ result, winAmount, balance: user.balance });
});

// API: АДМИНИСТРИРОВАНИЕ
app.post('/api/admin', async (req, res) => {
    if (req.body.admin_id.toString() !== ADMIN_ID) return res.status(403).send("ACCESS DENIED");
    
    if (req.body.type === 'promo') {
        await new Promo({ 
            code: req.body.code.toUpperCase(), 
            sum: Number(req.body.sum), 
            limit: Number(req.body.limit) 
        }).save();
    }
    
    if (req.body.type === 'broadcast') {
        const users = await User.find();
        for (let u of users) {
            try { await bot.sendMessage(u.uid, req.body.text); } catch(e) { console.log("BC Error"); }
        }
    }
    res.json({ ok: true });
});

// FRONTEND GENERATION
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        body { margin: 0; background: #000 url('https://files.catbox.moe/622ngf.jpg') center/cover; color: #fff; font-family: sans-serif; text-align: center; height: 100vh; overflow: hidden; }
        .nav { display: flex; background: rgba(0,0,0,0.9); padding: 10px; border-bottom: 2px solid #333; }
        .tab { flex: 1; padding: 10px; opacity: 0.3; font-size: 10px; color: #0ff; font-weight: bold; }
        .tab.active { opacity: 1; text-shadow: 0 0 10px #0ff; border-bottom: 2px solid #0ff; }
        .card { background: rgba(0,0,0,0.85); border: 2px solid #0ff; border-radius: 20px; margin: 10px; padding: 15px; }
        .reel { width: 75px; height: 85px; background: #111; border: 2px solid #f0f; border-radius: 12px; font-size: 40px; display: flex; align-items: center; justify-content: center; transition: 0.1s; }
        .blur { filter: blur(6px); transform: scale(0.9); }
        .btn { width: 92%; padding: 18px; background: linear-gradient(45deg, #f0f, #70f); border: none; border-radius: 15px; color: #fff; font-weight: 900; cursor: pointer; }
        input, textarea, select { width: 85%; background: #000; color: #0ff; border: 1px solid #333; border-radius: 10px; padding: 12px; margin: 6px 0; text-align: center; }
        .hidden { display: none !important; }
    </style>
</head>
<body onclick="document.getElementById('bgm').play().catch(()=>{})">
    <audio id="bgm" loop src="https://files.catbox.moe/78surr.mp3"></audio>
    <div class="nav" id="main-nav">
        <div class="tab active" onclick="sw(1)" id="t1">🎰 КАЗИНО</div>
        <div class="tab" onclick="sw(2)" id="t2">📊 СТАТЫ</div>
        <div class="tab" onclick="sw(3)" id="t3">💎 КАССА</div>
        <div class="tab" onclick="sw(4)" id="t4">⚙️ ОПЦИИ</div>
    </div>
    <div id="p1">
        <div class="card"><div id="v-bal" style="font-size:48px; color:#0ff; font-weight:900;">0.00</div>
        <select id="v-bet"><option value="0.01">СТАВКА: 0.01 TON</option><option value="0.05">СТАВКА: 0.05 TON</option></select></div>
        <div style="display:flex; justify-content:center; gap:8px; margin:20px 0;"><div class="reel" id="r1">❓</div><div class="reel" id="r2">❓</div><div class="reel" id="r3">❓</div></div>
        <button class="btn" onclick="spin()" id="spin-btn">ИГРАТЬ</button>
        <div class="card"><h5>ПРОМОКОД</h5><input id="p-code"><button onclick="useP()" style="background:#0ff; border:none; padding:10px; border-radius:10px; width:80%; margin-top:5px; font-weight:bold;">АКТИВИРОВАТЬ</button></div>
    </div>
    <div id="p2" class="hidden"><div class="card"><h2>СТАТИСТИКА</h2><p id="stats_text" style="font-size:18px;"></p></div></div>
    <div id="p3" class="hidden"><div class="card"><h3>ДЕПОЗИТ</h3><div style="font-size:11px; border:1px dashed #0ff; padding:12px; word-break:break-all;" onclick="cp('${WALLET}')">${WALLET}</div><p>ID ДЛЯ КОММЕНТАРИЯ:</p><div id="v-id" style="font-size:32px; color:#0ff; font-weight:bold;">...</div></div></div>
    <div id="p4" class="hidden"><div class="card"><h3>НАСТРОЙКИ</h3><button onclick="mT()" style="width:80%; padding:15px; border-radius:12px; background:#222; color:#fff; border:none;">ВКЛ / ВЫКЛ МУЗЫКУ</button></div></div>
    <div id="p5" class="hidden">
        <div class="card"><h3>РАССЫЛКА</h3><textarea id="bc-msg"></textarea><button onclick="adm('broadcast')" style="background:orange; width:90%; padding:10px; border:none; border-radius:10px;">ОТПРАВИТЬ ВСЕМ</button></div>
        <div class="card"><h3>ПРОМОКОДЫ</h3><input id="n-p-c" placeholder="КОД"><input id="n-p-s" placeholder="СУММА"><input id="n-p-l" placeholder="ЛИМИТ"><button onclick="adm('promo')" style="background:#0f0; width:90%; padding:10px; border:none; border-radius:10px; font-weight:bold;">СОЗДАТЬ</button></div>
    </div>
    <script>
        const tg = window.Telegram.WebApp; const uid = tg.initDataUnsafe?.user?.id || "12345";
        function sw(n) { [1,2,3,4,5].forEach(i => { if(document.getElementById('p'+i)) document.getElementById('p'+i).classList.toggle('hidden', i!==n); if(document.getElementById('t'+i)) document.getElementById('t'+i).classList.toggle('active', i===n); }); }
        function cp(t) { navigator.clipboard.writeText(t); tg.showAlert("СКОПИРОВАНО!"); }
        function mT() { const m = document.getElementById('bgm'); m.paused ? m.play() : m.pause(); }
        async function sync() {
            const r = await fetch('/api/sync', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid})});
            const d = await r.json(); document.getElementById('v-bal').innerText = d.balance.toFixed(2);
            document.getElementById('stats_text').innerText = "Всего спинов: "+d.spins+" | Побед: "+d.wins; document.getElementById('v-id').innerText = uid;
            if(uid.toString() === "${ADMIN_ID}" && !document.getElementById('t5')) {
                const nt = document.createElement('div'); nt.className='tab'; nt.id='t5'; nt.innerText='🛡️ АДМИН'; nt.onclick=()=>sw(5);
                document.getElementById('main-nav').appendChild(nt);
            }
        }
        async function spin() {
            const btn = document.getElementById('spin-btn'); btn.disabled = true;
            const res = await fetch('/api/spin', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, bet:document.getElementById('v-bet').value})});
            const d = await res.json(); if(d.err) { tg.showAlert(d.err); btn.disabled = false; return; }
            ['r1','r2','r3'].forEach(id => document.getElementById(id).classList.add('blur'));
            let count = 0; const interval = setInterval(() => {
                ['r1','r2','r3'].forEach(id => document.getElementById(id).innerText = ['🍒','7️⃣','💎','💰','⭐'][Math.floor(Math.random()*5)]);
                if(++count > 25) { 
                    clearInterval(interval); 
                    ['r1','r2','r3'].forEach((id, i) => { document.getElementById(id).classList.remove('blur'); document.getElementById(id).innerText = d.result[i]; });
                    sync(); btn.disabled = false; if(d.winAmount > 0) tg.showConfirm("ВЫИГРЫШ: "+d.winAmount+" TON!");
                }
            }, 60);
        }
        async function useP() {
            const r = await fetch('/api/promo', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, code: document.getElementById('p-code').value})});
            const d = await r.json(); tg.showAlert(d.err || d.msg); sync();
        }
        async function adm(t) {
            const b = {admin_id:uid, type:t, text:document.getElementById('bc-msg').value, code:document.getElementById('n-p-c').value, sum:document.getElementById('n-p-s').value, limit:document.getElementById('n-p-l').value};
            const r = await fetch('/api/admin', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(b)});
            if(r.ok) tg.showAlert("ВЫПОЛНЕНО!");
        }
        sync(); tg.expand();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log("SERVER LIVE: 250 LINES");
});
