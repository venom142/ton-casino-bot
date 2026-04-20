const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

// === CONFIG (БЕРЕМ ИЗ ENV) ===
const WALLET = "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn"; 
const TON_KEY = "fe9429836fd2dfdb009421c6dc389840c9cdadca238477b4e2910250e11fa6d3"; 
const ADMIN_ID = "8475323865"; 

const MONGO_URI = process.env.MONGO_URI;
const BOT_TOKEN = process.env.BOT_TOKEN;
const APP_URL = process.env.APP_URL;

mongoose.connect(MONGO_URI).then(() => console.log("✅ DB CONNECTED"));

// === МОДЕЛИ ДАННЫХ ===
const User = mongoose.model('User', { 
    uid: String, 
    balance: { type: Number, default: 0.10 },
    spins: { type: Number, default: 0 }, 
    wins: { type: Number, default: 0 },
    last_lt: { type: String, default: "0" },
    used_promos: [String]
});

const Promo = mongoose.model('Promo', { 
    code: { type: String, uppercase: true }, sum: Number, limit: Number, count: { type: Number, default: 0 } 
});

app.use(express.json());

// === TELEGRAM БОТ (ГЛАВНАЯ КНОПКА) ===
if (BOT_TOKEN) {
    const bot = new TelegramBot(BOT_TOKEN, { polling: true });
    bot.onText(/\/start/, (msg) => {
        bot.sendMessage(msg.chat.id, `🎰 *TON CASINO* 🎰\n\nТвой путь к успеху начинается здесь!`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: "🚀 ИГРАТЬ (ВЕБ-ВЕРСИЯ)", web_app: { url: APP_URL } }]]
            }
        });
    });
}

// === СКАНЕР ТРАНЗАКЦИЙ TON ===
setInterval(async () => {
    try {
        const r = await axios.get(`https://toncenter.com/api/v2/getTransactions?address=${WALLET}&limit=10&api_key=${TON_KEY}`);
        if (r.data.ok) {
            for (let tx of r.data.result) {
                const comment = tx.in_msg?.message?.trim();
                const lt = tx.transaction_id.lt;
                const user = await User.findOne({ uid: comment });
                if (user && BigInt(lt) > BigInt(user.last_lt)) {
                    user.balance += parseInt(tx.in_msg.value) / 1e9;
                    user.last_lt = lt.toString();
                    await user.save();
                }
            }
        }
    } catch (e) {}
}, 30000);

// === API ===
app.post('/api/sync', async (req, res) => {
    let u = await User.findOne({ uid: req.body.uid?.toString() });
    if (!u && req.body.uid) u = await new User({ uid: req.body.uid.toString() }).save();
    res.json(u || { balance: 0 });
});

app.post('/api/spin', async (req, res) => {
    const { uid, bet } = req.body;
    const u = await User.findOne({ uid: uid.toString() });
    if (!u || u.balance < bet) return res.json({ err: "Недостаточно TON" });
    u.balance -= bet;
    const items = ['🍒','7️⃣','💎','💰','⭐'];
    let resArr = [items[Math.floor(Math.random()*5)], items[Math.floor(Math.random()*5)], items[Math.floor(Math.random()*5)]];
    if (Math.random() < 0.12) resArr = Array(3).fill(items[Math.floor(Math.random()*5)]);
    const isWin = resArr[0] === resArr[1] && resArr[1] === resArr[2];
    const winSum = isWin ? bet * 10 : 0;
    u.balance += winSum; u.spins++; if(isWin) u.wins++;
    await u.save();
    res.json({ result: resArr, winSum, balance: u.balance });
});

app.post('/api/promo', async (req, res) => {
    const p = await Promo.findOne({ code: req.body.code.toUpperCase() });
    const u = await User.findOne({ uid: req.body.uid.toString() });
    if (!p || p.count >= p.limit || u.used_promos.includes(p.code)) return res.json({ err: "Ошибка кода" });
    u.balance += p.sum; u.used_promos.push(p.code); p.count++;
    await u.save(); await p.save();
    res.json({ msg: "Бонус зачислен!", balance: u.balance });
});

// === ПОЛНЫЙ ВЕБ-ИНТЕРФЕЙС (WEBSITE) ===
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        :root { --neon: #0ff; --accent: #f0f; }
        body { margin:0; background:#000 url('https://files.catbox.moe/622ngf.jpg') center/cover; color:#fff; font-family:'Segoe UI',sans-serif; text-align:center; overflow:hidden; height:100vh; }
        
        .nav { display:flex; background:rgba(0,0,0,0.85); backdrop-filter:blur(10px); border-bottom:1px solid #333; position:sticky; top:0; z-index:100; }
        .tab { flex:1; padding:15px 0; font-size:10px; font-weight:900; color:var(--neon); opacity:0.4; transition:0.3s; text-transform:uppercase; letter-spacing:1px; }
        .tab.active { opacity:1; border-bottom:3px solid var(--neon); text-shadow: 0 0 10px var(--neon); }

        .page { display:none; padding-top:20px; height: 90vh; overflow-y: auto; }
        .page.active { display:block; }

        .card { background:rgba(255,255,255,0.03); border:1px solid rgba(0,255,255,0.2); border-radius:25px; margin:15px; padding:20px; backdrop-filter:blur(15px); }
        .bal-val { font-size:50px; font-weight:900; color:var(--neon); text-shadow:0 0 20px rgba(0,255,255,0.5); margin:10px 0; }

        /* REELS */
        .reel-cont { display:flex; justify-content:center; gap:10px; margin:30px 0; perspective: 1000px; }
        .reel { width:85px; height:110px; background:linear-gradient(#111, #000, #111); border:2px solid #333; border-radius:18px; overflow:hidden; position:relative; box-shadow: inset 0 0 20px #000; }
        .strip { width:100%; position:absolute; top:0; left:0; transition: transform 2.5s cubic-bezier(0.15, 0.85, 0.15, 1); }
        .sym { height:110px; display:flex; align-items:center; justify-content:center; font-size:55px; filter: drop-shadow(0 0 5px rgba(255,255,255,0.2)); }

        .btn-main { width:85%; padding:20px; background:linear-gradient(135deg, var(--neon), #008080); border:none; border-radius:20px; color:#000; font-weight:900; font-size:20px; box-shadow: 0 5px 20px rgba(0,255,255,0.3); transition: 0.2s; }
        .btn-main:active { transform: scale(0.95); }
        .btn-main:disabled { opacity:0.5; filter:grayscale(1); }

        select, input { width:80%; background:rgba(0,0,0,0.5); border:1px solid #444; border-radius:12px; padding:12px; color:#fff; margin:10px 0; text-align:center; outline:none; }
        .footer-info { font-size:12px; opacity:0.5; margin-top:20px; }
    </style>
</head>
<body onclick="startMusic()">
    <audio id="bgm" loop src="https://files.catbox.moe/78surr.mp3"></audio>

    <div class="nav">
        <div class="tab active" onclick="sh(1)" id="t1">🎰 ИГРА</div>
        <div class="tab" onclick="sh(2)" id="t2">📊 СТАТЫ</div>
        <div class="tab" onclick="sh(3)" id="t3">💰 КАССА</div>
    </div>

    <div id="p1" class="page active">
        <div class="card">
            <div style="font-size:12px; opacity:0.6;">ВАШ БАЛАНС</div>
            <div id="bal" class="bal-val">0.00</div>
            <select id="bet">
                <option value="0.01">СТАВКА 0.01 TON</option>
                <option value="0.05">СТАВКА 0.05 TON</option>
                <option value="0.1">СТАВКА 0.10 TON</option>
            </select>
        </div>

        <div class="reel-cont">
            <div class="reel"><div class="strip" id="s1"></div></div>
            <div class="reel"><div class="strip" id="s2"></div></div>
            <div class="reel"><div class="strip" id="s3"></div></div>
        </div>

        <button class="btn-main" onclick="spin()" id="spinBtn">ИГРАТЬ</button>
        
        <div class="card" style="margin-top:20px; padding:10px;">
            <input id="p-in" placeholder="ЕСТЬ ПРОМОКОД?">
            <button onclick="applyP()" style="background:none; border:1px solid var(--neon); color:var(--neon); padding:5px 15px; border-radius:10px; font-size:12px;">ВВОД</button>
        </div>
    </div>

    <div id="p2" class="page">
        <div class="card">
            <h2 style="color:var(--neon);">СТАТИСТИКА</h2>
            <div style="display:flex; justify-content:space-around; margin-top:20px;">
                <div><div id="st-s" style="font-size:30px;">0</div><div>ИГР</div></div>
                <div><div id="st-w" style="font-size:30px;">0</div><div>ПОБЕД</div></div>
            </div>
        </div>
    </div>

    <div id="p3" class="page">
        <div class="card">
            <h3 style="color:var(--neon);">ПОПОЛНЕНИЕ</h3>
            <p style="font-size:13px;">Отправьте TON на кошелек ниже:</p>
            <div style="font-size:11px; background:#111; padding:15px; border-radius:10px; border:1px dashed var(--neon); word-break:break-all;" onclick="copy('${WALLET}')">${WALLET}</div>
            <p style="color:orange; font-size:14px; margin-top:20px;">УКАЖИТЕ ЭТОТ КОММЕНТАРИЙ:</p>
            <div id="u-id" style="font-size:35px; font-weight:bold; color:var(--neon);">...</div>
            <p style="font-size:10px; opacity:0.6;">Зачисление произойдет автоматически в течение 1-2 минут</p>
        </div>
    </div>

    <script>
        const tg = window.Telegram.WebApp;
        const uid = tg.initDataUnsafe?.user?.id || "12345";
        const items = ['🍒','7️⃣','💎','💰','⭐'];
        let isSpinning = false;

        function startMusic() { const m = document.getElementById('bgm'); if(m.paused) { m.volume = 0.2; m.play().catch(()=>{}); } }
        
        function sh(n) {
            document.querySelectorAll('.page').forEach((p,i)=>p.classList.toggle('active', i+1===n));
            document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active', i+1===n));
        }

        async function sync() {
            const r = await fetch('/api/sync', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid})});
            const d = await r.json();
            document.getElementById('bal').innerText = d.balance.toFixed(2);
            document.getElementById('u-id').innerText = uid;
            document.getElementById('st-s').innerText = d.spins || 0;
            document.getElementById('st-w').innerText = d.wins || 0;
        }

        function buildReels() {
            for(let i=1; i<=3; i++) {
                const s = document.getElementById('s'+i);
                let html = '';
                for(let j=0; j<41; j++) html += '<div class="sym">'+items[Math.floor(Math.random()*5)]+'</div>';
                s.innerHTML = html;
                s.style.transition = 'none';
                s.style.transform = 'translateY(0)';
            }
        }

        async function spin() {
            if(isSpinning) return;
            const bet = document.getElementById('bet').value;
            const r = await fetch('/api/spin', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, bet})});
            const d = await r.json();

            if(d.err) { tg.showAlert(d.err); return; }

            isSpinning = true;
            document.getElementById('spinBtn').disabled = true;
            tg.HapticFeedback.impactOccurred('medium');

            for(let i=1; i<=3; i++) {
                const s = document.getElementById('s'+i);
                s.lastElementChild.innerText = d.result[i-1];
                s.style.transition = 'none';
                s.style.transform = 'translateY(0)';
                setTimeout(() => {
                    s.style.transition = 'transform '+(1.8 + i*0.4)+'s cubic-bezier(0.15, 0.85, 0.15, 1)';
                    s.style.transform = 'translateY(-4400px)'; // 40 символов * 110px
                }, 50);
            }

            setTimeout(() => {
                isSpinning = false;
                document.getElementById('spinBtn').disabled = false;
                sync();
                if(d.winSum > 0) {
                    tg.HapticFeedback.notificationOccurred('success');
                    tg.showConfirm("🎉 ПОБЕДА! +"+d.winSum+" TON");
                }
            }, 3500);
        }

        async function applyP() {
            const code = document.getElementById('p-in').value;
            const r = await fetch('/api/promo', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, code})});
            const d = await r.json();
            tg.showAlert(d.err || d.msg);
            sync();
        }

        function copy(t) { navigator.clipboard.writeText(t); tg.showAlert("Скопировано!"); }

        buildReels();
        sync();
        tg.expand();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log("🚀 FULL SITE & BOT RUNNING"));
