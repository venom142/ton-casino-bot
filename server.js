const express = require('express');
const axios = require('axios');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// ⚙️ НАСТРОЙКИ (VERSION 1.2 - FINAL FIX)
// ==========================================
const MY_WALLET = "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn";
const TON_API_KEY = "fe9429836fd2dfdb009421c6dc389840c9cdadca238477b4e2910250e11fa6d3";
const DB_FILE = './database.json';

// Создаем базу данных если её нет
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: {}, txs: [] }));
}

function getDB() { return JSON.parse(fs.readFileSync(DB_FILE)); }
function setDB(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }

app.use(express.json());

// [ЛОГИКА] Сканнер платежей в TON (работает раз в 20 сек)
async function scanTON() {
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
                console.log(`+${val} TON юзеру ${uid}`);
            }
        });
        setDB(db);
    } catch (e) {}
}
setInterval(scanTON, 20000);

// [API] Данные игрока
app.post('/api/load', (req, res) => {
    const { uid } = req.body;
    let db = getDB();
    if (!db.users[uid]) {
        db.users[uid] = { b: 0.1, spins: 0, wins: 0 }; // ТВОЙ ЗАПРОС: СТАРТ 0.1
        setDB(db);
    }
    res.json(db.users[uid]);
});

// [API] Спин рулетки
app.post('/api/spin', (req, res) => {
    const { uid } = req.body;
    let db = getDB();
    let u = db.users[uid];
    if (!u || u.b < 0.01) return res.json({ err: "Недостаточно TON" });

    u.b -= 0.01; // Снятие 0.01 TON за игру
    u.spins++;
    
    // Эмодзи для рулетки
    const sym = ['💎','💰','7️⃣','🍒','⭐'];
    const r = [
        sym[Math.floor(Math.random()*5)],
        sym[Math.floor(Math.random()*5)],
        sym[Math.floor(Math.random()*5)]
    ];
    
    // Логика победы (три в ряд)
    let win = 0;
    if (r[0] === r[1] && r[1] === r[2]) {
        win = 0.5; // Выигрыш +0.5 TON
        u.b += win;
        u.wins++;
    }
    
    setDB(db);
    res.json({ reels: r, win, newBal: u.b });
});

// ==========================================
// 📱 ИНТЕРФЕЙС (HTML/CSS/JS)
// ==========================================
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <title>VIP TON XOT V1.2</title>
    <style>
        body { background: #050a14; color: white; font-family: sans-serif; text-align: center; margin: 0; padding: 10px; overflow: hidden; }
        .header { display: flex; justify-content: space-around; background: #0a1125; padding: 15px; border-radius: 15px; margin-bottom: 20px; font-weight: bold; color: #00d4ff; }
        .card { background: #0a1125; padding: 25px; border-radius: 30px; border: 1px solid #00d4ff; box-shadow: 0 0 15px #00d4ff33; }
        .bal { font-size: 45px; color: #00d4ff; font-weight: bold; text-shadow: 0 0 10px #00d4ff; }
        
        /* КРАСИВАЯ АНИМАЦИЯ СЛОТОВ */
        .slots { display: flex; justify-content: center; gap: 10px; margin: 25px 0; }
        .reel { width: 80px; height: 100px; background: #000; border-radius: 20px; font-size: 55px; display: flex; align-items: center; justify-content: center; border: 2px solid #1a2c4d; position: relative; overflow: hidden; }
        .spin-anim::before {
            content: "🍒\\n💎\\n💰\\n7️⃣\\n🍒"; 
            position: absolute; left: 0;
            animation: roll 0.1s infinite linear;
            display: block; width: 100%; white-space: pre-wrap;
        }
        @keyframes roll {
            0% { top: 0px; filter: blur(0px); }
            50% { filter: blur(8px); }
            100% { top: -200px; filter: blur(0px); }
        }
        
        .btn-spin { background: linear-gradient(135deg, #0088cc, #00d4ff); border: none; color: white; padding: 20px; width: 100%; border-radius: 40px; font-size: 26px; font-weight: bold; cursor: pointer; }
        .btn-spin:active { transform: scale(0.96); }
        .btn-dep { background: #28a745; border: none; color: white; padding: 15px; width: 100%; border-radius: 20px; margin-top: 20px; font-weight: bold; }
        .hidden { display: none; }
    </style>
</head>
<body>
    <audio id="bg" loop src="https://files.catbox.moe/78surr.mp3"></audio>
    <audio id="win" src="https://actions.google.com/sounds/v1/alarms/beep_short.ogg"></audio>

    <div class="header">
        <span onclick="tab(1)">🎰 ИГРА</span>
        <span onclick="tab(2)">👤 ПРОФИЛЬ</span>
    </div>

    <div id="p1" class="card">
        <div style="font-size: 11px; opacity: 0.6; letter-spacing: 1px;">ВАШ БАЛАНС TON</div>
        <div class="bal" id="balDisplay">0.10</div>
        
        <div class="slots">
            <div id="r1" class="reel">🎰</div>
            <div id="r2" class="reel">🎰</div>
            <div id="r3" class="reel">🎰</div>
        </div>
        
        <button id="sBtn" class="btn-spin" onclick="play()">SPIN</button>
        <button id="dBtn" class="btn-dep">+ ПОПОЛНИТЬ</button>
    </div>

    <div id="p2" class="card hidden">
        <h3 style="color: #00d4ff">МОЙ ПРОФИЛЬ</h3>
        <p>🆔 Ваш ID: <span id="myId">---</span></p>
        <p>🎰 Игр: <span id="mySpins">0</span></p>
        <p>🏆 Побед: <span id="myWins">0</span></p>
        <button class="btn-dep" style="background: #444" onclick="tab(1)">НАЗАД</button>
    </div>

    <script>
        const tg = window.Telegram.WebApp;
        tg.expand();
        const uid = tg.initDataUnsafe?.user?.id || "dev_" + Math.floor(Math.random()*1000);
        const aBg = document.getElementById('bg');

        // Включение музыки при первом клике (политика Google)
        document.body.addEventListener('touchstart', () => { if(aBg.paused) aBg.play(); });

        async function loadUser() {
            const r = await fetch('/api/load', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({uid}) });
            const d = await r.json();
            document.getElementById('balDisplay').innerText = d.b.toFixed(2);
            document.getElementById('myId').innerText = uid;
            document.getElementById('mySpins').innerText = d.spins;
            document.getElementById('myWins').innerText = d.wins;
        }

        async function play() {
            const btn = document.getElementById('sBtn');
            btn.disabled = true;
            tg.HapticFeedback.impactOccurred('medium');

            const reels = [document.getElementById('r1'), document.getElementById('r2'), document.getElementById('r3')];
            reels.forEach(r => {
                r.innerHTML = ''; // Убираем эмодзи
                r.classList.add('spin-anim'); // Запускаем анимацию
            });
            
            // Отправляем запрос на сервер
            const r = await fetch('/api/spin', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({uid}) });
            const d = await r.json();

            // Если баланс меньше 0.01 TON
            if(d.err) {
                reels.forEach(r => r.classList.remove('spin-anim'));
                reels[0].innerText = '🎰'; reels[1].innerText = '🎰'; reels[2].innerText = '🎰';
                tg.showAlert(d.err);
                btn.disabled = false;
                return;
            }

            // Ждем 1.5 секунды анимации и останавливаем
            setTimeout(() => {
                reels.forEach((r, i) => {
                    r.classList.remove('spin-anim');
                    r.innerText = d.reels[i];
                });
                document.getElementById('balDisplay').innerText = d.newBal.toFixed(2);
                if(d.win > 0) {
                    document.getElementById('win').play();
                    tg.showAlert("ВЫИГРЫШ +0.5 TON! 🎉");
                    tg.HapticFeedback.notificationOccurred('success');
                }
                btn.disabled = false;
            }, 1500);
        }

        // КНОПКА ПОПОЛНЕНИЯ (ТВОЙ ЗАПРОС)
        document.getElementById('dBtn').onclick = function() {
            const c = "ID_" + uid; // Комментарий для тебя
            const url = "ton://transfer/${MY_WALLET}?amount=1000000000&text=" + c;
            
            tg.showPopup({
                title: 'Пополнение 1 TON',
                message: 'Отправьте TON на: ${MY_WALLET}\\n\\nКомментарий: ' + c,
                buttons: [{id: 'ok', type: 'default', text: 'Оплатить 💳'}]
            }, (id) => {
                if (id === 'ok') tg.openLink(url);
            });
        };

        function tab(n) {
            document.getElementById('p1').classList.toggle('hidden', n === 2);
            document.getElementById('p2').classList.toggle('hidden', n === 1);
            if(n === 2) loadUser();
        }

        loadUser();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log("VIP TON XOT V1.2 FINAL STARTED"));
