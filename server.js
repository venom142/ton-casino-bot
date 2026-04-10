const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = "mongodb+srv://sv2951605_db_user:zetatop123@cluster0.k5dri5s.mongodb.net/?appName=Cluster0";
const ADMIN_ID = "8475323865"; 

mongoose.connect(MONGO_URI).then(() => console.log("DB: OK"));

const User = mongoose.model('User', { 
    uid: String, 
    balance: { type: Number, default: 0.10 }, 
    total_dep: { type: Number, default: 0 },
    s: { type: Number, default: 0 }, 
    w: { type: Number, default: 0 },
    promo_used: { type: [String], default: [] } 
});

const Promo = mongoose.model('Promo', {
    code: { type: String, uppercase: true, unique: true },
    amount: Number, limit: { type: Number, default: 1 }, used: { type: Number, default: 0 }
});

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
app.use(express.json());

// === АДМИН-ДАННЫЕ (Глобальная стата) ===
app.post('/api/admin/stats', async (req, res) => {
    if (req.body.adminId !== ADMIN_ID) return res.json({ err: "DENIED" });
    const allUsers = await User.find();
    const totalUsers = allUsers.length;
    const totalDeposited = allUsers.reduce((sum, u) => sum + (u.total_dep || 0), 0);
    res.json({ totalUsers, totalDeposited });
});

app.post('/api/admin/create-promo', async (req, res) => {
    if (req.body.adminId !== ADMIN_ID) return res.json({ err: "DENIED" });
    try {
        await new Promo({ code: req.body.code, amount: req.body.amount, limit: req.body.limit }).save();
        res.json({ ok: true });
    } catch (e) { res.json({ err: "Уже есть" }); }
});

app.post('/api/use-promo', async (req, res) => {
    const { uid, code } = req.body;
    const p = await Promo.findOne({ code: code.toUpperCase() });
    const u = await User.findOne({ uid: uid.toString() });
    if (!p || p.used >= p.limit) return res.json({ err: "НЕВЕРНЫЙ КОД" });
    if (u.promo_used.includes(code.toUpperCase())) return res.json({ err: "ЮЗАЛ УЖЕ" });

    u.balance += p.amount;
    u.total_dep += p.amount;
    u.promo_used.push(code.toUpperCase());
    p.used += 1;
    await u.save(); await p.save();
    res.json({ ok: true, balance: u.balance });
});

app.post('/api/spin', async (req, res) => {
    const { uid, bet } = req.body;
    const u = await User.findOne({ uid: uid.toString() });
    if (!u || u.balance < bet) return res.json({ err: "МАЛО TON" });
    u.balance = Number((u.balance - bet).toFixed(2)); u.s += 1;
    
    const syms = ['🍒','7️⃣','💎','💰','⭐','🎱'];
    let r;
    if (Math.random() < 0.12) {
        const winSym = syms[Math.floor(Math.random()*6)];
        r = [winSym, winSym, winSym];
    } else {
        r = [syms[Math.floor(Math.random()*6)], syms[Math.floor(Math.random()*6)], syms[Math.floor(Math.random()*6)]];
        if (r[0] === r[1] && r[1] === r[2]) r[2] = syms[(syms.indexOf(r[2]) + 1) % 6];
    }

    let win = 0;
    if (r[0] === r[1] && r[1] === r[2]) {
        win = Number((bet * (r[0] === '7️⃣' ? 15 : 5)).toFixed(2));
        u.balance += win; u.w += 1;
    }
    await u.save();
    res.json({ r, win, balance: u.balance, s: u.s, w: u.w });
});

app.post('/api/sync', async (req, res) => {
    const u = await User.findOne({ uid: req.body.uid.toString() }) || await new User({ uid: req.body.uid.toString() }).save();
    res.json(u);
});

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; margin: 0; padding: 0; }
        body { height: 100vh; background: url('https://files.catbox.moe/622ngf.jpg') center/cover; color: #fff; font-family: sans-serif; display: flex; flex-direction: column; overflow: hidden; }
        .nav { display: flex; gap: 5px; padding: 10px; z-index: 10; }
        .tab { flex: 1; padding: 12px; background: rgba(0,0,0,0.7); border: 1px solid #333; border-radius: 12px; font-size: 10px; font-weight: 800; color: #666; text-align: center; }
        .tab.active { border-color: #f0f; color: #fff; background: rgba(255,0,255,0.2); }
        .main { flex: 1; display: flex; flex-direction: column; justify-content: space-around; padding: 15px; }
        .card { background: rgba(0,0,0,0.85); border: 1px solid #0ff; padding: 20px; border-radius: 20px; text-align: center; }
        .reels { display: flex; justify-content: center; gap: 8px; margin: 20px 0; }
        .window { width: 30%; height: 80px; background: #000; border: 2px solid #f0f; border-radius: 15px; overflow: hidden; position: relative; }
        .strip { position: absolute; width: 100%; top: 0; transition: transform 0.8s cubic-bezier(0.45, 0.05, 0.55, 0.95); }
        .sym { height: 80px; display: flex; align-items: center; justify-content: center; font-size: 40px; }
        .btn { width: 100%; padding: 18px; border-radius: 15px; border: none; background: linear-gradient(135deg, #f0f, #60f); color: #fff; font-weight: 900; }
        .hidden { display: none !important; }
        input { width: 100%; padding: 10px; background: #111; border: 1px solid #333; color: #fff; border-radius: 10px; margin: 5px 0; text-align: center; }
    </style>
</head>
<body onclick="document.getElementById('m').play()">
    <audio id="m" loop src="https://files.catbox.moe/78surr.mp3"></audio>
    <div class="nav">
        <div class="tab active" onclick="sw(1)" id="t1">ИГРА</div>
        <div class="tab" onclick="sw(2)" id="t2">ИНФО</div>
        <div class="tab" onclick="sw(3)" id="t3">ДЕПОЗИТ</div>
        <div class="tab hidden" onclick="sw(4)" id="t4">ОПЦИИ</div>
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
            <div class="card" style="border-color:#f0f;">
                <h3>СТАТИСТИКА</h3>
                <div style="display:flex; justify-content:space-around; margin:15px 0;">
                    <div><div style="font-size:24px; font-weight:900;" id="v-s">0</div><p style="font-size:9px; color:#888;">ИГР</p></div>
                    <div><div style="font-size:24px; font-weight:900; color:#0ff;" id="v-w">0</div><p style="font-size:9px; color:#888;">ПОБЕД</p></div>
                </div>
                <p style="font-size:11px; color:#aaa;">ЗАДОНЕНО: <span id="v-tdep" style="color:#ff0;">0.00</span> TON</p>
            </div>
        </div>

        <div id="p3" class="hidden">
            <div class="card">
                <h3>ДЕПОЗИТ</h3>
                <input id="p-in" placeholder="ПРОМОКОД">
                <button class="btn" style="padding:10px;" onclick="useP()">АКТИВИРОВАТЬ</button>
            </div>
        </div>

        <div id="p4" class="hidden">
            <div class="card" style="border-color:#ff0;">
                <h3 style="color:#ff0">ГЛОБАЛЬНАЯ СТАТА</h3>
                <div style="text-align:left; font-size:12px; margin: 10px 0; color:#ccc;">
                    <p>Юзеров: <span id="g-u" style="color:#fff">0</span></p>
                    <p>Всего TON: <span id="g-d" style="color:#fff">0</span></p>
                </div>
                <hr style="border:0; border-top:1px solid #333; margin:10px 0;">
                <input id="ad-c" placeholder="КОД">
                <input id="ad-s" type="number" placeholder="СУММА">
                <input id="ad-l" type="number" placeholder="ЛИМИТ">
                <button class="btn" onclick="creP()">СОЗДАТЬ</button>
            </div>
        </div>
    </div>

    <script>
        const tg = window.Telegram.WebApp;
        const uid = tg.initDataUnsafe?.user?.id || "12345";
        const syms = ['🍒','7️⃣','💎','💰','⭐','🎱'];

        function init() {
            [1,2,3].forEach(id => {
                const s = document.getElementById('rs'+id); s.innerHTML = '';
                for(let i=0; i<15; i++) {
                    const d = document.createElement('div'); d.className='sym';
                    d.innerText = syms[Math.floor(Math.random()*6)]; s.appendChild(d);
                }
            });
            if(uid.toString() === "${ADMIN_ID}") document.getElementById('t4').classList.remove('hidden');
        }

        async function sync() {
            const r = await fetch('/api/sync', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid})});
            const d = await r.json();
            document.getElementById('v-bal').innerText = d.balance.toFixed(2);
            document.getElementById('v-s').innerText = d.s; 
            document.getElementById('v-w').innerText = d.w;
            document.getElementById('v-tdep').innerText = (d.total_dep || 0).toFixed(2);
            
            if(uid.toString() === "${ADMIN_ID}") {
                const gr = await fetch('/api/admin/stats', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({adminId: uid.toString()})});
                const gd = await gr.json();
                document.getElementById('g-u').innerText = gd.totalUsers;
                document.getElementById('g-d').innerText = gd.totalDeposited.toFixed(2);
            }
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
                setTimeout(() => {
                    s.style.transition = 'transform 0.8s cubic-bezier(0.45, 0.05, 0.55, 0.95)';
                    s.style.transform = 'translateY(-1120px)';
                }, 50);
            });
            setTimeout(() => { sync(); b.disabled = false; }, 900);
        }

        async function useP() {
            const code = document.getElementById('p-in').value;
            const r = await fetch('/api/use-promo', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, code})});
            const d = await r.json();
            tg.showAlert(d.ok ? "УСПЕХ" : d.err); sync();
        }

        async function creP() {
            const r = await fetch('/api/admin/create-promo', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
                adminId: uid.toString(), code: document.getElementById('ad-c').value, 
                amount: document.getElementById('ad-s').value, limit: document.getElementById('ad-l').value
            })});
            const d = await r.json(); tg.showAlert(d.ok ? "ГОТОВО" : d.err);
        }

        function sw(n) { [1,2,3,4].forEach(i => {
            document.getElementById('p'+i)?.classList.toggle('hidden', i!==n);
            document.getElementById('t'+i)?.classList.toggle('active', i===n);
        });}

        init(); sync();
    </script>
</body>
</html>
    `);
});
app.listen(PORT, () => console.log("SERVER V0.8.1 LIVE"));
