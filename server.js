const express = require('express');
const axios = require('axios');
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000;

// === НАСТРОЙКИ ===
const MY_WALLET = "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn";
const BOT_TOKEN = process.env.BOT_TOKEN; 
const URL_APP = "https://ton-casino-bot.onrender.com"; 
const SUPPORT_USER = "твой_логин"; // Твой ник без @

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const DB_FILE = './database.json';

if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ users: {}, txs: [] }));
function getDB() { return JSON.parse(fs.readFileSync(DB_FILE)); }
function setDB(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }

app.use(express.json());

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "💎 **VIP TON ХОТ ТАП 1.0**\n\nИспытай свою удачу!", {
        reply_markup: { inline_keyboard: [[{ text: "🎰 ИГРАТЬ", web_app: { url: URL_APP } }]] },
        parse_mode: 'Markdown'
    }).catch(e => console.log("Bot Error"));
});

app.post('/api/init', (req, res) => {
    const { uid } = req.body;
    let db = getDB();
    if (!db.users[uid]) db.users[uid] = { b: 0.10, s: 0, w: 0 };
    setDB(db);
    res.json(db.users[uid]);
});

app.post('/api/spin', (req, res) => {
    const { uid } = req.body;
    let db = getDB();
    let u = db.users[uid];
    if (!u || parseFloat(u.b) < 0.05) return res.json({ err: "Минимум 0.05 TON" });
    u.b = Number((u.b - 0.05).toFixed(2));
    u.s++;
    const s = ['💎','💰','7️⃣','🍒','⭐'];
    let r = []; let win = 0;
    if (Math.random() < 0.10) { 
        const ws = s[Math.floor(Math.random()*s.length)];
        r = [ws, ws, ws]; win = 0.5; u.b = Number((u.b + win).toFixed(2)); u.w++;
    } else {
        r = [s[0], s[1], s[2]].sort(()=>Math.random()-0.5);
        if(r[0]===r[1]&&r[1]===r[2]) r[2]=s[(s.indexOf(r[2])+1)%5];
    }
    setDB(db);
    res.json({ reels: r, win, b: u.b, s: u.s, w: u.w });
});

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        body { background: #040816; color: white; font-family: sans-serif; text-align: center; margin: 0; padding: 15px; }
        .nav { display: flex; justify-content: space-around; background: #0a1125; padding: 12px; border-radius: 20px; margin-bottom: 20px; border: 1px solid #00d4ff33; }
        .nav span { font-size: 11px; font-weight: bold; color: #00d4ff; opacity: 0.4; }
        .nav .active { opacity: 1; text-shadow: 0 0 8px #00d4ff; }
        .card { background: #0a1125; padding: 25px; border-radius: 30px; border: 1px solid #00d4ff4d; position: relative; }
        .bal { font-size: 50px; color: #00d4ff; font-weight: bold; margin: 10px 0; }
        .slots { display: flex; justify-content: center; gap: 8px; margin: 20px 0; }
        .reel { width: 80px; height: 100px; background: #000; border-radius: 20px; font-size: 40px; display: flex; align-items: center; justify-content: center; border: 1px solid #1a2c4d; }
        .btn-spin { background: linear-gradient(135deg, #00d4ff, #0088cc); color: white; border: none; padding: 18px; width: 100%; border-radius: 40px; font-size: 22px; font-weight: 800; }
        .btn-dep { background: #1db954; border: none; color: white; padding: 15px; width: 100%; border-radius: 20px; margin-top: 15px; font-weight: bold; }
        .hidden { display: none; }
        .item { background: rgba(255,255,255,0.05); padding: 15px; border-radius: 20px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
        
        /* Modal Style */
        .modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); display: flex; align-items: center; justify-content: center; z-index: 100; }
        .m-card { background: #0a1125; width: 85%; padding: 20px; border-radius: 25px; border: 1px solid #00d4ff; }
        .copy-box { background: #000; padding: 10px; border-radius: 10px; font-size: 11px; margin: 10px 0; word-break: break-all; color: #00d4ff; }
    </style>
</head>
<body>
    <audio id="bg" loop src="https://files.catbox.moe/78surr.mp3"></audio>
    
    <div class="nav">
        <span id="t1" class="active" onclick="tab(1)">🎰 ИГРА</span>
        <span id="t2" onclick="tab(2)">👤 ПРОФИЛЬ</span>
        <span id="t3" onclick="tab(3)">⚙️ ОПЦИИ</span>
    </div>

    <div id="p1" class="card">
        <div style="font-size: 10px; opacity: 0.5;">TON BALANCE</div>
        <div class="bal" id="bDisp">...</div>
        <div class="slots"><div id="r1" class="reel">💎</div><div id="r2" class="reel">💎</div><div id="r3" class="reel">💎</div></div>
        <button class="btn-spin" onclick="spin()">SPIN (0.05)</button>
        <button class="btn-dep" onclick="showDep()">+ ПОПОЛНИТЬ</button>
    </div>

    <div id="p2" class="card hidden">
        <h2>ПРОФИЛЬ</h2>
        <div class="item"><span>Спинов:</span><b id="uS">0</b></div>
        <div class="item"><span>Побед:</span><b id="uW">0</b></div>
    </div>

    <div id="p3" class="card hidden">
        <h2>ОПЦИИ</h2>
        <div class="item"><span>Музыка</span><button onclick="toggleM()" id="mBtn" style="background:#00d4ff; border:none; border-radius:10px; padding:5px 10px;">ВКЛ</button></div>
        <div class="item"><span>Поддержка</span><a href="https://t.me/${SUPPORT_USER}" style="color:#00d4ff; text-decoration:none;">@${SUPPORT_USER}</a></div>
    </div>

    <div id="depModal" class="modal hidden">
        <div class="m-card">
            <h3>ПОПОЛНЕНИЕ</h3>
            <p style="font-size:12px; opacity:0.7;">Отправьте любую сумму TON на адрес ниже.</p>
            <div class="copy-box" onclick="copy('${MY_WALLET}')">${MY_WALLET.slice(0,20)}... (TAP)</div>
            <p style="font-size:12px; color:#ff4d4d;">ВАЖНО: Комментарий к платежу!</p>
            <div class="copy-box" id="copyId" onclick="copy(this.innerText)" style="font-size:18px; color:white; font-weight:bold;">ID_</div>
            <button onclick="showDep()" style="background:#555; color:white; border:none; padding:10px; width:100%; border-radius:15px; margin-top:10px;">ЗАКРЫТЬ</button>
        </div>
    </div>

    <script>
        const tg = window.Telegram.WebApp; tg.expand();
        const uid = tg.initDataUnsafe?.user?.id || "USER";
        const bg = document.getElementById('bg'); let mOn = false;

        async function load() {
            const r = await fetch('/api/init', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({uid}) });
            const d = await r.json();
            document.getElementById('bDisp').innerText = d.b.toFixed(2);
            document.getElementById('uS').innerText = d.s;
            document.getElementById('uW').innerText = d.w;
            document.getElementById('copyId').innerText = "ID_" + uid;
        }

        async function spin() {
            const r = await fetch('/api/spin', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({uid}) });
            const d = await r.json();
            if(d.err) return tg.showAlert(d.err);
            document.getElementById('r1').innerText = d.reels[0];
            document.getElementById('r2').innerText = d.reels[1];
            document.getElementById('r3').innerText = d.reels[2];
            load(); if(d.win > 0) { tg.HapticFeedback.notificationOccurred('success'); tg.showAlert("WIN! +0.50 TON"); }
        }

        function showDep() { document.getElementById('depModal').classList.toggle('hidden'); }
        
        function copy(text) {
            navigator.clipboard.writeText(text);
            tg.showAlert("Скопировано!");
        }

        function toggleM() { 
            if(mOn) { bg.pause(); document.getElementById('mBtn').innerText="ВКЛ"; } 
            else { bg.play(); document.getElementById('mBtn').innerText="ВЫКЛ"; }
            mOn = !mOn; 
        }

        function tab(n) {
            document.getElementById('p1').classList.toggle('hidden', n!==1);
            document.getElementById('p2').classList.toggle('hidden', n!==2);
            document.getElementById('p3').classList.toggle('hidden', n!==3);
            document.getElementById('t1').classList.toggle('active', n===1);
            document.getElementById('t2').classList.toggle('active', n===2);
            document.getElementById('t3').classList.toggle('active', n===3);
        }
        load();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log("READY"));
