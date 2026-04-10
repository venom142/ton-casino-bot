const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

const WALLET = "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn"; 
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = "mongodb+srv://sv2951605_db_user:zetatop123@cluster0.k5dri5s.mongodb.net/?appName=Cluster0";
const ADMIN_ID = 8475323865; 

mongoose.connect(MONGO_URI).then(() => console.log("DB: OK")).catch(() => console.log("DB: ERR"));

const User = mongoose.model('User', { 
    uid: String, 
    balance: { type: Number, default: 0.10 }, 
    s: { type: Number, default: 0 }, 
    w: { type: Number, default: 0 },
    promo: { type: [String], default: [] } 
});

const Tx = mongoose.model('Tx', { hash: String });
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
app.use(express.json());

bot.onText(/\/start/, async (m) => {
    let u = await User.findOne({ uid: m.from.id.toString() }) || await new User({ uid: m.from.id.toString() }).save();
    bot.sendMessage(m.chat.id, `💎 VIP TON ХОТ ТАП 💎\n\n💰 Баланс: ${u.balance.toFixed(2)} TON`, {
        reply_markup: { inline_keyboard: [[{ text: "🚀 ИГРАТЬ", web_app: { url: "https://ton-casino-bot.onrender.com" } }]] }
    });
});

// === ПОЧИНЕННЫЙ API SPIN (Барабаны вернутся!) ===
app.post('/api/spin', async (req, res) => {
    const { uid, bet } = req.body;
    const betVal = parseFloat(bet);
    const u = await User.findOne({ uid: uid.toString() });
    if (!u || u.balance < betVal) return res.json({ err: "МАЛО TON" });

    u.balance = Number((u.balance - betVal).toFixed(2)); u.s += 1;
    const syms = ['🍒','7️⃣','💎','💰','⭐','🎱'];
    let r;
    
    // ШАНС ПОБЕДЫ ~12% (оставляем, чтобы был азарт)
    if (Math.random() < 0.12) {
        const winSym = syms[Math.floor(Math.random() * syms.length)];
        r = [winSym, winSym, winSym];
    } else {
        r = [syms[Math.floor(Math.random()*6)], syms[Math.floor(Math.random()*6)], syms[Math.floor(Math.random()*6)]];
        if (r[0] === r[1] && r[1] === r[2]) r[2] = syms[(syms.indexOf(r[2]) + 1) % 6];
    }

    let win = 0; 
    if (r[0] === r[1] && r[1] === r[2]) { 
        let mult = 5; 
        if (r[0] === '7️⃣') mult = 15;
        if (r[0] === '💎') mult = 10;
        win = Number((betVal * mult).toFixed(2));
        u.balance += win; u.w += 1; 
    }
    
    await u.save(); 
    // ВАЖНО: возвращаем баланс, игры и победы, чтобы UI обновился
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
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; margin: 0; padding: 0; }
        body { 
            height: 100vh; overflow: hidden; 
            background: url('https://files.catbox.moe/622ngf.jpg') no-repeat center center fixed; 
            background-size: cover; color: #fff; font-family: sans-serif; display: flex; flex-direction: column; 
        }
        .nav-top { display: flex; gap: 5px; padding: 10px; z-index: 10; }
        .tab { flex: 1; padding: 12px; background: rgba(0,0,0,0.7); border: 1px solid #333; border-radius: 12px; font-size: 10px; font-weight: 800; color: #666; text-transform: uppercase; text-align: center; }
        .tab.active { border-color: #f0f; color: #fff; background: rgba(255,0,255,0.2); }
        .main-container { flex: 1; display: flex; flex-direction: column; justify-content: space-around; padding: 0 15px 25px; z-index: 5; }
        .card { background: rgba(0,0,0,0.85); border: 1px solid #0ff; padding: 20px; border-radius: 20px; text-align: center; box-shadow: 0 0 15px rgba(0,255,255,0.3); }
        .bal { font-size: 40px; font-weight: 900; color: #fff; text-shadow: 0 0 10px #0ff; }
        
        /* ЧИНЮ БАРАБАНЫ */
        .reels { display: flex; justify-content: center; gap: 8px; margin: 15px 0; }
        .reel-window { width: 30%; height: 80px; background: rgba(0,0,0,0.9); border: 2px solid #f0f; border-radius: 15px; overflow: hidden; position: relative; box-shadow: inset 0 0 10px #f0f; }
        .reel-strip { position: absolute; width: 100%; display: flex; flex-direction: column; align-items: center; top: 0; transition: transform 0.5s ease; }
        .symbol { height: 80px; display: flex; align-items: center; justify-content: center; font-size: 40px; }
        
        .btn-spin { width: 100%; padding: 20px; border-radius: 18px; border: none; background: linear-gradient(135deg, #ff00ff, #6e00ff); color: #fff; font-size: 20px; font-weight: 900; text-transform: uppercase; box-shadow: 0 0 20px rgba(255, 0, 255, 0.5); }
        .hidden { display: none !important; }
        
        /* ЧИНЮ ДЕПОЗИТ */
        .copy-box { background: #111; padding: 10px; border-radius: 10px; font-family: monospace; font-size: 11px; color: #0ff; border: 1px solid #333; margin-top: 5px; word-break: break-all; margin-bottom: 10px; }

        /* ЧИНЮ СТАТУ (Аккуратно и ровно) */
        .stat-card { border-color: #f0f; box-shadow: 0 0 15px rgba(255,0,255,0.3); padding: 15px; }
        .stat-title { color: #f0f; font-size: 18px; font-weight: 800; margin-bottom: 15px; text-shadow: 0 0 5px #f0f; }
        .stat-grid { display: flex; justify-content: space-around; align-items: center; margin-bottom: 15px; }
        .stat-item { text-align: center; flex: 1; }
        .stat-val { font-size: 32px; font-weight: 900; color: #fff; }
        .stat-label { font-size: 9px; color: #aaa; text-transform: uppercase; margin-top: -5px; }
        .stat-sep { width: 1px; height: 40px; background: #333; }
    </style>
</head>
<body>
    <audio id="bg-mus" loop src="https://files.catbox.moe/78surr.mp3"></audio>
    <div class="nav-top">
        <div class="tab active" id="t1" onclick="sw(1)">ИГРА</div>
        <div class="tab" id="t2" onclick="sw(2)">ИНФО</div>
        <div class="tab" id="t4" onclick="sw(4)">ДЕПОЗИТ</div>
    </div>
    <div class="main-container">
        <div id="p-game">
            <div class="card"><p style="font-size:10px; opacity:0.5;">БАЛАНС TON</p><div class="bal" id="v-bal">0.00</div></div>
            <div class="reels">
                <div class="reel-window"><div class="reel-strip" id="rs1"></div></div>
                <div class="reel-window"><div class="reel-strip" id="rs2"></div></div>
                <div class="reel-window"><div class="reel-strip" id="rs3"></div></div>
            </div>
            <button id="spin-btn" class="btn-spin" onclick="spin()">ИГРАТЬ</button>
        </div>
        
        <div id="p-stat" class="hidden">
            <div class="card stat-card">
                <div class="stat-title">СТАТИСТИКА</div>
                <div class="stat-grid">
                    <div class="stat-item"><div class="stat-val" id="v-s">0</div><div class="stat-label">Игр</div></div>
                    <div class="stat-sep"></div>
                    <div class="stat-item"><div class="stat-val" id="v-w" style="color: #0ff;">0</div><div class="stat-label">Побед</div></div>
                </div>
                <div style="font-size: 12px; color: #888;">Удача: <span id="v-luck" style="color:#fff">0</span>%</div>
            </div>
        </div>

        <div id="p-dep" class="hidden">
            <div class="card" style="text-align: left; padding: 15px;">
                <h3 style="color:#0ff; margin-bottom: 10px;">ДЕПОЗИТ</h3>
                <p style="font-size:11px; color: #ccc; margin-bottom: 8px;">Отправь TON на адрес с твоим ID в комментарии. Баланс пополнится автоматически за минуту.</p>
                <p style="font-size: 10px; color: #888;">АДРЕС:</p>
                <div class="copy-box" onclick="cp('${WALLET}')">${WALLET}</div>
                <p style="font-size: 10px; color: #888;">КОММЕНТАРИЙ (ОБЯЗАТЕЛЬНО):</p>
                <div class="copy-box" id="v-cid" onclick="cp(this.innerText)" style="color: #f0f; border-color: #f0f;">ID_...</div>
            </div>
        </div>
    </div>
    <script>
        const tg = window.Telegram.WebApp; tg.expand();
        const uid = tg.initDataUnsafe?.user?.id || "12345";
        const syms = ['🍒','7️⃣','💎','💰','⭐','🎱'];

        // ИНИЦИАЛИЗАЦИЯ БАРАБАНОВ (чтобы они не были пустыми)
        function initReels() {
            [1,2,3].forEach(id => {
                const s = document.getElementById('rs'+id);
                s.innerHTML = ''; // Чистим
                for(let i=0; i<3; i++) { // Добавляем по 3 символа
                    const div = document.createElement('div');
                    div.className = 'symbol';
                    div.innerText = syms[Math.floor(Math.random()*6)];
                    s.appendChild(div);
                }
            });
        }
        initReels(); // Запускаем сразу

        async function sync() {
            const r = await fetch('/api/sync', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({uid}) });
            const d = await r.json();
            document.getElementById('v-bal').innerText = d.balance.toFixed(2);
            document.getElementById('v-s').innerText = d.s; 
            document.getElementById('v-w').innerText = d.w;
            document.getElementById('v-cid').innerText = 'ID_' + uid;
            const luck = d.s > 0 ? ((d.w / d.s) * 100).toFixed(1) : 0;
            document.getElementById('v-luck').innerText = luck;
        }

        async function spin() {
            const btn = document.getElementById('spin-btn');
            btn.disabled = true;
            try {
                const r = await fetch('/api/spin', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({uid, bet: 0.01}) });
                const d = await r.json();
                if(d.err) { btn.disabled = false; return tg.showAlert(d.err); }
                
                // Простая анимация кручения
                [1,2,3].forEach((id, i) => {
                    const strip = document.getElementById('rs'+id);
                    strip.style.transform = 'translateY(-160px)'; // Крутим вниз
                    setTimeout(() => {
                        strip.style.transition = 'none';
                        strip.style.transform = 'translateY(0)';
                        strip.firstElementChild.innerText = d.r[i]; // Ставим выпавший символ первым
                        if(i === 2) { sync(); btn.disabled = false; strip.style.transition = 'transform 0.5s ease'; }
                    }, 500);
                });
            } catch (e) { btn.disabled = false; }
        }

        function sw(n) {
            document.getElementById('p-game').classList.toggle('hidden', n !== 1);
            document.getElementById('p-stat').classList.toggle('hidden', n !== 2);
            document.getElementById('p-dep').classList.toggle('hidden', n !== 4);
            [1,2,4].forEach(i => { if(document.getElementById('t'+i)) document.getElementById('t'+i).classList.toggle('active', n === i) });
        }
        function cp(t) { navigator.clipboard.writeText(t); tg.showAlert("Скопировано!"); }
        setInterval(sync, 5000); sync();
    </script>
</body>
</html>
    `);
});
app.listen(PORT, () => console.log("SERVER LIVE V0.5 - REPAIRED"));
