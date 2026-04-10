const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 10000; 

// ==========================================
// КОНФИГУРАЦИЯ (ЗАМЕНИ ССЫЛКУ НИЖЕ)
// ==========================================
const WALLET = "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn"; 
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = "mongodb+srv://sv2951605_db_user:zetatop123@cluster0.k5dri5s.mongodb.net/?appName=Cluster0";
const ADMIN_ID = "8475323865"; 
const APP_URL = "https://твой-проект.onrender.com"; // <--- СЮДА ССЫЛКУ

// ПОДКЛЮЧЕНИЕ К БД С ОБРАБОТКОЙ ОШИБОК
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Database: Connected"))
    .catch(err => console.error("❌ Database Error:", err));

// МОДЕЛИ ДАННЫХ
const User = mongoose.model('User', { 
    uid: String, 
    balance: { type: Number, default: 0.10 }, 
    s: { type: Number, default: 0 }, 
    w: { type: Number, default: 0 },
    promo_used: { type: [String], default: [] } 
});

const Promo = mongoose.model('Promo', {
    code: { type: String, uppercase: true, unique: true }, 
    amount: Number,
    limit: { type: Number, default: 1 }, 
    used: { type: Number, default: 0 }
});

// ИНИЦИАЛИЗАЦИЯ БОТА
if (BOT_TOKEN) {
    const bot = new TelegramBot(BOT_TOKEN, { polling: true });
    bot.onText(/\/start/, (msg) => {
        bot.sendMessage(msg.chat.id, "💎 **ДОБРО ПОЖАЛОВАТЬ В VIP TON SLOTS!**\n\nЖми кнопку ниже, чтобы начать игру.", {
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: [[{ text: "🎰 ИГРАТЬ", web_app: { url: APP_URL } }]] }
        });
    });
}

app.use(express.json());

// API: СИНХРОНИЗАЦИЯ
app.post('/api/sync', async (req, res) => {
    try {
        const { uid } = req.body;
        let u = await User.findOne({ uid: uid.toString() });
        if (!u) u = await new User({ uid: uid.toString() }).save();
        res.json(u);
    } catch(e) { res.status(500).json({err: "db_error"}); }
});

// API: ЛОГИКА КАЗИНО
app.post('/api/spin', async (req, res) => {
    try {
        const { uid, bet } = req.body;
        const b = parseFloat(bet);
        const u = await User.findOne({ uid: uid.toString() });
        
        if (!u || u.balance < b) return res.json({ err: "МАЛО TON" });
        
        u.balance = Number((u.balance - b).toFixed(2));
        u.s += 1;
        
        const syms = ['🍒','7️⃣','💎','💰','⭐','🎱'];
        let r;
        const winChance = Math.random();
        
        if (winChance < 0.12) { // 12% ШАНС НА ДЖЕКПОТ
            const s = syms[Math.floor(Math.random()*6)];
            r = [s, s, s];
        } else {
            r = [syms[Math.floor(Math.random()*6)], syms[Math.floor(Math.random()*6)], syms[Math.floor(Math.random()*6)]];
            if(r[0]===r[1] && r[1]===r[2]) r[2] = syms[(syms.indexOf(r[2])+1)%6];
        }
        
        let win = (r[0]===r[1] && r[1]===r[2]) ? Number((b * 10).toFixed(2)) : 0;
        u.balance += win; if(win > 0) u.w += 1;
        await u.save();
        
        res.json({ r, win, balance: u.balance, s: u.s, w: u.w });
    } catch(e) { res.json({err: "server_error"}); }
});

// API: ПРОМОКОДЫ
app.post('/api/use-promo', async (req, res) => {
    try {
        const { uid, code } = req.body;
        const p = await Promo.findOne({ code: code.toUpperCase() });
        const u = await User.findOne({ uid: uid.toString() });
        
        if (!p || p.used >= p.limit || u.promo_used.includes(code.toUpperCase())) {
            return res.json({ err: "НЕВАЛИДНЫЙ КОД" });
        }
        
        u.balance += p.amount;
        u.promo_used.push(code.toUpperCase());
        p.used += 1;
        await u.save(); await p.save();
        res.json({ ok: true, balance: u.balance });
    } catch(e) { res.json({err: "promo_error"}); }
});

// ==========================================
// ФРОНТЕНД (HTML/CSS/JS)
// ==========================================
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>TON SLOTS PRO</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        :root { --accent: #0ff; --pink: #f0f; --bg: #000; }
        * { box-sizing: border-box; margin: 0; padding: 0; outline: none; }
        body { height: 100vh; background: var(--bg) url('https://files.catbox.moe/622ngf.jpg') center/cover; color: #fff; font-family: sans-serif; overflow: hidden; }
        
        .nav { display: flex; gap: 5px; padding: 12px; background: rgba(0,0,0,0.8); border-bottom: 1px solid #222; }
        .tab { flex: 1; padding: 12px; background: #111; border: 1px solid #333; border-radius: 12px; font-size: 10px; text-align: center; font-weight: bold; opacity: 0.5; transition: 0.3s; }
        .tab.active { opacity: 1; border-color: var(--pink); background: rgba(255,0,255,0.1); }
        
        .page { height: calc(100vh - 70px); padding: 20px; display: flex; flex-direction: column; align-items: center; overflow-y: auto; }
        .card { width: 100%; background: rgba(0,0,0,0.9); border: 2px solid var(--accent); padding: 25px; border-radius: 25px; text-align: center; margin-bottom: 15px; box-shadow: 0 0 20px rgba(0,255,255,0.2); }
        
        .bal-val { font-size: 50px; font-weight: 900; color: var(--accent); text-shadow: 0 0 15px var(--accent); }
        select, input { width: 100%; padding: 16px; background: #050505; border: 1px solid #333; color: var(--accent); border-radius: 15px; margin: 10px 0; text-align: center; font-size: 18px; font-weight: bold; }
        
        .reels { display: flex; gap: 10px; margin: 25px 0; }
        .window { width: 85px; height: 85px; background: #000; border: 3px solid var(--pink); border-radius: 18px; overflow: hidden; position: relative; }
        .strip { position: absolute; width: 100%; top: 0; }
        .sym { height: 85px; display: flex; align-items: center; justify-content: center; font-size: 45px; }
        
        .btn { width: 100%; padding: 20px; border-radius: 20px; border: none; background: linear-gradient(135deg, var(--pink), #60f); color: #fff; font-weight: 900; font-size: 22px; cursor: pointer; transition: 0.2s; box-shadow: 0 5px 15px rgba(255,0,255,0.4); }
        .btn:active { transform: scale(0.95); }
        .btn:disabled { background: #333; box-shadow: none; opacity: 0.5; }
        
        .copy-box { background: #0a0a0a; padding: 15px; border-radius: 12px; border: 1px dashed var(--accent); color: var(--accent); font-size: 11px; word-break: break-all; margin: 10px 0; cursor: pointer; }
        .hidden { display: none !important; }
        
        .stat-row { display: flex; justify-content: space-around; width: 100%; margin: 15px 0; }
        .stat-box b { font-size: 24px; color: var(--accent); }
    </style>
</head>
<body>
    <audio id="m" loop src="https://files.catbox.moe/78surr.mp3"></audio>
    <div class="nav">
        <div class="tab active" onclick="sw(1)" id="t1">ИГРА</div>
        <div class="tab" onclick="sw(2)" id="t2">ПРОФИЛЬ</div>
        <div class="tab" onclick="sw(3)" id="t3">ДЕПОЗИТ</div>
        <div class="tab" onclick="sw(4)" id="t4">ОПЦИИ</div>
    </div>

    <div id="p1" class="page">
        <div class="card">
            <p style="font-size:10px; opacity:0.6; letter-spacing:2px;">ВАШ БАЛАНС TON</p>
            <div class="bal-val" id="v-bal">0.00</div>
            <select id="bet-val">
                <option value="0.01">СТАВКА: 0.01 TON</option>
                <option value="0.05">СТАВКА: 0.05 TON</option>
                <option value="0.10">СТАВКА: 0.10 TON</option>
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
        <div class="card" style="border-color: var(--pink);">
            <h3 style="color: var(--pink)">ВАША СТАТИСТИКА</h3>
            <div class="stat-row">
                <div class="stat-box"><b id="v-s">0</b><br><small>Игр</small></div>
                <div class="stat-box"><b id="v-w">0</b><br><small>Побед</small></div>
            </div>
            <input id="p-in" placeholder="ПРОМОКОД">
            <button class="btn" style="font-size:14px; padding:12px;" onclick="useP()">АКТИВИРОВАТЬ</button>
        </div>
    </div>

    <div id="p3" class="page hidden">
        <div class="card">
            <h3 style="color: var(--accent)">ПОПОЛНЕНИЕ</h3>
            <p style="font-size:11px; margin:10px 0;">Переведите TON на кошелек:</p>
            <div class="copy-box" onclick="cp('${WALLET}')">${WALLET}</div>
            <p style="font-size:11px; color: var(--pink)">ВАЖНО: В комментарии укажите свой ID!</p>
            <div id="v-cid" class="copy-box" style="border-color:var(--pink); color:var(--pink); font-size:20px; font-weight:bold;" onclick="cp(this.innerText.split('_')[1])">ЗАГРУЗКА...</div>
        </div>
    </div>

    <div id="p4" class="page hidden">
        <div class="card">
            <h3>НАСТРОЙКИ</h3>
            <button class="btn" style="background:#222;" onclick="tglM()" id="m-btn">ВКЛЮЧИТЬ МУЗЫКУ</button>
        </div>
        <div id="adm" class="card hidden" style="border-color:yellow;">
            <h3 style="color:yellow">ADMIN PANEL</h3>
            <p style="font-size:12px;">ID подтвержден. Доступ разрешен.</p>
        </div>
    </div>

    <script>
        const tg = window.Telegram.WebApp;
        const uid = tg.initDataUnsafe?.user?.id || "12345";
        const syms = ['🍒','7️⃣','💎','💰','⭐','🎱'];
        let isSpinning = false;

        function cp(t) { navigator.clipboard.writeText(t); tg.showAlert("Скопировано!"); }
        function sw(n) { [1,2,3,4].forEach(i => {
            document.getElementById('p'+i).classList.toggle('hidden', i!==n);
            document.getElementById('t'+i).classList.toggle('active', i===n);
        }); }
        
        function tglM() {
            const a = document.getElementById('m'), b = document.getElementById('m-btn');
            if(a.paused) { a.play(); b.innerText="ВЫКЛЮЧИТЬ МУЗЫКУ"; }
            else { a.pause(); b.innerText="ВКЛЮЧИТЬ МУЗЫКУ"; }
        }

        async function sync() {
            try {
                const r = await fetch('/api/sync', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid})});
                const d = await r.json();
                document.getElementById('v-bal').innerText = d.balance.toFixed(2);
                document.getElementById('v-s').innerText = d.s;
                document.getElementById('v-w').innerText = d.w;
                document.getElementById('v-cid').innerText = 'ID_' + uid;
                if(uid.toString()==="${ADMIN_ID}") document.getElementById('adm').classList.remove('hidden');
            } catch(e) {}
        }

        async function useP() {
            const code = document.getElementById('p-in').value;
            const r = await fetch('/api/use-promo', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, code})});
            const d = await r.json();
            if(d.err) tg.showAlert(d.err); else { tg.showAlert("Баланс пополнен!"); sync(); }
        }

        function build(id) {
            const s = document.getElementById('rs'+id); s.innerHTML = '';
            for(let i=0; i<30; i++) {
                const d = document.createElement('div'); d.className='sym';
                d.innerText = syms[Math.floor(Math.random()*6)]; s.appendChild(d);
            }
        }

        async function spin() {
            if(isSpinning) return; isSpinning = true;
            const btn = document.getElementById('s-btn'); btn.disabled = true;
            try {
                const res = await fetch('/api/spin', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, bet: document.getElementById('bet-val').value})});
                const d = await res.json();
                if(d.err) { btn.disabled = false; isSpinning = false; return tg.showAlert(d.err); }

                [1,2,3].forEach((id, i) => {
                    const s = document.getElementById('rs'+id);
                    s.children[29].innerText = d.r[i];
                    s.style.transition = 'none'; s.style.transform = 'translateY(0)';
                    setTimeout(() => {
                        s.style.transition = 'transform '+(1.5+i*0.5)+'s cubic-bezier(0.1,0,0,1)';
                        s.style.transform = 'translateY(-2465px)';
                    }, 50);
                });
                setTimeout(() => { sync(); btn.disabled = false; isSpinning = false; if(d.win>0) tg.showAlert("ПОБЕДА: "+d.win+" TON!"); }, 3000);
            } catch(e) { btn.disabled = false; isSpinning = false; }
        }

        build(1); build(2); build(3); sync(); tg.expand();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log("--- SERVER LIVE ON PORT " + PORT + " ---"));
