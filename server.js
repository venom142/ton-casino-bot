const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

// --- ИНИЦИАЛИЗАЦИЯ СЕРВЕРА ---
const app = express();
const PORT = process.env.PORT || 10000;

// --- КОНФИГУРАЦИЯ ПРОЕКТА ---
const WALLET = "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn"; 
const MONGO_URI = "mongodb+srv://sv2951605_db_user:zetatop123@cluster0.k5dri5s.mongodb.net/?appName=Cluster0";
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = "8475323865"; 

// --- ПОДКЛЮЧЕНИЕ К БАЗЕ ДАННЫХ ---
mongoose.connect(MONGO_URI)
    .then(() => console.log(">>> DATABASE CONNECTED"))
    .catch(err => console.log(">>> DB ERROR:", err));

const User = mongoose.model('User', { 
    uid: String, 
    balance: { type: Number, default: 0.10 },
    s: { type: Number, default: 0 }, 
    w: { type: Number, default: 0 }
});

// --- ИНИЦИАЛИЗАЦИЯ ТЕЛЕГРАМ БОТА ---
const bot = BOT_TOKEN ? new TelegramBot(BOT_TOKEN, { polling: true }) : null;

app.use(express.json());

// --- СЕРВЕРНЫЕ ЭНДПОИНТЫ (API) ---

app.post('/api/sync', async (req, res) => {
    let u = await User.findOne({ uid: req.body.uid.toString() });
    if (!u) u = await new User({ uid: req.body.uid.toString() }).save();
    res.json(u);
});

app.post('/api/spin', async (req, res) => {
    const { uid, bet } = req.body;
    const u = await User.findOne({ uid: uid.toString() });
    
    if (!u || u.balance < bet) return res.json({ err: "МАЛО TON" });
    
    u.balance -= bet;
    u.s += 1;
    
    const syms = ['🍒','7️⃣','💎','💰','⭐','🎱'];
    let r;
    
    // НАСТРОЙКА ШАНСА ВЫИГРЫША (5%)
    if (Math.random() < 0.05) {
        const winSym = syms[Math.floor(Math.random() * 6)];
        r = [winSym, winSym, winSym];
    } else {
        r = [syms[Math.floor(Math.random()*6)], syms[Math.floor(Math.random()*6)], syms[Math.floor(Math.random()*6)]];
        if (r[0] === r[1] && r[1] === r[2]) {
            r[2] = syms[(syms.indexOf(r[2]) + 1) % 6];
        }
    }

    let win = (r[0] === r[1] && r[1] === r[2]) ? bet * 10 : 0;
    u.balance += win;
    if (win > 0) u.w += 1;
    
    await u.save();
    res.json({ r, win, balance: u.balance });
});

// --- АДМИН-ФУНКЦИЯ: РАБОЧАЯ РАССЫЛКА ---
app.post('/api/admin/broadcast', async (req, res) => {
    if (req.body.admin_id.toString() !== ADMIN_ID || !bot) {
        return res.status(403).send("Access Denied");
    }
    
    const users = await User.find();
    let count = 0;
    
    for (let u of users) {
        try {
            await bot.sendMessage(u.uid, req.body.text);
            count++;
        } catch (e) {
            console.log("Failed to send to:", u.uid);
        }
    }
    res.json({ sent: count });
});

// --- ВИЗУАЛЬНАЯ ЧАСТЬ (ИНТЕРФЕЙС) ---

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        :root { --neon: #0ff; --pink: #f0f; --bg: #050505; }
        
        body { 
            margin: 0; 
            background: #000 url('https://files.catbox.moe/622ngf.jpg') center/cover; 
            color: #fff; 
            font-family: 'Roboto', sans-serif; 
            height: 100vh; 
            overflow: hidden; 
        }

        .nav { 
            display: flex; 
            background: rgba(0,0,0,0.95); 
            padding: 10px 5px; 
            border-bottom: 2px solid #222; 
        }

        .tab { 
            flex: 1; 
            padding: 10px; 
            opacity: 0.4; 
            font-size: 11px; 
            font-weight: 900; 
            text-align: center;
        }

        .tab.active { 
            opacity: 1; 
            color: var(--neon); 
            border-bottom: 2px solid var(--neon); 
        }

        .card { 
            background: rgba(0,0,0,0.9); 
            border: 1px solid #333; 
            border-radius: 30px; 
            margin: 15px; 
            padding: 25px; 
            box-shadow: 0 15px 35px rgba(0,0,0,0.8);
        }

        .bal-val { 
            font-size: 50px; 
            font-weight: 900; 
            color: var(--neon); 
            text-shadow: 0 0 20px rgba(0,255,255,0.6);
        }

        .reels { 
            display: flex; 
            justify-content: center; 
            gap: 15px; 
            margin: 25px 0; 
        }

        .reel-box { 
            width: 85px; 
            height: 85px; 
            background: #000; 
            border: 3px solid var(--pink); 
            border-radius: 20px; 
            font-size: 45px; 
            overflow: hidden; 
            position: relative; 
            box-shadow: inset 0 0 20px var(--pink);
        }

        .strip { 
            position: absolute; 
            width: 100%; 
            transition: transform 2.5s cubic-bezier(0.1, 0, 0, 1); 
        }

        .sym { 
            height: 85px; 
            display: flex; 
            align-items: center; 
            justify-content: center; 
        }

        .btn { 
            width: 90%; 
            padding: 22px; 
            background: linear-gradient(135deg, var(--pink), #70f); 
            border: none; 
            border-radius: 20px; 
            color: #fff; 
            font-weight: 900; 
            font-size: 22px; 
            box-shadow: 0 8px 25px rgba(255,0,255,0.4); 
            transition: 0.3s;
        }

        .btn:active { transform: scale(0.95); opacity: 0.8; }
        
        .hidden { display: none !important; }

        textarea { 
            width: 100%; 
            height: 120px; 
            background: #111; 
            color: var(--neon); 
            border: 1px solid #444; 
            border-radius: 20px; 
            padding: 15px; 
            margin: 15px 0;
        }
    </style>
</head>
<body>
    <div class="nav">
        <div class="tab active" onclick="sw(1)" id="t1">ИГРА</div>
        <div class="tab" onclick="sw(2)" id="t2">ПРОФИЛЬ</div>
        <div class="tab" onclick="sw(3)" id="t3">КОШЕЛЕК</div>
        <div class="tab" onclick="sw(4)" id="t4">ЕЩЕ</div>
    </div>

    <div id="p1">
        <div class="card">
            <div id="v-bal" class="bal-val">0.00</div>
            <select id="v-bet" style="width:100%; background:#222; color:#fff; padding:15px; border-radius:15px; border:1px solid #444; margin-top:15px;">
                <option value="0.01">СТАВКА 0.01 TON</option>
                <option value="0.05">СТАВКА 0.05 TON</option>
                <option value="0.10">СТАВКА 0.10 TON</option>
            </select>
        </div>
        <div class="reels">
            <div class="reel-box"><div class="strip" id="s1"></div></div>
            <div class="reel-box"><div class="strip" id="s2"></div></div>
            <div class="reel-box"><div class="strip" id="s3"></div></div>
        </div>
        <button class="btn" onclick="spin()" id="spin-btn">ИГРАТЬ</button>
    </div>

    <div id="p2" class="hidden">
        <div class="card">
            <h2 style="color:var(--neon)">МОИ ДАННЫЕ</h2>
            <div id="stats" style="line-height:2.5; font-size:20px; margin-top:20px;"></div>
        </div>
    </div>

    <div id="p3" class="hidden">
        <div class="card">
            <h3>ДЕПОЗИТ</h3>
            <div style="background:#111; padding:20px; border-radius:15px; border:1px dashed var(--neon); word-break:break-all; font-size:12px;" onclick="cp('${WALLET}')">${WALLET}</div>
            <p style="margin-top:20px; color:var(--pink)">ID ДЛЯ КОММЕНТАРИЯ:</p>
            <div id="v-id" style="font-size:24px; font-weight:bold; color:var(--neon)"></div>
        </div>
    </div>

    <div id="p4">
        <div class="card">
            <button class="btn" style="background:#222" onclick="sw(5)" id="adm-btn">АДМИН ПАНЕЛЬ</button>
        </div>
    </div>

    <div id="p5" class="hidden">
        <div class="card">
            <h3 style="color:yellow">РАССЫЛКА</h3>
            <textarea id="bc-text" placeholder="Текст вашего сообщения..."></textarea>
            <button class="btn" onclick="sendBc()">ОТПРАВИТЬ ВСЕМ</button>
            <button class="btn" style="background:#333; margin-top:15px;" onclick="sw(4)">ОТМЕНА</button>
        </div>
    </div>

    <script>
        const tg = window.Telegram.WebApp;
        const uid = tg.initDataUnsafe?.user?.id || "12345";
        const syms = ['🍒','7️⃣','💎','💰','⭐','🎱'];

        function sw(n) {
            [1,2,3,4,5].forEach(i => {
                const p = document.getElementById('p'+i);
                if(p) p.classList.toggle('hidden', i!==n);
                const t = document.getElementById('t'+i);
                if(t) t.classList.toggle('active', i===n);
            });
        }

        function cp(t) { navigator.clipboard.writeText(t); tg.showAlert("Скопировано!"); }

        function init() {
            [1,2,3].forEach(id => {
                const s = document.getElementById('s'+id);
                s.innerHTML = '';
                for(let i=0; i<30; i++) s.innerHTML += '<div class="sym">'+syms[Math.floor(Math.random()*6)]+'</div>';
            });
        }

        async function sync() {
            const r = await fetch('/api/sync', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid})});
            const d = await r.json();
            document.getElementById('v-bal').innerText = d.balance.toFixed(2);
            document.getElementById('stats').innerHTML = "Игр: " + d.s + "<br>Побед: " + d.w;
            document.getElementById('v-id').innerText = uid;
            document.getElementById('adm-btn').classList.toggle('hidden', uid.toString() !== "${ADMIN_ID}");
        }

        async function spin() {
            const btn = document.getElementById('spin-btn');
            btn.disabled = true;
            const res = await fetch('/api/spin', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, bet: document.getElementById('v-bet').value})});
            const d = await res.json();
            
            if(d.err) { tg.showAlert(d.err); btn.disabled = false; return; }

            [1,2,3].forEach((id, i) => {
                const s = document.getElementById('s'+id);
                s.style.transition = 'none';
                s.style.transform = 'translateY(0)';
                s.children[29].innerText = d.r[i];
                setTimeout(() => {
                    s.style.transition = 'transform '+(2+i*0.5)+'s cubic-bezier(0.1,0,0,1)';
                    s.style.transform = 'translateY(-2465px)';
                }, 50);
            });

            setTimeout(() => { sync(); btn.disabled = false; if(d.win > 0) tg.showAlert("ВЫИГРЫШ: "+d.win+" TON!"); }, 3500);
        }

        async function sendBc() {
            const text = document.getElementById('bc-text').value;
            if(!text) return;
            const r = await fetch('/api/admin/broadcast', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({admin_id: uid, text})});
            const d = await r.json();
            tg.showAlert("Отправлено: " + d.sent);
            sw(4);
        }

        init(); sync(); tg.expand();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log("SERVER ACTIVE ON PORT " + PORT));
