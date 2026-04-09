/**
 * 💎 PROJECT: VIP TON ХОТ ТАП
 * 🛠 VERSION: V0.1.0 BETA (EXTENDED SETTINGS)
 * 🏗 ARCHITECTURE: MONOLITHIC / MODULAR SETTINGS
 */

const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const crypto = require('crypto');

// ============================================================
// [1] ГЛОБАЛЬНЫЙ МОДУЛЬ НАСТРОЕК (ENGINE SETTINGS)
// ============================================================
const GAME_CORE_SETTINGS = {
    SYSTEM: {
        TITLE: "💎 VIP TON ХОТ ТАП 💎",
        VERSION: "0.1.0-BETA",
        WALLET: "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn",
        MONGO_URI: "mongodb+srv://sv2951605_db_user:zetatop123@cluster0.k5dri5s.mongodb.net/?appName=Cluster0"
    },
    // Настройки игровых механик
    MECHANICS: {
        MIN_BET: 0.1,
        MAX_BET: 10.0,
        STEP_BET: 0.1,
        RTP: 0.95, // 95% возврат игроку
        JACKPOT_ENABLED: true,
        JACKPOT_MULTIPLIER: 100,
        REEL_SPEED: 2000 // мс
    },
    // Визуальные и звуковые пресеты
    APPEARANCE: {
        THEMES: ['NEON_NIGHT', 'GOLD_ROYAL', 'DARK_SPACE'],
        DEFAULT_THEME: 'NEON_NIGHT',
        VIBRATION_ENABLED: true,
        SOUND_ENABLED: true,
        SYMBOLS: ['🍒', '7️⃣', '💎', '💰', '⭐', '🎱', '🍀', '🔥']
    }
};

const app = express();
app.use(express.json());

// ============================================================
// [2] БАЗА ДАННЫХ И МОДЕЛЬ С НАСТРОЙКАМИ (DB LAYER)
// ============================================================
mongoose.connect(GAME_CORE_SETTINGS.SYSTEM.MONGO_URI)
    .then(() => console.log("CORE: DB Connected"))
    .catch(err => console.log("CORE: DB Error", err));

const UserSchema = new mongoose.Schema({
    uid: { type: String, unique: true },
    balance: { type: Number, default: 0.10 },
    // Личные настройки пользователя внутри игры
    userSettings: {
        hapticFeedback: { type: Boolean, default: true },
        soundVolume: { type: Number, default: 0.5 },
        theme: { type: String, default: 'NEON_NIGHT' },
        autoSpin: { type: Boolean, default: false }
    },
    stats: {
        totalSpins: { type: Number, default: 0 },
        totalWins: { type: Number, default: 0 }
    }
});

const User = mongoose.model('User', UserSchema);

// ============================================================
// [3] ИНТЕРФЕЙС НАСТРОЕК (UI SETTINGS & GAME)
// ============================================================
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
    <title>${GAME_CORE_SETTINGS.SYSTEM.TITLE}</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        /* РАЗВЕРНУТЫЙ CSS (ДЛЯ ОБЪЕМА И КРАСОТЫ) */
        :root {
            --p: #00ffff;
            --s: #ff00ff;
            --bg: #0a0a0a;
            --panel: #1a1a1a;
        }

        body {
            margin: 0;
            padding: 0;
            background: var(--bg);
            color: white;
            font-family: 'Inter', sans-serif;
            overflow: hidden;
            height: 100vh;
        }

        .screen {
            display: none;
            flex-direction: column;
            padding: 20px;
            height: 100%;
            box-sizing: border-box;
        }

        .active { display: flex; }

        /* HEADER */
        .header {
            background: var(--panel);
            padding: 20px;
            border-radius: 20px;
            border: 1px solid #333;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .bal-title { font-size: 10px; color: #888; letter-spacing: 1px; }
        .bal-value { font-size: 28px; font-weight: 900; color: var(--p); }

        /* GAME AREA */
        .reels {
            display: flex;
            gap: 10px;
            margin: 40px 0;
            justify-content: center;
        }

        .reel {
            width: 80px;
            height: 100px;
            background: #000;
            border: 2px solid var(--s);
            border-radius: 15px;
            font-size: 45px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 0 15px rgba(255,0,255,0.2);
        }

        /* SETTINGS PANEL */
        .settings-list {
            background: var(--panel);
            border-radius: 20px;
            padding: 10px;
            margin-top: 20px;
        }

        .setting-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px;
            border-bottom: 1px solid #333;
        }

        .setting-item:last-child { border: none; }

        /* КНОПКИ */
        .btn {
            background: linear-gradient(45deg, var(--s), #7000ff);
            border: none;
            padding: 20px;
            border-radius: 20px;
            color: white;
            font-weight: 900;
            font-size: 18px;
            width: 100%;
            box-shadow: 0 10px 20px rgba(112,0,255,0.3);
        }

        .btn-tab {
            flex: 1;
            padding: 15px;
            background: transparent;
            color: #555;
            border: none;
            font-size: 12px;
            font-weight: bold;
        }

        .btn-tab.active { color: var(--p); border-bottom: 2px solid var(--p); }

        /* ПЕРЕКЛЮЧАТЕЛЬ (SWITCH) */
        .switch {
            width: 40px;
            height: 20px;
            background: #333;
            border-radius: 10px;
            position: relative;
            cursor: pointer;
        }

        .switch.on { background: var(--p); }
        .switch::after {
            content: '';
            position: absolute;
            width: 16px;
            height: 16px;
            background: white;
            border-radius: 50%;
            top: 2px;
            left: 2px;
            transition: 0.2s;
        }
        .switch.on::after { left: 22px; }
    </style>
</head>
<body>

    <div id="game-screen" class="screen active">
        <div class="header">
            <div>
                <div class="bal-title">БАЛАНС TON</div>
                <div class="bal-value" id="v-bal">0.00</div>
            </div>
            <button onclick="switchScreen('settings-screen')" style="background:none; border:none; font-size:24px;">⚙️</button>
        </div>

        <div class="reels">
            <div class="reel" id="r1">?</div>
            <div class="reel" id="r2">?</div>
            <div class="reel" id="r3">?</div>
        </div>

        <button class="btn" id="spin-btn" onclick="startSpin()">КРУТИТЬ (0.1)</button>
    </div>

    <div id="settings-screen" class="screen">
        <div style="display:flex; align-items:center; margin-bottom:20px;">
            <button onclick="switchScreen('game-screen')" style="background:none; border:none; color:var(--p); font-size:24px;">←</button>
            <h2 style="margin-left:20px;">НАСТРОЙКИ</h2>
        </div>

        <div class="settings-list">
            <div class="setting-item">
                <span>Вибрация (Haptic)</span>
                <div class="switch on" id="set-haptic" onclick="toggleSet('haptic')"></div>
            </div>
            <div class="setting-item">
                <span>Звуковые эффекты</span>
                <div class="switch on" id="set-sound" onclick="toggleSet('sound')"></div>
            </div>
            <div class="setting-item">
                <span>Тема оформления</span>
                <select style="background:#000; color:white; border:1px solid #333; padding:5px; border-radius:5px;">
                    <option>Neon Night</option>
                    <option>Gold Royal</option>
                </select>
            </div>
            <div class="setting-item">
                <span>Версия</span>
                <span style="color:#555">V0.1 BETA</span>
            </div>
        </div>
        
        <p style="text-align:center; color:#444; font-size:10px; margin-top:40px;">
            UID: <span id="u-id">...</span><br>
            WALLET: ${GAME_CORE_SETTINGS.SYSTEM.WALLET}
        </p>
    </div>

    <script>
        const tg = window.Telegram.WebApp;
        const uid = tg.initDataUnsafe?.user?.id || "777";
        
        let userSettings = {
            haptic: true,
            sound: true
        };

        function switchScreen(id) {
            document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
            document.getElementById(id).classList.add('active');
        }

        function toggleSet(key) {
            userSettings[key] = !userSettings[key];
            document.getElementById('set-'+key).classList.toggle('on');
            if(userSettings.haptic) tg.HapticFeedback.impactOccurred('light');
        }

        async function sync() {
            const r = await fetch('/api/sync', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({uid}) });
            const d = await r.json();
            document.getElementById('v-bal').innerText = d.balance.toFixed(2);
            document.getElementById('u-id').innerText = uid;
        }

        async function startSpin() {
            const btn = document.getElementById('spin-btn');
            btn.disabled = true;
            if(userSettings.haptic) tg.HapticFeedback.impactOccurred('heavy');

            const r = await fetch('/api/play', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({uid, bet: 0.1}) });
            const d = await r.json();

            if(d.err) { tg.showAlert(d.err); btn.disabled = false; return; }

            // Эмуляция вращения
            let spins = 0;
            const iv = setInterval(() => {
                const syms = ['🍒', '7️⃣', '💎', '💰', '⭐', '🎱'];
                [1,2,3].forEach(id => document.getElementById('r'+id).innerText = syms[Math.floor(Math.random()*6)]);
                spins++;
                if(spins > 10) {
                    clearInterval(iv);
                    [1,2,3].forEach((id, i) => document.getElementById('r'+id).innerText = d.result[i]);
                    sync();
                    btn.disabled = false;
                    if(d.win > 0) tg.showAlert("Победа: " + d.win + " TON");
                }
            }, 100);
        }

        sync();
        tg.expand();
    </script>
</body>
</html>
    `);
});

// ==========================================
// [4] API BACKEND
// ==========================================
app.post('/api/sync', async (req, res) => {
    const user = await User.findOne({ uid: req.body.uid });
    res.json(user || { balance: 0 });
});

app.post('/api/play', async (req, res) => {
    const { uid, bet } = req.body;
    const user = await User.findOne({ uid });
    if (!user || user.balance < bet) return res.json({ err: "No balance" });

    user.balance -= bet;
    const s = GAME_CORE_SETTINGS.APPEARANCE.SYMBOLS;
    const result = [s[crypto.randomInt(0,8)], s[crypto.randomInt(0,8)], s[crypto.randomInt(0,8)]];
    
    let win = 0;
    if(result[0] === result[1] && result[1] === result[2]) win = bet * 10;
    else if(result[0] === result[1] || result[1] === result[2]) win = bet * 1.5;

    user.balance += win;
    await user.save();
    res.json({ result, win, balance: user.balance });
});

app.listen(3000, () => console.log("SYSTEM ONLINE"));
