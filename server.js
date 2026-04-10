const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

const WALLET = "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn"; 
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = "mongodb+srv://sv2951605_db_user:zetatop123@cluster0.k5dri5s.mongodb.net/?appName=Cluster0";
const ADMIN_ID = "8475323865"; 

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

app.post('/api/sync', async (req, res) => {
    const u = await User.findOne({ uid: req.body.uid.toString() }) || await new User({ uid: req.body.uid.toString() }).save();
    res.json(u);
});

app.post('/api/admin/create-promo', async (req, res) => {
    if (req.body.adminId !== ADMIN_ID) return res.json({ err: "DENIED" });
    const { code, amount, limit } = req.body;
    try {
        await new Promo({ code: code.toUpperCase(), amount: parseFloat(amount), limit: parseInt(limit) }).save();
        res.json({ ok: true });
    } catch (e) { res.json({ err: "Ошибка" }); }
});

app.post('/api/use-promo', async (req, res) => {
    const { uid, code } = req.body;
    const u = await User.findOne({ uid: uid.toString() });
    const p = await Promo.findOne({ code: code.toUpperCase() });
    if (!p || p.used >= p.limit) return res.json({ err: "НЕВЕРНЫЙ КОД" });
    if (u.promo_used.includes(code.toUpperCase())) return res.json({ err: "УЖЕ ЮЗАЛ" });
    u.balance += p.amount; u.promo_used.push(code.toUpperCase()); p.used += 1;
    await u.save(); await p.save();
    res.json({ ok: true, balance: u.balance });
});

app.post('/api/spin', async (req, res) => {
    const { uid, bet } = req.body;
    const betNum = parseFloat(bet);
    if (betNum < 0.01 || betNum > 1) return res.json({ err: "СТАВКА ОТ 0.01 ДО 1" });
    const u = await User.findOne({ uid: uid.toString() });
    if (!u || u.balance < betNum) return res.json({ err: "МАЛО TON" });
    u.balance = Number((u.balance - betNum).toFixed(2)); u.s += 1;
    const syms = ['🍒','7️⃣','💎','💰','⭐','🎱'];
    let r = (Math.random() < 0.12) ? Array(3).fill(syms[Math.floor(Math.random()*6)]) : [syms[Math.floor(Math.random()*6)], syms[Math.floor(Math.random()*6)], syms[Math.floor(Math.random()*6)]];
    let win = (r[0] === r[1] && r[1] === r[2]) ? Number((betNum * 10).toFixed(2)) : 0;
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
        * { box-sizing: border-box; margin: 0; padding: 0; outline: none; -webkit-tap-highlight-color: transparent; }
        body { height: 100vh; background: url('https://files.catbox.moe/622ngf.jpg') center/cover; color: #fff; font-family: sans-serif; display: flex; flex-direction: column; overflow: hidden; }
        .nav { display: flex; gap: 5px; padding: 10px; }
        .tab { flex: 1; padding: 12px; background: rgba(0,0,0,0.7); border: 1px solid #333; border-radius: 12px; font-size: 10px; text-align: center; font-weight: bold; }
        .tab.active { border-color: #f0f; background: rgba(255,0,255,0.2); }
        .main { flex: 1; padding: 15px; display: flex; flex-direction: column; justify-content: space-around; }
        .card { background: rgba(0,0,0,0.85); border: 1px solid #0ff; padding: 20px; border-radius: 20px; text-align: center; }
        .btn { width: 100%; padding: 16px; border-radius: 15px; border: none; background: linear-gradient(135deg, #f0f, #60f); color: #fff; font-weight: 900; margin-top: 10px; }
        .btn:disabled { opacity: 0.5; filter: grayscale(1); }
        input, select { width: 100%; padding: 12px; background: #111; border: 1px solid #333; color: #0ff; border-radius: 10px; margin: 5px 0; text-align: center; font-size: 16px; appearance: none; }
        .reels { display: flex; justify-content: center; gap: 8px; margin: 15px 0; }
        .window { width: 30%; height: 90px; background: #000; border: 3px solid #f0f; border-radius: 15px; overflow: hidden; position: relative; box-shadow: inset 0 0 15px rgba(255,0,255,0.5); }
        .strip { position: absolute; width: 100%; top: 0; left: 0; }
        .sym { height: 90px; display: flex; align-items: center; justify-content: center; font-size: 45px; }
    </style>
</head>
<body>
    <audio id="m" loop src="https://files.catbox.moe/78surr.mp3" preload="auto"></audio>
    <div class="nav">
        <div class="tab active" onclick="sw(1)" id="t1">ИГРА</div>
        <div class="tab" onclick="sw(2)" id="t2">ИНФО</div>
        <div class="tab" onclick="sw(3)" id="t3">ДЕПОЗИТ</div>
        <div class="tab" onclick="sw(4)" id="t4">ОПЦИИ</div>
    </div>

    <div class="main">
        <div id="p1">
            <div class="card">
                <p style="font-size:10px; opacity:0.6;">БАЛАНС TON</p>
                <div style="font-size:40px; font-weight:900; color:#0ff;" id="v-bal">0.00</div>
                <select id="bet-val" style="margin-top:10px;">
                    <option value="0.01">0.01 TON</option><option value="0.05">0.05 TON</option>
                    <option value="0.10">0.10 TON</option><option value="0.50">0.50 TON</option>
                    <option value="1.00">1.00 TON</option>
                </select>
            </div>
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
                <p style="margin:10px 0;">Игр: <span id="v-s">0</span> | Побед: <span id="v-w">0</span></p>
                <input id="p-in" placeholder="ПРОМОКОД">
                <button class="btn" onclick="useP()">АКТИВИРОВАТЬ</button>
            </div>
        </div>

        <div id="p3" class="hidden">
            <div class="card">
                <h3>ДЕПОЗИТ</h3>
                <p style="font-size:11px; opacity:0.7;">Адрес для перевода:</p>
                <div style="background:#111; padding:10px; border-radius:10px; font-size:10px; color:#0ff; border:1px solid #333; word-break:break-all;">${WALLET}</div>
                <div id="v-cid" style="margin-top:10px; color:#f0f; font-weight:bold;">ID_...</div>
            </div>
        </div>

        <div id="p4" class="hidden">
            <div class="card">
                <h3 style="color:#f0f">МУЗЫКА</h3>
                <input type="range" id="vol" min="0" max="1" step="0.1" value="0.5" oninput="setV(this.value)">
                <button class="btn" style="background:#333;" onclick="tglM()" id="m-btn">ВКЛЮЧИТЬ МУЗЫКУ</button>
            </div>
            <div class="card hidden" id="adm-box" style="border-color:#ff0; margin-top:10px;">
                <h3 style="color:#ff0">АДМИН</h3>
                <input id="ad-c" placeholder="КОД"><input id="ad-s" type="number" placeholder="СУММА"><input id="ad-l" type="number" placeholder="ЛИМИТ">
                <button class="btn" style="background:#ff0; color:#000;" onclick="creP()">СОЗДАТЬ</button>
            </div>
        </div>
    </div>

    <script>
        const tg = window.Telegram.WebApp;
        const uid = tg.initDataUnsafe?.user?.id || "12345";
        const syms = ['🍒','7️⃣','💎','💰','⭐','🎱'];
        let playing = false;

        function setV(v) { document.getElementById('m').volume = v; }
        function tglM() { 
            const a = document.getElementById('m'); const b = document.getElementById('m-btn');
            if(!playing) { a.play().then(() => { playing = true; b.innerText = "ВЫКЛЮЧИТЬ МУЗЫКУ"; }); } 
            else { a.pause(); playing = false; b.innerText = "ВКЛЮЧИТЬ МУЗЫКУ"; }
        }

        async function sync() {
            const r = await fetch('/api/sync', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid})});
            const d = await r.json();
            document.getElementById('v-bal').innerText = d.balance.toFixed(2);
            document.getElementById('v-s').innerText = d.s; document.getElementById('v-w').innerText = d.w;
            document.getElementById('v-cid').innerText = 'ID_' + uid;
            if(uid.toString() === "${ADMIN_ID}") document.getElementById('adm-box').classList.remove('hidden');
        }

        function buildReel(id) {
            const s = document.getElementById('rs'+id);
            s.innerHTML = '';
            for(let i=0; i<30; i++) {
                const d = document.createElement('div'); d.className='sym';
                d.innerText = syms[Math.floor(Math.random()*6)]; s.appendChild(d);
            }
        }

        async function spin() {
            const btn = document.getElementById('s-btn'); 
            const bet = document.getElementById('bet-val').value;
            btn.disabled = true;

            const r = await fetch('/api/spin', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, bet})});
            const d = await r.json();
            if(d.err) { btn.disabled = false; return tg.showAlert(d.err); }

            [1,2,3].forEach((id, i) => {
                const s = document.getElementById('rs'+id);
                // Подменяем самый последний символ на результат сервера
                s.children[29].innerText = d.r[i];
                
                s.style.transition = 'none';
                s.style.transform = 'translateY(0)';
                
                setTimeout(() => {
                    s.style.transition = 'transform ' + (1.5 + i*0.6) + 's cubic-bezier(0.1, 0, 0, 1)';
                    s.style.transform = 'translateY(-2610px)'; // (30-1) * 90px
                }, 50);
            });

            setTimeout(() => { 
                sync(); 
                btn.disabled = false; 
                if(d.win > 0) tg.showAlert("ВЫИГРЫШ: "+d.win+" TON!");
                // Пересобираем ленты для следующего раза (без анимации)
                [1,2,3].forEach(id => {
                    const s = document.getElementById('rs'+id);
                    s.style.transition = 'none';
                    s.style.transform = 'translateY(0)';
                });
            }, 3500);
        }

        async function useP() {
            const r = await fetch('/api/use-promo', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, code: document.getElementById('p-in').value})});
            const d = await r.json(); tg.showAlert(d.ok ? "УСПЕХ!" : d.err); sync();
        }

        async function creP() {
            const r = await fetch('/api/admin/create-promo', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
                adminId: uid.toString(), code: document.getElementById('ad-c').value, 
                amount: document.getElementById('ad-s').value, limit: document.getElementById('ad-l').value
            })});
            const d = await r.json(); tg.showAlert(d.ok ? "ГОТОВО" : d.err);
        }

        function sw(n) { [1,2,3,4].forEach(i => {
            document.getElementById('p'+i).classList.toggle('hidden', i!==n);
            document.getElementById('t'+i).classList.toggle('active', i===n);
        });}

        buildReel(1); buildReel(2); buildReel(3);
        sync();
    </script>
</body>
</html>
    `);
});
app.listen(PORT, () => console.log("SERVER V1.5 FINAL ANIMATION OK"));
