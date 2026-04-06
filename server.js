const express = require('express');
const axios = require('axios');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

const MY_WALLET = "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn";
const TON_API_KEY = "fe9429836fd2dfdb009421c6dc389840c9cdadca238477b4e2910250e11fa6d3";
const DB_FILE = './database.json';

if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ users: {}, txs: [] }));
function getDB() { return JSON.parse(fs.readFileSync(DB_FILE)); }
function setDB(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }

app.use(express.json());

// СКАНЕР ПЛАТЕЖЕЙ
async function scan() {
    try {
        const res = await axios.get("https://toncenter.com/api/v2/getTransactions", {
            params: { address: MY_WALLET, limit: 15 },
            headers: { 'X-API-Key': TON_API_KEY }
        });
        let db = getDB();
        res.data.result.forEach(tx => {
            const h = tx.transaction_id.hash;
            const m = tx.in_msg.message;
            if (m && m.startsWith("ID_") && !db.txs.includes(h)) {
                const uid = m.split("_")[1];
                const val = parseInt(tx.in_msg.value) / 1e9;
                if(!db.users[uid]) db.users[uid] = { b: 0.1, s: 0, w: 0 };
                db.users[uid].b += val;
                db.txs.push(h);
            }
        });
        setDB(db);
    } catch (e) {}
}
setInterval(scan, 20000);

app.post('/api/init', (req, res) => {
    const { uid } = req.body;
    let db = getDB();
    if (!db.users[uid]) db.users[uid] = { b: 0.1, s: 0, w: 0 };
    setDB(db);
    res.json(db.users[uid]);
});

app.post('/api/spin', (req, res) => {
    const { uid } = req.body;
    let db = getDB();
    let u = db.users[uid];
    if (!u || u.b < 0.05) return res.json({ err: "Минимум 0.05 TON" });
    u.b -= 0.05; u.s++;
    const syms = ['💎','💰','7️⃣','🍒','⭐'];
    const r = [syms[Math.floor(Math.random()*5)], syms[Math.floor(Math.random()*5)], syms[Math.floor(Math.random()*5)]];
    let win = (r[0] === r[1] && r[1] === r[2]) ? 0.5 : 0;
    if(win > 0) { u.b += win; u.w++; }
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
        body { background: #050a14; color: white; font-family: sans-serif; text-align: center; margin: 0; padding: 10px; }
        .nav { display: flex; justify-content: space-around; background: #0a1125; padding: 15px; border-radius: 15px; margin-bottom: 15px; font-size: 12px; }
        .card { background: #0a1125; padding: 20px; border-radius: 25px; border: 1px solid #00d4ff; min-height: 300px; }
        .bal { font-size: 40px; color: #00d4ff; font-weight: bold; }
        .slots { display: flex; justify-content: center; gap: 8px; margin: 20px 0; }
        .reel { width: 75px; height: 90px; background: #000; border-radius: 15px; font-size: 45px; display: flex; align-items: center; justify-content: center; border: 2px solid #1a2c4d; }
        .btn-spin { background: #00d4ff; color: #000; border: none; padding: 18px; width: 100%; border-radius: 30px; font-size: 20px; font-weight: bold; }
        .btn-dep { background: #28a745; border: none; color: white; padding: 12px; width: 100%; border-radius: 15px; margin-top: 10px; }
        .hidden { display: none; }
        .spin-anim { animation: roll 0.1s infinite linear; }
        @keyframes roll { 0% { transform: translateY(-5px); filter: blur(5px); } 100% { transform: translateY(5px); } }
    </style>
</head>
<body>
    <audio id="bg" loop src="https://files.catbox.moe/78surr.mp3"></audio>
    <div class="nav">
        <span onclick="tab(1)">🎰 ИГРА</span>
        <span onclick="tab(2)">👤 ПРОФИЛЬ</span>
        <span onclick="tab(3)">⚙️ НАСТРОЙКИ</span>
    </div>
    <div id="p1" class="card">
        <div style="font-size: 10px; opacity: 0.5;">БАНК TON</div>
        <div class="bal" id="bDisp">0.10</div>
        <div class="slots"><div id="r1" class="reel">💎</div><div id="r2" class="reel">💎</div><div id="r3" class="reel">💎</div></div>
        <button id="sBtn" class="btn-spin" onclick="spin()">КРУТИТЬ</button>
        <button class="btn-dep" onclick="dep()">ПОПОЛНИТЬ</button>
    </div>
    <div id="p2" class="card hidden">
        <h3>СТАТИСТИКА</h3>
        <p>ID: <span id="uId"></span></p>
        <p>Всего игр: <b id="uS">0</b></p>
        <p>Побед: <b id="uW">0</b></p>
    </div>
    <div id="p3" class="card hidden">
        <h3>НАСТРОЙКИ</h3>
        <button class="btn-dep" style="background:#555" onclick="toggleM()">ВКЛ/ВЫКЛ МУЗЫКУ</button>
        <p style="font-size:10px; margin-top:20px;">Версия: 1.3 VIP XOT</p>
    </div>
    <script>
        const tg = window.Telegram.WebApp;
        const uid = tg.initDataUnsafe?.user?.id || "666";
        const bg = document.getElementById('bg');
        let mOn = false;

        async function load() {
            const r = await fetch('/api/init', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({uid}) });
            const d = await r.json();
            document.getElementById('bDisp').innerText = d.b.toFixed(2);
            document.getElementById('uId').innerText = uid;
            document.getElementById('uS').innerText = d.s;
            document.getElementById('uW').innerText = d.w;
        }
        async function spin() {
            const reels = [document.getElementById('r1'), document.getElementById('r2'), document.getElementById('r3')];
            reels.forEach(r => r.classList.add('spin-anim'));
            const r = await fetch('/api/spin', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({uid}) });
            const d = await r.json();
            if(d.err) { reels.forEach(r => r.classList.remove('spin-anim')); return tg.showAlert(d.err); }
            setTimeout(() => {
                reels.forEach((r, i) => { r.classList.remove('spin-anim'); r.innerText = d.reels[i]; });
                document.getElementById('bDisp').innerText = d.b.toFixed(2);
                document.getElementById('uS').innerText = d.s;
                document.getElementById('uW').innerText = d.w;
                if(d.win > 0) tg.showAlert("WIN! +0.5 TON");
            }, 1000);
        }
        function dep() {
            tg.showScanQrPopup({ text: "Сумма от 0.1 до 100 TON" });
            setTimeout(() => {
                const amt = prompt("Введите сумму TON (0.1 - 100):", "1.0");
                if(amt >= 0.1) {
                    const url = "ton://transfer/${MY_WALLET}?amount=" + (amt*1e9) + "&text=ID_" + uid;
                    tg.openLink(url);
                }
            }, 500);
        }
        function toggleM() { if(mOn) bg.pause(); else bg.play(); mOn = !mOn; }
        function tab(n) {
            document.getElementById('p1').classList.toggle('hidden', n!==1);
            document.getElementById('p2').classList.toggle('hidden', n!==2);
            document.getElementById('p3').classList.toggle('hidden', n!==3);
        }
        load();
    </script>
</body>
</html>
    `);
});
app.listen(PORT, () => console.log("V1.3 READY"));
