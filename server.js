const express = require('express');
const axios = require('axios');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// ⚙️ НАСТРОЙКИ (VERSION 1.1 - NO XP)
// ==========================================
const MY_WALLET = "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn";
const TON_API_KEY = "fe9429836fd2dfdb009421c6dc389840c9cdadca238477b4e2910250e11fa6d3";
const DB_FILE = './database.json';

if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: {}, txs: [] }));
}

function getDB() { return JSON.parse(fs.readFileSync(DB_FILE)); }
function setDB(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }

app.use(express.json());

// СКАНЕР ПЛАТЕЖЕЙ
async function scan() {
    try {
        const res = await axios.get("https://toncenter.com/api/v2/getTransactions", {
            params: { address: MY_WALLET, limit: 10 },
            headers: { 'X-API-Key': TON_API_KEY }
        });
        let db = getDB();
        res.data.result.forEach(tx => {
            const h = tx.transaction_id.hash;
            const m = tx.in_msg.message;
            if (m && m.startsWith("ID_") && !db.txs.includes(h)) {
                const uid = m.split("_")[1];
                const val = parseInt(tx.in_msg.value) / 1e9;
                if(!db.users[uid]) db.users[uid] = { b: 0.1, spins: 0, wins: 0 };
                db.users[uid].b += val;
                db.txs.push(h);
            }
        });
        setDB(db);
    } catch (e) {}
}
setInterval(scan, 15000);

// API
app.post('/api/get-user', (req, res) => {
    const { uid } = req.body;
    let db = getDB();
    if (!db.users[uid]) {
        db.users[uid] = { b: 0.1, spins: 0, wins: 0 }; 
        setDB(db);
    }
    res.json(db.users[uid]);
});

app.post('/api/play', (req, res) => {
    const { uid } = req.body;
    let db = getDB();
    let u = db.users[uid];
    if (!u || u.b < 0.01) return res.json({ err: "Недостаточно баланса" });

    u.b -= 0.01; 
    u.spins++;
    const s = ['💎','💰','7️⃣','🍒','⭐'];
    const r = [s[Math.floor(Math.random()*5)], s[Math.floor(Math.random()*5)], s[Math.floor(Math.random()*5)]];
    let win = 0;
    if (r[0] === r[1] && r[1] === r[2]) { win = 0.5; u.b += win; u.wins++; }
    
    setDB(db);
    res.json({ reels: r, win, newBal: u.b });
});

// ИНТЕРФЕЙС
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <title>VIP TON XOT V1.1</title>
    <style>
        body { background: #050a14; color: white; font-family: sans-serif; text-align: center; margin: 0; padding: 10px; overflow: hidden; }
        .card { background: rgba(10, 17, 37, 0.9); padding: 25px; border-radius: 30px; border: 1px solid #00d4ff; box-shadow: 0 0 20px #00d4ff33; }
        .bal { font-size: 45px; color: #00d4ff; font-weight: bold; text-shadow: 0 0 10px #00d4ffaa; }
        .slots { display: flex; justify-content: center; gap: 10px; margin: 25px 0; }
        .reel { width: 85px; height: 110px; background: #000; border-radius: 20px; font-size: 55px; display: flex; align-items: center; justify-content: center; border: 2px solid #1a2c4d; }
        .btn-spin { background: linear-gradient(135deg, #0088cc, #00d4ff); border: none; color: white; padding: 22px; width: 100%; border-radius: 40px; font-size: 26px; font-weight: bold; cursor: pointer; transition: 0.1s; }
        .btn-spin:active { transform: scale(0.95); }
        .btn-dep { background: #28a745; border: none; color: white; padding: 15px; width: 100%; border-radius: 20px; margin-top: 20px; font-weight: bold; opacity: 0.9; }
        .blur { animation: b 0.1s infinite; }
        @keyframes b { 0% { filter: blur(0px); transform: translateY(-2px); } 50% { filter: blur(6px); } 100% { filter: blur(0px); transform: translateY(2px); } }
        .hidden { display: none; }
        .nav { display: flex; justify-content: space-around; margin-bottom: 20px; font-weight: bold; font-size: 14px; color: #00d4ff; }
    </style>
</head>
<body>
    <audio id="bgMusic" loop>
        <source src="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3" type="audio/mpeg">
    </audio>
    <audio id="winSound" src="https://actions.google.com/sounds/v1/alarms/beep_short.ogg"></audio>

    <div class="nav">
        <span onclick="tab(1)" style="border-bottom: 2px solid">ИГРА</span>
        <span onclick="tab(2)">ПРОФИЛЬ</span>
    </div>

    <div id="p1" class="card">
        <div style="font-size: 11px; opacity: 0.6; letter-spacing: 1px;">ВАШ БАЛАНС TON</div>
        <div class="bal" id="balDisplay">0.10</div>
        <div class="slots"><div id="r1" class="reel">💎</div><div id="r2" class="reel">💎</div><div id="r3" class="reel">💎</div></div>
        <button id="sBtn" class="btn-spin" onclick="play()">SPIN</button>
        <button class="btn-dep" onclick="dep()">+ ПОПОЛНИТЬ</button>
    </div>

    <div id="p2" class="card hidden">
        <h3 style="color: #00d4ff">ЛИЧНЫЙ КАБИНЕТ</h3>
        <div style="text-align: left; padding: 10px; line-height: 2;">
            <div>🆔 ID: <span id="myId">---</span></div>
            <div>🎰 ВСЕГО ИГР: <span id="mySpins">0</span></div>
            <div>🏆 ПОБЕД: <span id="myWins">0</span></div>
        </div>
        <button class="btn-dep" style="background: #444" onclick="tab(1)">НАЗАД</button>
    </div>

    <script>
        const tg = window.Telegram.WebApp;
        tg.expand();
        const uid = tg.initDataUnsafe?.user?.id || "USER";
        const bg = document.getElementById('bgMusic');

        // Включение музыки после первого касания экрана
        window.addEventListener('touchstart', () => { if(bg.paused) bg.play(); }, {once: true});
        window.addEventListener('click', () => { if(bg.paused) bg.play(); }, {once: true});

        async function load() {
            const r = await fetch('/api/get-user', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({uid}) });
            const d = await r.json();
            document.getElementById('balDisplay').innerText = d.b.toFixed(2);
            document.getElementById('myId').innerText = uid;
            document.getElementById('mySpins').innerText = d.spins;
            document.getElementById('myWins').innerText = d.wins;
        }

        async function play() {
            const btn = document.getElementById('sBtn');
            btn.disabled = true;
            const reels = [document.getElementById('r1'), document.getElementById('r2'), document.getElementById('r3')];
            reels.forEach(r => r.classList.add('blur'));
            
            tg.HapticFeedback.impactOccurred('medium');

            const r = await fetch('/api/play', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({uid}) });
            const d = await r.json();

            if(d.err) {
                reels.forEach(r => r.classList.remove('blur'));
                btn.disabled = false;
                return tg.showAlert(d.err);
            }

            setTimeout(() => {
                reels.forEach((r, i) => {
                    r.classList.remove('blur');
                    r.innerText = d.reels[i];
                });
                document.getElementById('balDisplay').innerText = d.newBal.toFixed(2);
                if(d.win > 0) {
                    document.getElementById('winSound').play();
                    tg.HapticFeedback.notificationOccurred('success');
                    tg.showAlert("ВЫИГРЫШ +0.50 TON!");
                }
                btn.disabled = false;
            }, 1200);
        }

        function dep() {
            const comment = "ID_" + uid;
            const url = "ton://transfer/${MY_WALLET}?amount=1000000000&text=" + comment;
            tg.openLink(url);
        }

        function tab(n) {
            document.getElementById('p1').classList.toggle('hidden', n === 2);
            document.getElementById('p2').classList.toggle('hidden', n === 1);
            if(n === 2) load();
        }

        load();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log("VIP TON XOT V1.1 LIVE"));
