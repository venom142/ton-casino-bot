const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;

// [ БЕЗОПАСНЫЙ КОНФИГ ]
// Данные берем из настроек Render (Environment Variables)
const MONGO_URI = process.env.MONGO_URI;

// [ ПОДКЛЮЧЕНИЕ К БД ]
mongoose.connect(MONGO_URI)
    .then(() => console.log("🚀 БАЗА ПОДКЛЮЧЕНА"))
    .catch((e) => console.log("❌ ОШИБКА БАЗЫ:", e.message));

// [ МОДЕЛЬ ПОЛЬЗОВАТЕЛЯ ]
const User = mongoose.model('User', { 
    uid: String, 
    balance: { type: Number, default: 0.10 }, // Начальный баланс
    s: { type: Number, default: 0 }, 
    w: { type: Number, default: 0 }
});

app.use(cors());
app.use(express.json());

// [ API ДЛЯ ИГРЫ ]
app.post('/api/sync', async (req, res) => {
    try {
        let u = await User.findOne({ uid: req.body.uid.toString() });
        if (!u) { u = new User({ uid: req.body.uid.toString() }); await u.save(); }
        res.json(u);
    } catch (e) { res.status(500).json({ error: "Ошибка БД" }); }
});

app.post('/api/spin', async (req, res) => {
    const { uid, bet } = req.body;
    const bV = parseFloat(bet);
    if (![0.01, 0.1, 0.5, 1.0].includes(bV)) return res.json({ err: "СТАВКА?" });
    
    const u = await User.findOne({ uid: uid.toString() });
    if (!u || u.balance < bV) return res.json({ err: "МАЛО TON" });

    u.balance = Number((u.balance - bV).toFixed(2)); u.s += 1;
    const syms = ['🍒','7️⃣','💎','💰','⭐','🎱'];
    const r = [syms[Math.floor(Math.random()*6)], syms[Math.floor(Math.random()*6)], syms[Math.floor(Math.random()*6)]];
    
    let win = (r[0] === r[1] && r[1] === r[2]) ? Number((bV * 10).toFixed(2)) : 0;
    if(win > 0) { u.balance += win; u.w += 1; }
    
    await u.save(); 
    res.json({ r, win, balance: u.balance, s: u.s, w: u.w });
});

// [ СТАРЫЙ ИНТЕРФЕЙС + ТВОЙ АХУЕНЫЙ ФОН ]
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
    <title>💎VIP TON ХОТ ТАП💎</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; margin: 0; padding: 0; }
        body { height: 100vh; overflow: hidden; color: #fff; font-family: 'Montserrat', sans-serif; display: flex; flex-direction: column; position: relative; }
        
        /* [ ВОТ ОН, ТВОЙ ФОН ] */
        body::before {
            content: "";
            position: absolute;
            width: 200%; height: 200%;
            top: -50%; left: -50%;
            /* Картинка, которую ты скинул */
            background-image: url('https://w.forfun.com/fetch/51/51f50a30707b66710b65670845187747.jpeg'); 
            background-size: cover;
            background-position: center;
            /* Плавное движение для эффекта «кибер-сетки» */
            animation: moveBg 30s linear infinite;
            z-index: -1;
            opacity: 0.8;
            filter: blur(2px); /* Легкий блюр, чтобы текст читался */
        }

        @keyframes moveBg {
            0% { transform: translateY(0); }
            100% { transform: translateY(100px); }
        }

        /* [ СТАРЫЙ ИНТЕРФЕЙС ПОВЕРХ ФОНА ] */
        .nav-top { display: flex; gap: 8px; padding: 15px; background: rgba(0,0,0,0.6); border-bottom: 1.5px solid rgba(162, 0, 255, 0.4); backdrop-filter: blur(5px); position: sticky; top: 0; z-index: 100; }
        .tab { flex: 1; padding: 13px; background: rgba(10, 10, 20, 0.7); border: 1.5px solid #222; border-radius: 12px; font-size: 11px; font-weight: 800; color: #666; text-align: center; text-transform: uppercase; transition: 0.2s; }
        .tab.active { border-color: #f0f; color: #fff; background: rgba(255,0,255,0.1); box-shadow: 0 0 15px rgba(255,0,255,0.3); }

        .main { flex: 1; display: flex; flex-direction: column; justify-content: space-around; padding: 10px 20px 30px; position: relative; z-index: 10; }
        
        /* КАРТОЧКА БАЛАНСА СО СТЕКЛЯННЫМ ЭФФЕКТОМ */
        .card { background: rgba(0, 0, 5, 0.9); border: 2px solid #0ff; padding: 20px; border-radius: 20px; text-align: center; box-shadow: 0 10px 30px rgba(0,255,255,0.1); backdrop-filter: blur(5px); }
        .bal { font-size: 56px; font-weight: 900; color: #fff; text-shadow: 0 0 25px #0ff; }
        
        .bets { display: flex; justify-content: space-between; gap: 8px; margin: 15px 0; }
        .b-btn { flex: 1; padding: 13px; background: rgba(10, 10, 20, 0.8); border: 1px solid rgba(68, 68, 68, 0.5); border-radius: 12px; color: #999; font-size: 14px; font-weight: 700; transition: border-color 0.2s, color 0.2s; }
        .b-btn.active { border-color: #0ff; color: #fff; box-shadow: 0 0 10px rgba(0,255,255,0.3); }

        .reels { display: flex; justify-content: center; gap: 10px; margin: 20px 0; }
        .slot { width: 31%; height: 95px; background: rgba(0,0,0,0.8); border: 2.5px solid rgba(255,0,255,0.5); border-radius: 18px; display: flex; align-items: center; justify-content: center; font-size: 50px; box-shadow: 0 0 15px rgba(255,0,255,0.2); transition: 0.1s; position: relative; }
        
        .btn-spin { width: 100%; padding: 22px; border-radius: 20px; border: none; background: linear-gradient(135deg, #f0f, #7000ff); color: #fff; font-size: 24px; font-weight: 900; text-transform: uppercase; box-shadow: 0 10px 25px rgba(112, 0, 255, 0.4); }
        .btn-spin:active { transform: scale(0.96); }
        
        .hidden { display: none !important; }
    </style>
</head>
<body>
    <audio id="mus" loop src="https://files.catbox.moe/78surr.mp3"></audio>
    <div class="nav-top">
        <div class="tab active" onclick="sw(1)" id="t1">ИГРА</div>
        <div class="tab" onclick="sw(2)" id="t2">ДЕПОЗИТ</div>
        <div class="tab" onclick="sw(3)" id="t3">ИНФО</div>
        <div class="tab" onclick="sw(4)" id="t4">ОПЦИИ</div>
    </div>

    <div class="main">
        <div id="p-game">
            <div class="card"><p style="font-size:12px; color:#555; letter-spacing:1px; margin-bottom:5px;">БАЛАНС TON</p><div class="bal" id="v-bal">0.00</div></div>
            <div class="bets">
                <button class="b-btn active" onclick="sB(0.01,this)">0.01</button>
                <button class="b-btn" onclick="sB(0.1,this)">0.10</button>
                <button class="b-btn" onclick="sB(0.5,this)">0.50</button>
                <button class="b-btn" onclick="sB(1.0,this)">1.00</button>
            </div>
            <div class="reels">
                <div class="slot" id="s1">💎</div><div class="slot" id="s2">🍒</div><div class="slot" id="s3">💰</div>
            </div>
            <button id="spin-btn" class="btn-spin" onclick="spin()">КРУТИТЬ</button>
        </div>
        <div id="p-other" class="hidden"><div class="card"><h3>Тут твои в разработке</h3></div></div>
    </div>

    <script>
        const tg = window.Telegram.WebApp; tg.expand();
        // ID для тестов, в боте будет настоящий
        const uid = tg.initDataUnsafe?.user?.id || "8475323865"; 
        let currentBet = 0.01;

        async function sync(){
            const r = await fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid})});
            const d = await r.json();
            document.getElementById('v-bal').innerText = d.balance.toFixed(2);
        }

        function sB(v,e){
            currentBet=v;
            document.querySelectorAll('.b-btn').forEach(b=>b.classList.remove('active'));
            e.classList.add('active');
        }

        async function spin(){
            const btn = document.getElementById('spin-btn'); btn.disabled = true;
            tg.HapticFeedback.impactOccurred('medium');

            const r = await fetch('/api/spin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid, bet: currentBet})});
            const d = await r.json();
            if(d.err) { tg.showAlert(d.err); btn.disabled = false; return; }

            const iv = setInterval(()=>{
                document.getElementById('s1').innerText = ['🍒','7️⃣','💎','💰','⭐','🎱'][Math.floor(Math.random()*6)];
                document.getElementById('s2').innerText = ['🍒','7️⃣','💎','💰','⭐','🎱'][Math.floor(Math.random()*6)];
                document.getElementById('s3').innerText = ['🍒','7️⃣','💎','💰','⭐','🎱'][Math.floor(Math.random()*6)];
            }, 100);

            setTimeout(()=>{
                clearInterval(iv);
                document.getElementById('s1').innerText = d.r[0];
                document.getElementById('s2').innerText = d.r[1];
                document.getElementById('s3').innerText = d.r[2];
                sync(); btn.disabled = false;
                if(d.win > 0) {
                    tg.HapticFeedback.notificationOccurred('success');
                    tg.showAlert("ВИН! +"+d.win+" TON");
                }
            }, 1300); // 1.3 секунды анимации
        }

        function sw(n){
            document.getElementById('p-game').classList.toggle('hidden',n!==1);
            document.getElementById('p-other').classList.toggle('hidden',n===1);
            [1,2,3,4].forEach(i=>document.getElementById('t'+i).classList.toggle('active',n===i));
        }
        sync();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log("SERVER ONLINE"));
