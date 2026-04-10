const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

/** * СЕРВЕРНАЯ КОНФИГУРАЦИЯ
 */
const app = express();
const PORT = process.env.PORT || 10000;

// ДАННЫЕ ПРОЕКТА
const WALLET = "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn"; 
const MONGO_URI = "mongodb+srv://sv2951605_db_user:zetatop123@cluster0.k5dri5s.mongodb.net/?appName=Cluster0";
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = "8475323865"; // ТВОЙ ID ДЛЯ АДМИНКИ

// ПОДКЛЮЧЕНИЕ К БАЗЕ
mongoose.connect(MONGO_URI)
    .then(() => console.log(">>> [DATABASE] СВЯЗЬ УСТАНОВЛЕНА"))
    .catch(err => console.error(">>> [DATABASE] ОШИБКА:", err));

// СХЕМА ИГРОКА
const User = mongoose.model('User', { 
    uid: String, 
    balance: { type: Number, default: 0.10 },
    spins: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    is_banned: { type: Boolean, default: false }
});

app.use(express.json());

// --- ОСНОВНОЙ ИНТЕРФЕЙС ---
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>VIP TON SLOTS</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        :root { --neon: #0ff; --pink: #f0f; --bg: #000; }
        body { margin: 0; background: var(--bg) url('https://files.catbox.moe/622ngf.jpg') center/cover no-repeat; color: #fff; font-family: 'Segoe UI', sans-serif; height: 100vh; overflow: hidden; }
        
        /* НАВИГАЦИЯ */
        .nav { display: flex; background: rgba(0,0,0,0.95); padding: 10px; border-bottom: 2px solid #222; }
        .tab { flex: 1; padding: 12px; font-size: 11px; text-align: center; font-weight: 900; opacity: 0.4; transition: 0.3s; border-radius: 10px; }
        .tab.active { opacity: 1; color: var(--neon); background: rgba(0,255,255,0.1); border: 1px solid var(--neon); }

        .container { height: calc(100vh - 70px); padding: 20px; overflow-y: auto; display: flex; flex-direction: column; align-items: center; }
        .card { width: 100%; background: rgba(0,0,0,0.9); border: 2px solid var(--neon); border-radius: 20px; padding: 20px; text-align: center; margin-bottom: 15px; }
        
        .bal-val { font-size: 48px; font-weight: 900; color: var(--neon); text-shadow: 0 0 15px var(--neon); }
        select { width: 100%; padding: 15px; background: #111; border: 1px solid #333; color: var(--neon); border-radius: 12px; margin: 10px 0; font-size: 18px; }
        
        /* СЛОТЫ */
        .reels { display: flex; gap: 10px; margin: 20px 0; }
        .reel { width: 85px; height: 85px; background: #000; border: 3px solid var(--pink); border-radius: 15px; font-size: 45px; display: flex; align-items: center; justify-content: center; box-shadow: inset 0 0 15px var(--pink); }
        
        .btn { width: 100%; padding: 18px; border-radius: 15px; border: none; background: linear-gradient(135deg, var(--pink), #70f); color: #fff; font-size: 20px; font-weight: 900; cursor: pointer; transition: 0.2s; box-shadow: 0 5px 15px rgba(255,0,255,0.3); }
        .btn:active { transform: scale(0.96); }
        .btn-alt { background: #222; border: 1px solid #444; margin-top: 10px; font-size: 14px; }
        
        .hidden { display: none !important; }
        .admin-btn { background: #ff0 !important; color: #000 !important; margin-top: 20px; }
        .copy-box { background: #0a0a0a; padding: 12px; border-radius: 10px; border: 1px dashed var(--neon); font-size: 11px; margin-top: 10px; cursor: pointer; }
    </style>
</head>
<body>
    <audio id="music" loop src="https://files.catbox.moe/78surr.mp3"></audio>
    
    <div class="nav">
        <div class="tab active" onclick="sw(1)" id="t1">ИГРА</div>
        <div class="tab" onclick="sw(2)" id="t2">ИНФО</div>
        <div class="tab" onclick="sw(3)" id="t3">ДЕПОЗИТ</div>
        <div class="tab" onclick="sw(4)" id="t4">ОПЦИИ</div>
    </div>

    <div id="p1" class="container">
        <div class="card">
            <div style="font-size:10px; opacity:0.6;">ВАШ БАЛАНС</div>
            <div class="bal-val" id="v-bal">0.00</div>
            <select id="v-bet">
                <option value="0.01">СТАВКА: 0.01 TON</option>
                <option value="0.05">СТАВКА: 0.05 TON</option>
                <option value="0.10">СТАВКА: 0.10 TON</option>
            </select>
        </div>
        <div class="reels">
            <div class="reel" id="r1">?</div>
            <div class="reel" id="r2">?</div>
            <div class="reel" id="r3">?</div>
        </div>
        <button class="btn" id="s-btn" onclick="spin()">КРУТИТЬ</button>
    </div>

    <div id="p2" class="container hidden">
        <div class="card">
            <h2 style="color:var(--neon)">МОЯ СТАТИСТИКА</h2>
            <div style="display:flex; justify-content:space-around; margin:20px 0;">
                <div><b id="v-s" style="font-size:24px;">0</b><br><small>Игр</small></div>
                <div><b id="v-w" style="font-size:24px;">0</b><br><small>Побед</small></div>
            </div>
            <p style="font-size:12px; opacity:0.7;">Версия системы: 2.0.4 (Stable)</p>
        </div>
    </div>

    <div id="p3" class="container hidden">
        <div class="card">
            <h3>ПОПОЛНЕНИЕ</h3>
            <div class="copy-box" onclick="cp('${WALLET}')">${WALLET}</div>
            <p style="font-size:11px; color:var(--pink); margin-top:15px;">ОБЯЗАТЕЛЬНО: Укажите ваш ID в комментарии!</p>
            <div id="v-id" class="copy-box" style="border-color:var(--pink); color:var(--pink); font-size:20px; font-weight:bold;">ID...</div>
        </div>
    </div>

    <div id="p4" class="container hidden">
        <div class="card">
            <h3>НАСТРОЙКИ</h3>
            <button class="btn btn-alt" onclick="tglM()" id="m-btn">МУЗЫКА: ВЫКЛ</button>
            <button class="btn btn-alt" onclick="tg.showAlert('Все системы работают в штатном режиме')">ПРОВЕРКА СВЯЗИ</button>
            
            <button id="adm-btn" class="btn admin-btn hidden" onclick="sw(5)">ПАНОРАМА УПРАВЛЕНИЯ</button>
        </div>
    </div>

    <div id="p5" class="container hidden">
        <div class="card" style="border-color:#ff0;">
            <h2 style="color:#ff0;">ADMIN PANEL</h2>
            <p style="font-size:12px;">Вы вошли как главный администратор.</p>
            <hr style="opacity:0.2; margin:15px 0;">
            <button class="btn btn-alt" style="color:#ff0;" onclick="tg.showAlert('В разработке: Массовая рассылка')">РАССЫЛКА БОТОМ</button>
            <button class="btn btn-alt" onclick="sw(4)">ВЫЙТИ</button>
        </div>
    </div>

    <script>
        const tg = window.Telegram.WebApp;
        const uid = tg.initDataUnsafe?.user?.id || "12345";
        const syms = ['🍒','7️⃣','💎','💰','⭐'];
        let active = false;

        function cp(t) { navigator.clipboard.writeText(t); tg.showAlert("Скопировано!"); }
        function sw(n) {
            for(let i=1; i<=5; i++) {
                if(document.getElementById('p'+i)) document.getElementById('p'+i).classList.toggle('hidden', i!==n);
                if(document.getElementById('t'+i)) document.getElementById('t'+i).classList.toggle('active', i===n);
            }
        }

        function tglM() {
            const m = document.getElementById('music'), b = document.getElementById('m-btn');
            if(m.paused) { m.play(); b.innerText="МУЗЫКА: ВКЛ"; b.style.borderColor="var(--neon)"; }
            else { m.pause(); b.innerText="МУЗЫКА: ВЫКЛ"; b.style.borderColor="#444"; }
        }

        async function sync() {
            const r = await fetch('/api/sync', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid})});
            const d = await r.json();
            document.getElementById('v-bal').innerText = d.balance.toFixed(2);
            document.getElementById('v-s').innerText = d.spins;
            document.getElementById('v-w').innerText = d.wins;
            document.getElementById('v-id').innerText = 'ID_' + uid;
            
            // ПРОВЕРКА АДМИНА
            if(uid.toString() === "${ADMIN_ID}") {
                document.getElementById('adm-btn').classList.remove('hidden');
            }
        }

        async function spin() {
            if(active) return; active = true;
            const btn = document.getElementById('s-btn'); btn.disabled = true;
            
            const res = await fetch('/api/spin', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, bet: document.getElementById('v-bet').value})});
            const d = await res.json();
            
            if(d.err) { tg.showAlert(d.err); btn.disabled = false; active = false; return; }

            // Эффект вращения (быстрая смена символов)
            let count = 0;
            const iv = setInterval(() => {
                document.getElementById('r1').innerText = syms[Math.floor(Math.random()*5)];
                document.getElementById('r2').innerText = syms[Math.floor(Math.random()*5)];
                document.getElementById('r3').innerText = syms[Math.floor(Math.random()*5)];
                count++;
                if(count > 15) {
                    clearInterval(iv);
                    document.getElementById('r1').innerText = d.r[0];
                    document.getElementById('r2').innerText = d.r[1];
                    document.getElementById('r3').innerText = d.r[2];
                    sync();
                    btn.disabled = false; active = false;
                    if(d.win > 0) tg.showAlert("💎 ПОБЕДА: " + d.win + " TON!");
                }
            }, 70);
        }

        sync(); tg.expand();
    </script>
</body>
</html>
    `);
});

// --- API ЛОГИКА ---

app.post('/api/sync', async (req, res) => {
    let u = await User.findOne({ uid: req.body.uid });
    if (!u) u = await new User({ uid: req.body.uid }).save();
    res.json(u);
});

app.post('/api/spin', async (req, res) => {
    const { uid, bet } = req.body;
    const b = parseFloat(bet);
    const u = await User.findOne({ uid });
    
    if (!u || u.balance < b) return res.json({ err: "МАЛО TON НА БАЛАНСЕ" });
    
    u.balance = Number((u.balance - b).toFixed(2));
    u.spins += 1;
    
    const s = ['🍒','7️⃣','💎','💰','⭐'];
    let r;
    
    // ШАНС 5% НА ВЫИГРЫШ
    const winChance = Math.random(); // от 0 до 1
    if (winChance < 0.05) { // 0.05 = 5%
        const winSym = s[Math.floor(Math.random()*5)];
        r = [winSym, winSym, winSym];
    } else {
        r = [s[Math.floor(Math.random()*5)], s[Math.floor(Math.random()*5)], s[Math.floor(Math.random()*5)]];
        // Если случайно выпали три одинаковых - меняем последний, чтобы не было халявы
        if(r[0] === r[1] && r[1] === r[2]) {
            r[2] = s[(s.indexOf(r[2]) + 1) % 5];
        }
    }
    
    let win = (r[0] === r[1] && r[1] === r[2]) ? Number((b * 10).toFixed(2)) : 0;
    u.balance = Number((u.balance + win).toFixed(2));
    if (win > 0) u.wins += 1;
    
    await u.save();
    res.json({ r, win });
});

// ЗАПУСК
app.listen(PORT, '0.0.0.0', () => {
    console.log(`--- [READY] SERVER PORT: ${PORT} | ADMIN ID: ${ADMIN_ID} ---`);
});
