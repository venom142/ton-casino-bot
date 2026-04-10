const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

const WALLET = "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn"; 
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = "mongodb+srv://sv2951605_db_user:zetatop123@cluster0.k5dri5s.mongodb.net/?appName=Cluster0";
const ADMIN_PASS = "topsecret123"; // Пароль ТОЛЬКО для создания промокодов

mongoose.connect(MONGO_URI).then(() => console.log("DB: OK"));

const User = mongoose.model('User', { 
    uid: String, balance: { type: Number, default: 0.10 }, total_dep: { type: Number, default: 0 },
    s: { type: Number, default: 0 }, w: { type: Number, default: 0 },
    promo_used: { type: [String], default: [] } 
});

const Promo = mongoose.model('Promo', {
    code: { type: String, uppercase: true, unique: true }, amount: Number,
    limit: { type: Number, default: 1 }, used: { type: Number, default: 0 }
});

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
app.use(express.json());

// API
app.post('/api/sync', async (req, res) => {
    const u = await User.findOne({ uid: req.body.uid.toString() }) || await new User({ uid: req.body.uid.toString() }).save();
    res.json(u);
});

app.post('/api/admin/create-promo', async (req, res) => {
    const { code, amount, limit, pass } = req.body;
    if (pass !== ADMIN_PASS) return res.json({ err: "НЕВЕРНЫЙ ПАРОЛЬ" });
    try {
        await new Promo({ code, amount: parseFloat(amount), limit: parseInt(limit) }).save();
        res.json({ ok: true });
    } catch (e) { res.json({ err: "Ошибка (код занят)" }); }
});

app.post('/api/use-promo', async (req, res) => {
    const { uid, code } = req.body;
    const u = await User.findOne({ uid: uid.toString() });
    const p = await Promo.findOne({ code: code.toUpperCase() });
    if (!p || p.used >= p.limit) return res.json({ err: "КОД ИСТЕК ИЛИ НЕВЕРЕН" });
    if (u.promo_used.includes(code.toUpperCase())) return res.json({ err: "УЖЕ ЮЗАЛ" });
    u.balance += p.amount; u.promo_used.push(code.toUpperCase()); p.used += 1;
    await u.save(); await p.save();
    res.json({ ok: true, balance: u.balance });
});

app.post('/api/spin', async (req, res) => {
    const { uid, bet } = req.body;
    const u = await User.findOne({ uid: uid.toString() });
    if (!u || u.balance < bet) return res.json({ err: "МАЛО TON" });
    u.balance = Number((u.balance - bet).toFixed(2)); u.s += 1;
    const syms = ['🍒','7️⃣','💎','💰','⭐','🎱'];
    let r = (Math.random() < 0.15) ? Array(3).fill(syms[Math.floor(Math.random()*6)]) : [syms[Math.floor(Math.random()*6)], syms[Math.floor(Math.random()*6)], syms[Math.floor(Math.random()*6)]];
    let win = (r[0] === r[1] && r[1] === r[2]) ? Number((bet * 10).toFixed(2)) : 0;
    u.balance += win; if(win>0) u.w += 1; await u.save();
    res.json({ r, win, balance: u.balance, s: u.s, w: u.w });
});

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; outline: none; }
        body { height: 100vh; background: url('https://files.catbox.moe/622ngf.jpg') center/cover; color: #fff; font-family: sans-serif; display: flex; flex-direction: column; overflow: hidden; }
        .nav { display: flex; gap: 5px; padding: 10px; }
        .tab { flex: 1; padding: 12px; background: rgba(0,0,0,0.7); border: 1px solid #333; border-radius: 12px; font-size: 10px; text-align: center; font-weight: bold; }
        .tab.active { border-color: #f0f; background: rgba(255,0,255,0.2); }
        .main { flex: 1; padding: 15px; display: flex; flex-direction: column; justify-content: space-around; }
        .card { background: rgba(0,0,0,0.85); border: 1px solid #0ff; padding: 20px; border-radius: 20px; text-align: center; }
        .btn { width: 100%; padding: 15px; border-radius: 12px; border: none; background: linear-gradient(135deg, #f0f, #60f); color: #fff; font-weight: 900; margin-top: 10px; }
        .hidden { display: none !important; }
        input { width: 100%; padding: 12px; background: #111; border: 1px solid #333; color: #0ff; border-radius: 10px; margin: 5px 0; text-align: center; }
        .reels { display: flex; justify-content: center; gap: 8px; margin: 20px 0; }
        .window { width: 30%; height: 80px; background: #000; border: 2px solid #f0f; border-radius: 15px; overflow: hidden; position: relative; }
        .strip { position: absolute; width: 100%; top: 0; transition: transform 0.8s; }
        .sym { height: 80px; display: flex; align-items: center; justify-content: center; font-size: 40px; }
        input[type=range] { width: 100%; cursor: pointer; height: 6px; background: #333; border-radius: 5px; appearance: none; -webkit-appearance: none; margin: 15px 0; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; height: 18px; width: 18px; border-radius: 50%; background: #f0f; cursor: pointer; }
    </style>
</head>
<body>
    <audio id="m" loop src="https://files.catbox.moe/78surr.mp3"></audio>
    <div class="nav">
        <div class="tab active" onclick="sw(1)" id="t1">ИГРА</div>
        <div class="tab" onclick="sw(2)" id="t2">ИНФО</div>
        <div class="tab" onclick="sw(3)" id="t3">ДЕПОЗИТ</div>
        <div class="tab" onclick="sw(4)" id="t4">ОПЦИИ</div>
    </div>

    <div class="main">
        <div id="p1">
            <div class="card"><p style="font-size:10px; opacity:0.5;">БАЛАНС TON</p><div style="font-size:40px; font-weight:900;" id="v-bal">0.00</div></div>
            <div class="reels">
                <div class="window"><div class="strip" id="rs1"></div></div>
                <div class="window"><div class="strip" id="rs2"></div></div>
                <div class="window"><div class="strip" id="rs3"></div></div>
            </div>
            <button class="btn" id="s-btn" onclick="spin()">ИГРАТЬ</button>
        </div>

        <div id="p2" class="hidden">
            <div class="card">
                <h3>СТАТИСТИКА</h3>
                <p>Игр: <span id="v-s">0</span> | Побед: <span id="v-w">0</span></p>
                <div style="margin-top:15px; border-top:1px solid #333; padding-top:10px;">
                    <input id="p-in" placeholder="ЕСТЬ ПРОМОКОД?">
                    <button class="btn" onclick="useP()">АКТИВИРОВАТЬ</button>
                </div>
            </div>
        </div>

        <div id="p3" class="hidden">
            <div class="card">
                <h3 style="color:#0ff">ПОПОЛНЕНИЕ</h3>
                <p style="font-size:12px; margin: 10px 0;">Адрес для перевода:</p>
                <div style="background:#111; padding:10px; border-radius:10px; font-size:10px; color:#0ff; border:1px solid #333; word-break:break-all;">${WALLET}</div>
                <p style="font-size:12px; margin: 10px 0;">Комментарий (ID):</p>
                <div id="v-cid" style="background:#111; padding:10px; border-radius:10px; color:#f0f; border:1px solid #f0f; font-weight:bold;">ID_...</div>
            </div>
        </div>

        <div id="p4" class="hidden">
            <div class="card">
                <h3 style="color:#f0f">НАСТРОЙКИ ЗВУКА</h3>
                <p style="font-size:12px; margin-top:10px;">Громкость:</p>
                <input type="range" id="vol" min="0" max="1" step="0.1" value="0.5" oninput="setV(this.value)">
                <button class="btn" style="background:#333; font-size:12px;" onclick="tglM()" id="m-btn">ВЫКЛЮЧИТЬ МУЗЫКУ</button>
            </div>

            <div class="card" style="margin-top:10px; border-color:#ff0;">
                <h3 style="color:#ff0">АДМИН-ПРОМО</h3>
                <input id="ad-c" placeholder="КОД (GIFT100)">
                <input id="ad-s" type="number" placeholder="СУММА (0.50)">
                <input id="ad-l" type="number" placeholder="ЛИМИТ ЛЮДЕЙ">
                <input id="ad-p" type="password" placeholder="ПАРОЛЬ АДМИНА">
                <button class="btn" style="background:linear-gradient(135deg, #ff0, #f90); color:#000;" onclick="creP()">СОЗДАТЬ</button>
            </div>
        </div>
    </div>

    <script>
        const tg = window.Telegram.WebApp;
        const uid = tg.initDataUnsafe?.user?.id || "12345";
        const syms = ['🍒','7️⃣','💎','💰','⭐','🎱'];
        let isMuted = false;

        function setV(v) { document.getElementById('m').volume = v; }
        function tglM() { 
            const a = document.getElementById('m');
            const b = document.getElementById('m-btn');
            if(isMuted) { a.play(); b.innerText = "ВЫКЛЮЧИТЬ МУЗЫКУ"; } 
            else { a.pause(); b.innerText = "ВКЛЮЧИТЬ МУЗЫКУ"; }
            isMuted = !isMuted;
        }

        async function sync() {
            const r = await fetch('/api/sync', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid})});
            const d = await r.json();
            document.getElementById('v-bal').innerText = d.balance.toFixed(2);
            document.getElementById('v-s').innerText = d.s; document.getElementById('v-w').innerText = d.w;
            document.getElementById('v-cid').innerText = 'ID_' + uid;
        }

        async function spin() {
            const b = document.getElementById('s-btn'); b.disabled = true;
            const r = await fetch('/api/spin', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, bet:0.01})});
            const d = await r.json();
            if(d.err) { b.disabled = false; return tg.showAlert(d.err); }
            [1,2,3].forEach((id, i) => {
                const s = document.getElementById('rs'+id);
                s.style.transition = 'none'; s.style.transform = 'translateY(0)';
                s.lastElementChild.innerText = d.r[i];
                setTimeout(() => { s.style.transition = 'transform 0.8s'; s.style.transform = 'translateY(-1120px)'; }, 50);
            });
            setTimeout(() => { sync(); b.disabled = false; }, 900);
        }

        async function useP() {
            const r = await fetch('/api/use-promo', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, code: document.getElementById('p-in').value})});
            const d = await r.json(); tg.showAlert(d.ok ? "УСПЕХ!" : d.err); sync();
        }

        async function creP() {
            const r = await fetch('/api/admin/create-promo', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
                pass: document.getElementById('ad-p').value, code: document.getElementById('ad-c').value, 
                amount: document.getElementById('ad-s').value, limit: document.getElementById('ad-l').value
            })});
            const d = await r.json(); tg.showAlert(d.ok ? "ПРОМО СОЗДАН" : d.err);
        }

        function sw(n) { [1,2,3,4].forEach(i => {
            document.getElementById('p'+i).classList.toggle('hidden', i!==n);
            document.getElementById('t'+i).classList.toggle('active', i===n);
        });}

        function init() {
            [1,2,3].forEach(id => {
                const s = document.getElementById('rs'+id);
                for(let i=0; i<15; i++) {
                    const d = document.createElement('div'); d.className='sym';
                    d.innerText = syms[Math.floor(Math.random()*6)]; s.appendChild(d);
                }
            });
            document.getElementById('m').play().catch(()=>{});
        }
        init(); sync();
    </script>
</body>
</html>
    `);
});
app.listen(PORT, () => console.log("SERVER V1.1 OK"));
