const express = require('express');
const axios = require('axios');
const fs = require('fs'); // Модуль для работы с файлами (наша база данных)
const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// ⚙️ НАСТРОЙКИ (ТВОИ ДАННЫЕ)
// ==========================================
const MY_WALLET = "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn";
const TON_API_KEY = "fe9429836fd2dfdb009421c6dc389840c9cdadca238477b4e2910250e11fa6d3";
const DB_FILE = './database.json';

// ==========================================
// 🗄️ СИСТЕМА БАЗЫ ДАННЫХ (LOCAL DB)
// ==========================================
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: {}, txs: [] }, null, 2));
}

function loadDB() { return JSON.parse(fs.readFileSync(DB_FILE)); }
function saveDB(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }

// ==========================================
// 📡 СКАНЕР ТРАНЗАКЦИЙ
// ==========================================
async function scanBlockchain() {
    try {
        const res = await axios.get("https://toncenter.com/api/v2/getTransactions", {
            params: { address: MY_WALLET, limit: 20 },
            headers: { 'X-API-Key': TON_API_KEY }
        });
        
        let db = loadDB();
        const transactions = res.data.result;

        for (let tx of transactions) {
            const hash = tx.transaction_id.hash;
            if (db.txs.includes(hash)) continue; // Пропускаем, если уже обработали

            const msg = tx.in_msg.message;
            if (msg && msg.startsWith("ID_")) {
                const uid = msg.split("_")[1];
                const value = parseInt(tx.in_msg.value) / 1e9;

                if (!db.users[uid]) db.users[uid] = { b: 0, spins: 0, wins: 0, joined: new Date() };
                db.users[uid].b += value;
                db.txs.push(hash);
                
                console.log(`💰 Депозит: +${value} TON для ${uid}`);
            }
        }
        saveDB(db);
    } catch (e) { console.log("Ошибка сканера платежей"); }
}
setInterval(scanBlockchain, 20000);

// ==========================================
// 🎮 API ИГРЫ И ЛИЧНОГО КАБИНЕТА
// ==========================================
app.use(express.json());

app.post('/api/user-data', (req, res) => {
    const { uid } = req.body;
    let db = loadDB();
    if (!db.users[uid]) db.users[uid] = { b: 0.5, spins: 0, wins: 0, joined: new Date() };
    res.json(db.users[uid]);
});

app.post('/api/spin', (req, res) => {
    const { uid, bet } = req.body;
    let db = loadDB();
    let user = db.users[uid];

    if (!user || user.b < bet) return res.json({ error: "Недостаточно баланса" });

    user.b -= bet;
    user.spins += 1;

    const symbols = ['💎', '💰', '7️⃣', '🍒', '⭐'];
    const r = [
        symbols[Math.floor(Math.random() * 5)],
        symbols[Math.floor(Math.random() * 5)],
        symbols[Math.floor(Math.random() * 5)]
    ];

    let win = 0;
    if (r[0] === r[1] && r[1] === r[2]) {
        win = bet * 10;
        user.b += win;
        user.wins += 1;
    }

    saveDB(db);
    res.json({ reels: r, win: win, newBal: user.b });
});

// ==========================================
// 📱 ИНТЕРФЕЙС (HTML)
// ==========================================
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        body { background: #040712; color: white; font-family: sans-serif; margin: 0; padding: 20px; text-align: center; }
        .nav { display: flex; justify-content: space-around; margin-bottom: 20px; background: #0a1125; padding: 10px; border-radius: 15px; }
        .nav-item { cursor: pointer; opacity: 0.7; font-size: 14px; }
        .active { opacity: 1; border-bottom: 2px solid #00d4ff; }
        
        .card { background: linear-gradient(145deg, #0a1125, #060d1f); border-radius: 25px; padding: 25px; border: 1px solid #1a2c4d; }
        .bal { font-size: 32px; color: #00d4ff; font-weight: 900; margin: 10px 0; }
        
        .slots { display: flex; gap: 10px; justify-content: center; margin: 30px 0; }
        .reel { width: 70px; height: 90px; background: #000; border-radius: 15px; font-size: 40px; display: flex; align-items: center; justify-content: center; border: 2px solid #1a2c4d; }
        
        button { background: #00d4ff; color: #000; border: none; padding: 15px 40px; border-radius: 50px; font-size: 20px; font-weight: bold; width: 100%; cursor: pointer; }
        .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 20px; text-align: left; }
        .stat-box { background: #0f1a36; padding: 15px; border-radius: 15px; }
        .hidden { display: none; }
    </style>
</head>
<body>
    <div class="nav">
        <div id="tab1" class="nav-item active" onclick="showTab(1)">🎰 ИГРА</div>
        <div id="tab2" class="nav-item" onclick="showTab(2)">👤 ПРОФИЛЬ</div>
    </div>

    <div id="page1">
        <div class="card">
            <div style="font-size: 12px; opacity: 0.5;">ВАШ БАЛАНС</div>
            <div id="bal" class="bal">0.00</div>
            <div class="slots"><div id="r1" class="reel">💎</div><div id="r2" class="reel">💎</div><div id="r3" class="reel">💎</div></div>
            <button onclick="spin()">SPIN (0.1 TON)</button>
            <button style="background:#28a745; color:white; margin-top:15px; font-size:14px;" onclick="deposit()">+ ПОПОЛНИТЬ</button>
        </div>
    </div>

    <div id="page2" class="hidden">
        <div class="card">
            <h2>ЛИЧНЫЙ КАБИНЕТ</h2>
            <div class="stats-grid">
                <div class="stat-box">💰 Баланс:<br><b id="p-bal">0</b></div>
                <div class="stat-box">🎰 Игр:<br><b id="p-spins">0</b></div>
                <div class="stat-box">🏆 Побед:<br><b id="p-wins">0</b></div>
                <div class="stat-box">🆔 Ваш ID:<br><b id="p-id">0</b></div>
            </div>
            <p style="font-size:10px; opacity:0.4; margin-top:20px;">Дата регистрации: <span id="p-date">-</span></p>
        </div>
    </div>

    <script>
        const tg = window.Telegram.WebApp;
        const uid = tg.initDataUnsafe.user?.id || "local_dev";
        
        async function loadUser() {
            const r = await fetch('/api/user-data', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({uid}) });
            const d = await r.json();
            document.getElementById('bal').innerText = d.b.toFixed(2);
            document.getElementById('p-bal').innerText = d.b.toFixed(2) + " TON";
            document.getElementById('p-spins').innerText = d.spins;
            document.getElementById('p-wins').innerText = d.wins;
            document.getElementById('p-id').innerText = uid;
            document.getElementById('p-date').innerText = d.joined;
        }

        function showTab(n) {
            document.getElementById('page1').classList.toggle('hidden', n !== 1);
            document.getElementById('page2').classList.toggle('hidden', n !== 2);
            document.getElementById('tab1').classList.toggle('active', n === 1);
            document.getElementById('tab2').classList.toggle('active', n === 2);
            if(n === 2) loadUser();
        }

        async function spin() {
            tg.HapticFeedback.impactOccurred('medium');
            const r = await fetch('/api/spin', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({uid, bet: 0.1}) });
            const d = await r.json();
            if(d.error) return tg.showAlert(d.error);

            document.getElementById('r1').innerText = d.reels[0];
            document.getElementById('r2').innerText = d.reels[1];
            document.getElementById('r3').innerText = d.reels[2];
            document.getElementById('bal').innerText = d.newBal.toFixed(2);

            if(d.win > 0) {
                tg.showAlert("ВЫИГРЫШ: " + d.win + " TON!");
                tg.HapticFeedback.notificationOccurred('success');
            }
        }

        function deposit() {
            const comment = "ID_" + uid;
            tg.openLink("ton://transfer/${MY_WALLET}?amount=1000000000&text=" + comment);
        }

        loadUser();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));
