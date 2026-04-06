const express = require('express');
const axios = require('axios');
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000;

const MY_WALLET = "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn";
const TON_API_KEY = "fe9429836fd2dfdb009421c6dc389840c9cdadca238477b4e2910250e11fa6d3";
const BOT_TOKEN = process.env.BOT_TOKEN; 
const URL_APP = "https://ton-casino-bot.onrender.com"; 

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const DB_FILE = './database.json';

if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ users: {}, txs: [] }));
function getDB() { return JSON.parse(fs.readFileSync(DB_FILE)); }
function setDB(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }

app.use(express.json());

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "💎 **VIP TON ХОТ ТАП 1.0**\n\nЖми играть!", {
        reply_markup: { inline_keyboard: [[{ text: "🎰 ИГРАТЬ", web_app: { url: URL_APP } }]] },
        parse_mode: 'Markdown'
    }).catch(e => console.log("Ошибка бота:", e.message));
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
    let r = [];
    let win = 0;
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
        .nav { display: flex; justify-content: space-around; background: rgba(10, 17, 37, 0.9); padding: 12px; border-radius: 20px; margin-bottom: 20px; border: 1px solid #00d4ff33; }
        .nav span { font-size: 11px; font-weight: bold; color: #00d4ff; opacity: 0.5; cursor: pointer; }
        .nav .active { opacity: 1; text-shadow: 0 0 10px #00d4ff; }
        .card { background: #0a1125; padding: 25px; border-radius: 30px; border: 1px solid #00d4ff4d; }
        .bal { font-size: 50px; color: #00d4ff; font-weight: bold; margin: 10px 0; }
        .slots { display: flex; justify-content: center; gap: 8px; margin: 20px 0; }
        .reel { width: 80px; height: 100px; background: #000; border-radius: 20px; font-size: 40px; display: flex; align-items: center; justify-content: center; border: 1px solid #1a2c4d; }
        .btn-spin { background: linear-gradient(135deg, #00d4ff, #0088cc); color: white; border: none; padding: 20px; width: 100%; border-radius: 40px; font-size: 22px; font-weight: 800; }
        .btn-dep { background: #1db954; border: none; color: white; padding: 15px; width: 100%; border-radius: 20px; margin-top: 15px; font-weight: bold; }
        .hidden { display: none; }
        .stat { background: rgba(255,255,255,0.05); padding: 15px; border-radius: 20px; margin-bottom: 10px; display: flex; justify-content: space-between; }
    </style>
</head>
<body>
    <audio id="bg" loop src="https://files.catbox.moe/78surr.mp3"></audio>
    <div class="nav">
        <span id="t1" class="active" onclick="tab(1)">🎰 ИГРА</span>
        <span id="t2" onclick="tab(2)">👤 ПРОФИЛЬ</span>
    </div>
    <div id="p1" class="card">
        <div style="font-size: 10px; opacity: 0.5;">TON BALANCE</div>
        <div class="bal" id="bDisp">...</div>
        <div class="slots"><div id="r1" class="reel">💎</div><div id="r2" class="reel">💎</div><div id="r3" class="reel">💎</div></div>
        <button class="btn-spin" onclick="spin()">SPIN (0.05)</button>
        <button class="btn-dep" onclick="dep()">+ ПОПОЛНИТЬ</button>
        <button onclick="toggleM()" style="margin-top:15px; background:none; border:none; color:#00d4ff; font-size:11px;">🎵 МУЗЫКА</button>
    </div>
    <div id="p2" class="card hidden">
        <h2>СТАТИСТИКА</h2>
        <div class="stat"><span>Игр:</span><b id="uS">0</b></div>
        <div class="stat"><span>Побед:</span><b id="uW">0</b></div>
        <p style="opacity:0.3; font-size:10px;">ID: <span id="uId"></span></p>
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
            document.getElementById('uId').innerText = uid;
        }
        async function spin() {
            const r = await fetch('/api/spin', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({uid}) });
            const d = await r.json();
            if(d.err) return tg.showAlert(d.err);
            document.getElementById('r1').innerText = d.reels[0];
            document.getElementById('r2').innerText = d.reels[1];
            document.getElementById('r3').innerText = d.reels[2];
            load(); if(d.win > 0) tg.showAlert("WIN! +0.50 TON");
        }
        function dep() {
            const amt = prompt("Сумма TON:", "1.0");
            if(amt >= 0.1) tg.openLink("ton://transfer/${MY_WALLET}?amount=" + (amt*1e9) + "&text=ID_" + uid);
        }
        function toggleM() { if(mOn) bg.pause(); else bg.play(); mOn = !mOn; }
        function tab(n) {
            document.getElementById('p1').classList.toggle('hidden', n!==1);
            document.getElementById('p2').classList.toggle('hidden', n!==2);
            document.getElementById('t1').classList.toggle('active', n===1);
            document.getElementById('t2').classList.toggle('active', n===2);
        }
        load();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log("OK"));
