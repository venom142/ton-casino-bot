const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

// === КОНФИГУРАЦИЯ ===
const WALLET = "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn"; 
const TON_KEY = "fe9429836fd2dfdb009421c6dc389840c9cdadca238477b4e2910250e11fa6d3"; 
const ADMIN_ID = "8475323865"; 
const MONGO_URI = "mongodb+srv://sv2951605_db_user:zetatop123@cluster0.k5dri5s.mongodb.net/?appName=Cluster0";

mongoose.connect(MONGO_URI).then(() => console.log(">>> DATABASE READY"));

const User = mongoose.model('User', { 
    uid: String, 
    balance: { type: Number, default: 0.10 },
    spins: { type: Number, default: 0 }, 
    wins: { type: Number, default: 0 },
    last_lt: { type: String, default: "0" }, 
    used_promos: [String]
});

const Promo = mongoose.model('Promo', { 
    code: String, sum: Number, limit: Number, count: { type: Number, default: 0 } 
});

const bot = process.env.BOT_TOKEN ? new TelegramBot(process.env.BOT_TOKEN, { polling: true }) : null;
app.use(express.json());

// === BACKEND LOGIC (ОСТАВЛЯЕМ СТАБИЛЬНОЙ) ===
async function syncBlockchain() {
    try {
        const url = `https://toncenter.com/api/v2/getTransactions?address=${WALLET}&limit=5&api_key=${TON_KEY}`;
        const res = await axios.get(url);
        if (!res.data.ok) return;
        for (let tx of res.data.result) {
            if (!tx.in_msg || !tx.in_msg.message) continue;
            const amount = parseInt(tx.in_msg.value) / 1e9;
            const user = await User.findOne({ $or: [{ uid: tx.in_msg.message.trim() }, { uid: Number(tx.in_msg.message.trim()) }] });
            if (user && tx.transaction_id.lt > user.last_lt) {
                user.balance = Number((user.balance + amount).toFixed(2));
                user.last_lt = tx.transaction_id.lt;
                await user.save();
                if (bot) bot.sendMessage(user.uid, `✅ Баланс пополнен: +${amount} TON`);
            }
        }
    } catch (e) {}
}
setInterval(syncBlockchain, 25000);

app.post('/api/sync', async (req, res) => {
    let u = await User.findOne({ $or: [{ uid: req.body.uid.toString() }, { uid: Number(req.body.uid) }] });
    if (!u) u = await new User({ uid: req.body.uid.toString() }).save();
    res.json(u);
});

app.post('/api/spin', async (req, res) => {
    const { uid, bet } = req.body;
    const u = await User.findOne({ uid: uid.toString() });
    if (!u || u.balance < bet) return res.json({ err: "МАЛО TON" });
    u.balance = Number((u.balance - bet).toFixed(2));
    u.spins += 1;
    const items = ['🍒','7️⃣','💎','💰','⭐'];
    let result = Array(3).fill(0).map(() => items[Math.floor(Math.random()*5)]);
    if (Math.random() < 0.1) result = Array(3).fill(items[Math.floor(Math.random()*5)]);
    const isWin = result[0] === result[1] && result[1] === result[2];
    const win = isWin ? Number((bet * 10).toFixed(2)) : 0;
    u.balance = Number((u.balance + win).toFixed(2));
    if (isWin) u.wins += 1;
    await u.save();
    res.json({ result, win, balance: u.balance });
});

app.post('/api/admin', async (req, res) => {
    if (req.body.admin_id.toString() !== ADMIN_ID) return res.status(403).send();
    if (req.body.type === 'promo') await new Promo({ code: req.body.code.toUpperCase(), sum: parseFloat(req.body.sum), limit: parseInt(req.body.limit) }).save();
    if (req.body.type === 'bc') {
        const users = await User.find();
        for (let u of users) bot.sendMessage(u.uid, req.body.text).catch(()=>{});
    }
    res.json({ ok: true });
});

app.post('/api/promo', async (req, res) => {
    const p = await Promo.findOne({ code: req.body.code.toUpperCase() });
    const u = await User.findOne({ uid: req.body.uid.toString() });
    if (!p || p.count >= p.limit || u.used_promos.includes(p.code)) return res.json({ err: "ОШИБКА" });
    u.balance = Number((u.balance + p.sum).toFixed(2));
    u.used_promos.push(p.code);
    p.count++; await u.save(); await p.save();
    res.json({ msg: `+${p.sum} TON`, balance: u.balance });
});

// === FRONTEND С ТОП АНИМАЦИЯМИ ===
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        :root { --neon: #0ff; --accent: #f0f; }
        body { margin: 0; background: #000 url('https://files.catbox.moe/622ngf.jpg') center/cover no-repeat fixed; color: #fff; font-family: 'Inter', sans-serif; text-align: center; height: 100vh; overflow: hidden; }
        
        .nav { display: flex; background: rgba(0,0,0,0.85); backdrop-filter: blur(10px); border-bottom: 1px solid rgba(255,255,255,0.1); position: sticky; top: 0; z-index: 100; }
        .tab { flex: 1; padding: 18px 5px; opacity: 0.3; font-size: 10px; color: var(--neon); font-weight: 900; transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1); cursor: pointer; text-transform: uppercase; letter-spacing: 1px; }
        .tab.active { opacity: 1; border-bottom: 3px solid var(--neon); text-shadow: 0 0 15px var(--neon); transform: translateY(-2px); }

        .page { position: absolute; width: 100%; transition: all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275); opacity: 0; transform: translateY(30px) scale(0.95); visibility: hidden; padding-bottom: 50px; }
        .page.active { opacity: 1; transform: translateY(0) scale(1); visibility: visible; }

        .card { background: rgba(255,255,255,0.03); backdrop-filter: blur(20px); border: 1px solid rgba(0,255,255,0.15); border-radius: 30px; margin: 15px; padding: 25px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
        
        .bal-text { font-size: 60px; font-weight: 900; color: var(--neon); text-shadow: 0 0 20px rgba(0,255,255,0.5); margin: 10px 0; }
        
        .reel-box { display: flex; justify-content: center; gap: 12px; margin: 30px 0; perspective: 1000px; }
        .reel { width: 85px; height: 110px; background: rgba(0,0,0,0.6); border: 2px solid rgba(0,255,255,0.3); border-radius: 20px; font-size: 55px; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease; box-shadow: inset 0 0 20px rgba(0,0,0,0.8); }
        
        /* Плавная анимация вращения */
        @keyframes spin { 
            0% { transform: rotateX(0deg) scale(1); filter: blur(0); }
            50% { transform: rotateX(180deg) scale(0.9); filter: blur(8px); }
            100% { transform: rotateX(360deg) scale(1); filter: blur(0); }
        }
        .is-spinning { animation: spin 0.15s infinite linear; border-color: var(--accent); }

        .btn-play { width: 90%; padding: 22px; background: linear-gradient(45deg, #00f2fe, #4facfe); border: none; border-radius: 20px; color: #000; font-weight: 900; font-size: 20px; text-transform: uppercase; transition: 0.3s; box-shadow: 0 0 30px rgba(0,242,254,0.4); animation: pulse 2s infinite; }
        .btn-play:active { transform: scale(0.92); box-shadow: 0 0 10px rgba(0,242,254,0.8); }
        @keyframes pulse { 0% { box-shadow: 0 0 15px rgba(0,242,254,0.4); } 50% { box-shadow: 0 0 35px rgba(0,242,254,0.7); } 100% { box-shadow: 0 0 15px rgba(0,242,254,0.4); } }

        input, select { width: 85%; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1); border-radius: 15px; padding: 15px; color: #fff; margin: 10px 0; text-align: center; outline: none; transition: 0.3s; }
        input:focus { border-color: var(--neon); background: rgba(0,0,0,0.8); }
    </style>
</head>
<body onclick="startMusic()">
    <audio id="bgm" loop src="https://files.catbox.moe/78surr.mp3"></audio>
    
    <div class="nav" id="nav">
        <div class="tab active" onclick="showPage(1)" id="t1">🎰 ИГРА</div>
        <div class="tab" onclick="showPage(2)" id="t2">📊 СТАТЫ</div>
        <div class="tab" onclick="showPage(3)" id="t3">💳 КАССА</div>
        <div class="tab" onclick="showPage(4)" id="t4">⚙️ МЕНЮ</div>
    </div>

    <div id="p1" class="page active">
        <div class="card">
            <div class="bal-text" id="b-val">0.00</div>
            <select id="bet-val">
                <option value="0.01">СТАВКА 0.01 TON</option>
                <option value="0.05">СТАВКА 0.05 TON</option>
                <option value="0.10">СТАВКА 0.10 TON</option>
            </select>
        </div>
        <div class="reel-box">
            <div class="reel" id="r1">💎</div>
            <div class="reel" id="r2">💎</div>
            <div class="reel" id="r3">💎</div>
        </div>
        <button class="btn-play" onclick="doSpin()" id="btn-s">ИГРАТЬ</button>
        <div class="card" style="margin-top:20px; padding: 15px;">
            <input id="promo-in" placeholder="ПРОМОКОД">
            <button onclick="usePromo()" style="background:none; border:1px solid var(--neon); color:var(--neon); padding:10px 20px; border-radius:12px; margin-top:5px; font-weight:bold;">АКТИВИРОВАТЬ</button>
        </div>
    </div>

    <div id="p2" class="page">
        <div class="card">
            <h2 style="color:var(--accent)">ВАША СТАТИСТИКА</h2>
            <div id="st-data" style="font-size:22px; line-height:2;"></div>
        </div>
    </div>

    <div id="p3" class="page">
        <div class="card">
            <h3>ПОПОЛНИТЬ БАЛАНС</h3>
            <div style="font-size:12px; opacity:0.7; margin-bottom:10px;">Переведите TON на адрес:</div>
            <div style="border:1px dashed var(--neon); padding:15px; border-radius:15px; background:rgba(0,255,255,0.05); font-size:11px; word-break:break-all;" onclick="copy('${WALLET}')">${WALLET}</div>
            <p style="color:orange; font-weight:bold; margin-top:20px;">КОММЕНТАРИЙ К ПЛАТЕЖУ:</p>
            <div id="my-uid" style="font-size:38px; color:var(--neon); font-weight:900; letter-spacing:2px;">...</div>
        </div>
    </div>

    <div id="p4" class="page">
        <div class="card">
            <h3>НАСТРОЙКИ</h3>
            <button onclick="toggleMusic()" style="width:100%; padding:18px; border-radius:15px; background:#111; color:#fff; border:1px solid #333; font-weight:bold;">ВКЛ / ВЫКЛ МУЗЫКУ</button>
        </div>
    </div>

    <div id="p5" class="page">
        <div class="card"><h3>АДМИН: РАССЫЛКА</h3><textarea id="adm-msg" style="width:90%; height:80px;"></textarea><button onclick="admAct('bc')" style="background:orange; width:100%; padding:12px; border:none; margin-top:10px; border-radius:10px;">ОТПРАВИТЬ</button></div>
        <div class="card"><h3>СОЗДАТЬ ПРОМО</h3><input id="adm-c" placeholder="КОД"><input id="adm-s" placeholder="СУММА"><input id="adm-l" placeholder="ЛИМИТ"><button onclick="admAct('promo')" style="background:var(--neon); color:#000; width:100%; padding:12px; border:none; margin-top:10px; border-radius:10px; font-weight:bold;">СОЗДАТЬ</button></div>
    </div>

    <script>
        const tg = window.Telegram.WebApp;
        const uid = tg.initDataUnsafe?.user?.id || "12345";
        let musicStarted = false;

        function startMusic() {
            if(!musicStarted) {
                const m = document.getElementById('bgm');
                m.volume = 0.4; m.play().catch(()=>{});
                musicStarted = true;
            }
        }

        function showPage(n) {
            document.querySelectorAll('.page').forEach((p, i) => {
                p.classList.toggle('active', (i+1) === n);
            });
            document.querySelectorAll('.tab').forEach((t, i) => {
                t.classList.toggle('active', (i+1) === n);
            });
            tg.HapticFeedback.impactOccurred('light');
        }

        function toggleMusic() {
            const m = document.getElementById('bgm');
            m.paused ? m.play() : m.pause();
        }

        async function sync() {
            const r = await fetch('/api/sync', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid})});
            const d = await r.json();
            document.getElementById('b-val').innerText = d.balance.toFixed(2);
            document.getElementById('st-data').innerHTML = "🎰 Игр: " + d.spins + "<br>🏆 Побед: " + d.wins;
            document.getElementById('my-uid').innerText = uid;
            
            if(uid.toString() === "${ADMIN_ID}" && !document.getElementById('t5')) {
                const t5 = document.createElement('div'); t5.className='tab'; t5.id='t5'; t5.innerText='🛡️ ADMIN'; t5.onclick=()=>showPage(5);
                document.getElementById('nav').appendChild(t5);
            }
        }

        async function doSpin() {
            const btn = document.getElementById('btn-s');
            const bet = document.getElementById('bet-val').value;
            btn.disabled = true;

            const res = await fetch('/api/spin', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, bet})});
            const d = await res.json();
            
            if(d.err) { tg.showAlert(d.err); btn.disabled = false; return; }

            tg.HapticFeedback.impactOccurred('medium');
            const reels = [document.getElementById('r1'), document.getElementById('r2'), document.getElementById('r3')];
            
            reels.forEach(r => r.classList.add('is-spinning'));

            // Эффектная остановка по очереди
            setTimeout(() => { reels[0].classList.remove('is-spinning'); reels[0].innerText = d.result[0]; tg.HapticFeedback.impactOccurred('light'); }, 1000);
            setTimeout(() => { reels[1].classList.remove('is-spinning'); reels[1].innerText = d.result[1]; tg.HapticFeedback.impactOccurred('light'); }, 1600);
            setTimeout(() => { 
                reels[2].classList.remove('is-spinning'); 
                reels[2].innerText = d.result[2]; 
                tg.HapticFeedback.notificationOccurred(d.win > 0 ? 'success' : 'warning');
                sync();
                btn.disabled = false;
                if(d.win > 0) tg.showConfirm("🎉 ПОЗДРАВЛЯЕМ! + " + d.win + " TON");
            }, 2200);
        }

        async function usePromo() {
            const code = document.getElementById('promo-in').value;
            const r = await fetch('/api/promo', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, code})});
            const d = await r.json();
            tg.showAlert(d.err || "Успешно: " + d.msg);
            sync();
        }

        async function admAct(type) {
            const b = { admin_id:uid, type, text:document.getElementById('adm-msg').value, code:document.getElementById('adm-c').value, sum:document.getElementById('adm-s').value, limit:document.getElementById('adm-l').value };
            await fetch('/api/admin', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(b)});
            tg.showAlert("Выполнено");
        }

        function copy(t) { navigator.clipboard.writeText(t); tg.showAlert("Скопировано!"); }
        
        sync();
        tg.expand();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, '0.0.0.0', () => console.log("SERVER ONLINE"));
