const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 10000; 

const WALLET = "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn"; 
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = "mongodb+srv://sv2951605_db_user:zetatop123@cluster0.k5dri5s.mongodb.net/?appName=Cluster0";
const ADMIN_ID = "8475323865"; 

mongoose.connect(MONGO_URI).then(() => console.log("DB OK"));

const User = mongoose.model('User', { 
    uid: String, balance: { type: Number, default: 0.10 }, 
    s: { type: Number, default: 0 }, w: { type: Number, default: 0 },
    promo_used: { type: [String], default: [] } 
});

const Promo = mongoose.model('Promo', {
    code: { type: String, uppercase: true, unique: true }, amount: Number,
    limit: { type: Number, default: 1 }, used: { type: Number, default: 0 }
});

// Инициализация бота с проверкой
if (BOT_TOKEN) {
    const bot = new TelegramBot(BOT_TOKEN, { polling: true });
    console.log("Bot status: ACTIVE");
}

app.use(express.json());

// Глобальная статистика для админки
app.get('/api/admin/stats', async (req, res) => {
    const all = await User.find();
    const totalUsers = all.length;
    const totalBal = all.reduce((sum, u) => sum + u.balance, 0).toFixed(2);
    res.json({ totalUsers, totalBal });
});

app.post('/api/sync', async (req, res) => {
    const u = await User.findOne({ uid: req.body.uid.toString() }) || await new User({ uid: req.body.uid.toString() }).save();
    res.json(u);
});

app.post('/api/spin', async (req, res) => {
    const { uid, bet } = req.body;
    const betNum = parseFloat(bet);
    const u = await User.findOne({ uid: uid.toString() });
    if (!u || u.balance < betNum) return res.json({ err: "МАЛО TON" });
    
    u.balance = Number((u.balance - betNum).toFixed(2)); u.s += 1;
    const syms = ['🍒','7️⃣','💎','💰','⭐','🎱'];
    let r = (Math.random() < 0.15) ? Array(3).fill(syms[Math.floor(Math.random()*6)]) : [syms[Math.floor(Math.random()*6)], syms[Math.floor(Math.random()*6)], syms[Math.floor(Math.random()*6)]];
    let win = (r[0] === r[1] && r[1] === r[2]) ? Number((betNum * 10).toFixed(2)) : 0;
    u.balance += win; if(win>0) u.w += 1; await u.save();
    res.json({ r, win, balance: u.balance, s: u.s, w: u.w });
});

app.post('/api/use-promo', async (req, res) => {
    const { uid, code } = req.body;
    const u = await User.findOne({ uid: uid.toString() });
    const p = await Promo.findOne({ code: code.toUpperCase() });
    if (!p || p.used >= p.limit || u.promo_used.includes(code.toUpperCase())) return res.json({ err: "ОШИБКА КОДА" });
    u.balance += p.amount; u.promo_used.push(code.toUpperCase()); p.used += 1;
    await u.save(); await p.save();
    res.json({ ok: true, balance: u.balance });
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
        body { height: 100vh; background: #000 url('https://files.catbox.moe/622ngf.jpg') center/cover no-repeat; color: #fff; font-family: sans-serif; overflow: hidden; }
        .nav { display: flex; gap: 5px; padding: 10px; background: rgba(0,0,0,0.8); }
        .tab { flex: 1; padding: 12px; background: #111; border: 1px solid #333; border-radius: 12px; font-size: 10px; text-align: center; font-weight: bold; opacity: 0.5; }
        .tab.active { opacity: 1; border-color: #f0f; background: rgba(255,0,255,0.1); }
        .page { height: calc(100vh - 65px); padding: 15px; display: flex; flex-direction: column; overflow-y: auto; align-items: center; }
        .card { width: 100%; background: rgba(0,0,0,0.9); border: 1.5px solid #0ff; padding: 20px; border-radius: 20px; text-align: center; margin-bottom: 15px; }
        .btn { width: 100%; padding: 16px; border-radius: 15px; border: none; background: linear-gradient(135deg, #f0f, #60f); color: #fff; font-weight: bold; font-size: 18px; cursor: pointer; }
        .btn:active { transform: scale(0.95); }
        input, select { width: 100%; padding: 14px; background: #050505; border: 1px solid #333; color: #0ff; border-radius: 12px; margin: 10px 0; text-align: center; font-size: 16px; font-weight: bold; }
        .reels { display: flex; justify-content: center; gap: 10px; margin: 20px 0; }
        .window { width: 85px; height: 85px; background: #000; border: 2px solid #f0f; border-radius: 15px; overflow: hidden; position: relative; }
        .strip { position: absolute; width: 100%; top: 0; }
        .sym { height: 85px; display: flex; align-items: center; justify-content: center; font-size: 45px; }
        .hidden { display: none !important; }
        .copy-box { background: #111; padding: 12px; border-radius: 10px; border: 1px dashed #0ff; color: #0ff; font-size: 11px; word-break: break-all; margin: 10px 0; cursor: pointer; }
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

    <div id="p1" class="page">
        <div class="card">
            <p style="font-size:10px; opacity:0.6;">БАЛАНС TON</p>
            <div style="font-size:45px; font-weight:900; color:#0ff;" id="v-bal">0.00</div>
            <select id="bet-val">
                <option value="0.01">0.01 TON</option><option value="0.05">0.05 TON</option>
                <option value="0.10">0.10 TON</option><option value="0.50">0.50 TON</option>
            </select>
        </div>
        <div class="reels">
            <div class="window"><div class="strip" id="rs1"></div></div>
            <div class="window"><div class="strip" id="rs2"></div></div>
            <div class="window"><div class="strip" id="rs3"></div></div>
        </div>
        <button class="btn" id="s-btn" onclick="spin()">ИГРАТЬ</button>
    </div>

    <div id="p2" class="page hidden">
        <div class="card">
            <h3 style="color:#f0f; margin-bottom:15px;">ВАША СТАТА</h3>
            <div style="display:flex; justify-content:space-around;">
                <div><b id="v-s" style="font-size:20px;">0</b><br><small>Игр</small></div>
                <div><b id="v-w" style="font-size:20px;">0</b><br><small>Побед</small></div>
            </div>
            <input id="p-in" placeholder="ПРОМОКОД">
            <button class="btn" onclick="useP()">ОК</button>
        </div>
    </div>

    <div id="p3" class="page hidden">
        <div class="card">
            <h3 style="color:#0ff">ДЕПОЗИТ</h3>
            <p style="font-size:11px; margin:10px 0;">Кликни, чтобы скопировать:</p>
            <div class="copy-box" onclick="cp('${WALLET}')">${WALLET}</div>
            <div style="margin-top:15px; font-size:12px;">ТВОЙ ID ДЛЯ КОММЕНТА:</div>
            <div class="copy-box" style="color:#f0f; border-color:#f0f; font-size:20px;" onclick="cp(this.innerText.split('_')[1])" id="v-cid">ID_...</div>
        </div>
    </div>

    <div id="p4" class="page hidden">
        <div class="card">
            <h3>ЗВУК</h3>
            <input type="range" min="0" max="1" step="0.1" value="0.5" oninput="document.getElementById('m').volume=this.value">
            <button class="btn" style="background:#333;" onclick="tglM()" id="m-btn">ВКЛЮЧИТЬ МУЗЫКУ</button>
        </div>
        <div id="adm" class="card hidden" style="border-color:yellow;">
            <h3 style="color:yellow">АДМИНКА</h3>
            <div id="g-st" style="font-size:11px; margin-bottom:10px;">Юзеров: ? | TON: ?</div>
            <input id="ad-c" placeholder="КОД"><input id="ad-s" placeholder="СУММА">
            <button class="btn" style="background:yellow; color:#000;" onclick="alert('Done')">СОЗДАТЬ</button>
        </div>
    </div>

    <script>
        const tg = window.Telegram.WebApp;
        const uid = tg.initDataUnsafe?.user?.id || "12345";
        const syms = ['🍒','7️⃣','💎','💰','⭐','🎱'];
        let playing = false;

        function cp(t) { navigator.clipboard.writeText(t); tg.showAlert("Скопировано: " + t); }
        function sw(n) { [1,2,3,4].forEach(i => { document.getElementById('p'+i).classList.toggle('hidden', i!==n); document.getElementById('t'+i).classList.toggle('active', i===n); }); }
        
        function tglM() {
            const a = document.getElementById('m');
            if(!playing) { a.play(); playing=true; document.getElementById('m-btn').innerText="ВЫКЛЮЧИТЬ"; }
            else { a.pause(); playing=false; document.getElementById('m-btn').innerText="ВКЛЮЧИТЬ"; }
        }

        async function sync() {
            const r = await fetch('/api/sync', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid})});
            const d = await r.json();
            document.getElementById('v-bal').innerText = d.balance.toFixed(2);
            document.getElementById('v-s').innerText = d.s; document.getElementById('v-w').innerText = d.w;
            document.getElementById('v-cid').innerText = 'ID_' + uid;
            if(uid.toString()==="${ADMIN_ID}") {
                document.getElementById('adm').classList.remove('hidden');
                const sr = await fetch('/api/admin/stats'); const sd = await sr.json();
                document.getElementById('g-st').innerText = "Юзеров: "+sd.totalUsers+" | TON: "+sd.totalBal;
            }
        }

        function build(id) {
            const s = document.getElementById('rs'+id); s.innerHTML = '';
            for(let i=0; i<30; i++) {
                const d = document.createElement('div'); d.className='sym';
                d.innerText = syms[Math.floor(Math.random()*6)]; s.appendChild(d);
            }
        }

        async function spin() {
            const btn = document.getElementById('s-btn'); btn.disabled = true;
            const res = await fetch('/api/spin', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, bet: document.getElementById('bet-val').value})});
            const d = await res.json();
            if(d.err) { btn.disabled = false; return tg.showAlert(d.err); }

            [1,2,3].forEach((id, i) => {
                const s = document.getElementById('rs'+id);
                s.children[29].innerText = d.r[i];
                s.style.transition = 'none'; s.style.transform = 'translateY(0)';
                setTimeout(() => {
                    s.style.transition = 'transform '+(1.5+i*0.5)+'s cubic-bezier(0.1,0,0,1)';
                    s.style.transform = 'translateY(-2465px)';
                }, 50);
            });

            setTimeout(() => { sync(); btn.disabled = false; if(d.win>0) tg.showAlert("ВЫИГРЫШ: "+d.win+" TON!"); }, 3000);
        }

        build(1); build(2); build(3);
        sync(); tg.expand();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log("Server Live on " + PORT));
