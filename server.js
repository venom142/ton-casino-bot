/**
 * 💎 VIP TON ХОТ ТАП — FINAL MONOLITH EDITION
 * --------------------------------------------------
 */

const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// [ НАСТРОЙКИ ]
const PORT = process.env.PORT || 10000; 
const DB_URI = "mongodb+srv://sv2951605_db_user:zetatop123@cluster0.k5dri5s.mongodb.net/?appName=Cluster0";

// [ МОДЕЛЬ БАЗЫ ]
const User = mongoose.model('User', {
    uid: { type: String, unique: true },
    username: String,
    balance: { type: Number, default: 106.00 },
    level: { type: Number, default: 1 },
    xp: { type: Number, default: 0 },
    stats: { totalSpins: { type: Number, default: 0 } }
});

// [ ПОДКЛЮЧЕНИЕ К БАЗЕ ]
mongoose.connect(DB_URI)
    .then(() => console.log("✅ БАЗА ПОДКЛЮЧЕНА"))
    .catch(err => console.log("❌ ОШИБКА БАЗЫ:", err));

// [ API РОУТЫ ]

// 1. Проверка жизни сервера (для Render)
app.get('/health', (req, res) => res.status(200).send('OK'));

// 2. Синхронизация игрока
app.post('/api/sync', async (req, res) => {
    try {
        const { uid, first_name } = req.body;
        let user = await User.findOne({ uid: String(uid) });
        if (!user) {
            user = new User({ uid: String(uid), username: first_name || "Игрок" });
            await user.save();
        }
        res.json(user);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 3. Логика крутки
app.post('/api/spin', async (req, res) => {
    try {
        const { uid } = req.body;
        const user = await User.findOne({ uid: String(uid) });
        if (!user || user.balance < 0.1) return res.status(400).json({ error: "Low balance" });

        const symbols = ['💎', '👑', '💰', '🔥', '⚡', '🍀', '🍒'];
        const result = [
            symbols[Math.floor(Math.random() * symbols.length)],
            symbols[Math.floor(Math.random() * symbols.length)],
            symbols[Math.floor(Math.random() * symbols.length)]
        ];

        let win = 0;
        if (result[0] === result[1] && result[1] === result[2]) {
            win = 5.0; // Джекпот
        } else if (result[0] === result[1] || result[1] === result[2] || result[0] === result[2]) {
            win = 0.2; // Малый выигрыш
        }

        user.balance = Number((user.balance - 0.1 + win).toFixed(2));
        user.stats.totalSpins += 1;
        await user.save();

        res.json({ icons: result, win, balance: user.balance });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// [ ФРОНТЕНД ЧАСТЬ ]
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>💎 VIP TON ХОТ ТАП</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        body { background: #050505; color: white; font-family: sans-serif; margin: 0; text-align: center; }
        .card { background: #111; margin: 20px; padding: 20px; border-radius: 20px; border: 1px solid #222; }
        .bal-val { font-size: 40px; color: #00ffff; font-weight: bold; }
        .reels { display: flex; justify-content: center; gap: 10px; margin: 40px 0; }
        .reel { width: 80px; height: 100px; background: #000; border: 2px solid #a200ff; border-radius: 15px; font-size: 50px; line-height: 100px; }
        .btn { background: linear-gradient(135deg, #a200ff, #7000ff); border: none; color: white; padding: 20px; width: 80%; border-radius: 20px; font-size: 20px; font-weight: bold; }
        .btn:disabled { opacity: 0.5; }
        .active { animation: spin 0.1s infinite; }
        @keyframes spin { 0% { transform: translateY(-5px); } 50% { transform: translateY(5px); } }
    </style>
</head>
<body>
    <div class="card">
        <div style="color: #666; font-size: 12px;">БАЛАНС TON</div>
        <div class="bal-val" id="bal">0.00</div>
    </div>
    <div class="reels">
        <div class="reel" id="r1">?</div>
        <div class="reel" id="r2">?</div>
        <div class="reel" id="r3">?</div>
    </div>
    <button class="btn" id="spinBtn" onclick="play()">КРУТИТЬ (0.1)</button>

    <script>
        const tg = window.Telegram.WebApp;
        tg.expand();
        const uid = tg.initDataUnsafe?.user?.id || "8475323865";

        async function sync() {
            const r = await fetch('/api/sync', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ uid, first_name: tg.initDataUnsafe?.user?.first_name || "Admin" })
            });
            const d = await r.json();
            document.getElementById('bal').innerText = d.balance.toFixed(2);
        }

        async function play() {
            const btn = document.getElementById('spinBtn');
            btn.disabled = true;
            tg.HapticFeedback.impactOccurred('medium');

            const rs = [document.getElementById('r1'), document.getElementById('r2'), document.getElementById('r3')];
            rs.forEach(r => r.classList.add('active'));

            try {
                const r = await fetch('/api/spin', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ uid })
                });
                const d = await r.json();

                setTimeout(() => {
                    rs.forEach((r, i) => {
                        r.classList.remove('active');
                        r.innerText = d.icons[i];
                    });
                    document.getElementById('bal').innerText = d.balance.toFixed(2);
                    btn.disabled = false;
                    if (d.win > 0) tg.showAlert("ВЫИГРЫШ: " + d.win + " TON!");
                }, 1000);
            } catch (e) {
                alert("Ошибка сервера");
                btn.disabled = false;
            }
        }
        sync();
    </script>
</body>
</html>
    `);
});

// [ ЗАПУСК ]
app.listen(PORT, '0.0.0.0', () => {
    console.log("🚀 SERVER READY ON PORT " + PORT);
});
