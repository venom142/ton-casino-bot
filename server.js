const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 10000;

const MONGO_URI = process.env.MONGO_URI; 
const ADMIN_ID = "8475323865";

mongoose.connect(MONGO_URI)
    .then(() => console.log("SERVER ONLINE"))
    .catch(err => console.error("ОШИБКА БАЗЫ:", err.message));

const User = mongoose.model('User', { 
    uid: String, 
    balance: { type: Number, default: 110.70 } 
});

app.use(cors());
app.use(express.json());

app.post('/api/sync', async (req, res) => {
    try {
        let u = await User.findOne({ uid: req.body.uid.toString() });
        if (!u) u = await User.create({ uid: req.body.uid.toString() });
        res.json(u);
    } catch(e) { res.status(500).json({err: e.message}); }
});

app.post('/api/spin', async (req, res) => {
    try {
        const { uid, bet } = req.body;
        let u = await User.findOne({ uid: uid.toString() });
        if (!u || u.balance < bet) return res.json({ err: "МАЛО TON" });
        u.balance = Number((u.balance - bet).toFixed(2));
        const items = ['🍒','7️⃣','💎','💰','⭐','🎱'];
        const r = [items[Math.floor(Math.random()*6)], items[Math.floor(Math.random()*6)], items[Math.floor(Math.random()*6)]];
        if(r[0] === r[1] && r[1] === r[2]) u.balance += (bet * 10);
        await u.save();
        res.json({ r, balance: u.balance });
    } catch(e) { res.status(500).json({err: "ОШИБКА БАЗЫ"}); }
});

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        body { 
            margin: 0; padding: 0; background: #000; color: #fff; font-family: sans-serif; height: 100vh; display: flex; flex-direction: column; overflow: hidden;
            background-image: url('https://w.forfun.com/fetch/51/51f50a30707b66710b65670845187747.jpeg');
            background-size: cover; background-position: center;
        }
        .nav { display: flex; gap: 8px; padding: 15px; }
        .tab { flex: 1; padding: 12px; background: rgba(26, 26, 46, 0.8); border: 1.5px solid #222; border-radius: 10px; font-size: 11px; font-weight: 800; color: #fff; text-align: center; }
        .tab.active { border-color: #a200ff; background: rgba(162, 0, 255, 0.5); }

        .main { flex: 1; display: flex; flex-direction: column; padding: 0 20px; justify-content: center; gap: 15px; }
        .bal-card { background: rgba(0,0,0,0.85); border: 2px solid #0ff; padding: 25px; border-radius: 20px; text-align: center; box-shadow: 0 0 15px rgba(0,255,255,0.3); }
        .bal-val { font-size: 52px; font-weight: 900; color: #fff; text-shadow: 0 0 15px #0ff; }

        .bets { display: flex; justify-content: space-between; gap: 6px; }
        .b-btn { flex: 1; padding: 12px; background: rgba(10,10,20,0.9); border: 1.5px solid #333; border-radius: 10px; color: #555; font-size: 13px; font-weight: bold; }
        .b-btn.active { border-color: #0ff; color: #0ff; }

        .reels { display: flex; justify-content: center; gap: 10px; }
        .slot { width: 95px; height: 110px; background: rgba(0,0,0,0.9); border: 3.5px solid #f0f; border-radius: 20px; display: flex; align-items: center; justify-content: center; font-size: 48px; }

        .btn-spin { width: 100%; padding: 22px; border-radius: 22px; border: none; background: linear-gradient(to right, #f0f, #7000ff); color: #fff; font-size: 24px; font-weight: 900; box-shadow: 0 8px 20px rgba(162, 0, 255, 0.4); }
        .pg { padding: 20px; flex: 1; display: flex; flex-direction: column; gap: 15px; justify-content: center; }
        .hidden { display: none !important; }
    </style>
</head>
<body>
    <audio id="bg-music" loop src="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"></audio>

    <div class="nav">
        <div class="tab active" onclick="sw(1)" id="t1">ИГРА</div>
        <div class="tab" onclick="sw(2)" id="t2">ДЕПОЗИТ</div>
        <div class="tab" onclick="sw(4)" id="t4">ОПЦИИ</div>
    </div>

    <div id="p1" class="main">
        <div class="bal-card"><div style="font-size:10px; color:#555">БАЛАНС TON</div><div class="bal-val" id="v-bal">110.70</div></div>
        <div class="bets">
            <button class="b-btn active" onclick="sB(0.01,this)">0.01</button>
            <button class="b-btn" onclick="sB(0.1,this)">0.10</button>
            <button class="b-btn" onclick="sB(0.5,this)">0.50</button>
            <button class="b-btn" onclick="sB(1,this)">1.00</button>
        </div>
        <div class="reels"><div class="slot" id="s1">🎱</div><div class="slot" id="s2">7️⃣</div><div class="slot" id="s3">🍒</div></div>
        <button class="btn-spin" onclick="spin()" id="sb">КРУТИТЬ</button>
    </div>

    <div id="p2" class="pg hidden">
        <div class="bal-card" style="text-align:left">
            <p style="color:#0ff; font-weight:bold; margin-bottom:10px">ДЕПОЗИТ</p>
            <p style="font-size:12px">Адрес:</p>
            <div style="border:1.5px dashed #0ff; padding:10px; font-size:11px; word-break:break-all; border-radius:10px">UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn</div>
            <p style="font-size:12px; margin-top:15px">Комментарий (ID):</p>
            <div style="border:1.5px dashed #0ff; padding:10px; font-size:16px; color:#0ff; border-radius:10px">ID_${ADMIN_ID}</div>
        </div>
    </div>

    <div id="p4" class="pg hidden">
        <button class="btn-spin" onclick="toggleMusic()" id="m-btn">МУЗЫКА: OFF</button>
        <button class="btn-spin" style="background: #0ff; color:#000" onclick="alert('ВВЕДИТЕ ПРОМОКОД')">ПРОМОКОД</button>
    </div>

    <script>
        const tg = window.Telegram.WebApp;
        const uid = tg.initDataUnsafe?.user?.id || "${ADMIN_ID}";
        let currentBet = 0.01;
        const audio = document.getElementById('bg-music');

        function toggleMusic() {
            if (audio.paused) { audio.play(); document.getElementById('m-btn').innerText = "МУЗЫКА: ON"; }
            else { audio.pause(); document.getElementById('m-btn').innerText = "МУЗЫКА: OFF"; }
        }

        async function sync(){
            try {
                const r = await fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid})});
                const d = await r.json(); document.getElementById('v-bal').innerText = d.balance.toFixed(2);
            } catch(e) {}
        }

        function sB(v,e){
            currentBet=v;
            document.querySelectorAll('.b-btn').forEach(b=>b.classList.remove('active'));
            e.classList.add('active');
        }

        async function spin(){
            document.getElementById('sb').disabled = true;
            try {
                const res = await fetch('/api/spin', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, bet: currentBet})});
                const d = await res.json();
                if(d.err) { tg.showAlert(d.err); document.getElementById('sb').disabled = false; return; }
                
                let i = setInterval(() => {
                    document.getElementById('s1').innerText = ['🍒','7️⃣','💎','💰','⭐','🎱'][Math.floor(Math.random()*6)];
                    document.getElementById('s2').innerText = ['🍒','7️⃣','💎','💰','⭐','🎱'][Math.floor(Math.random()*6)];
                    document.getElementById('s3').innerText = ['🍒','7️⃣','💎','💰','⭐','🎱'][Math.floor(Math.random()*6)];
                }, 100);

                setTimeout(() => {
                    clearInterval(i);
                    document.getElementById('s1').innerText = d.r[0];
                    document.getElementById('s2').innerText = d.r[1];
                    document.getElementById('s3').innerText = d.r[2];
                    document.getElementById('v-bal').innerText = d.balance.toFixed(2);
                    document.getElementById('sb').disabled = false;
                }, 1000);
            } catch(e) { tg.showAlert("ОШИБКА СЕТИ"); document.getElementById('sb').disabled = false; }
        }

        function sw(n){
            [1,2,4].forEach(i => {
                document.getElementById('p'+i)?.classList.toggle('hidden', i !== n);
                document.getElementById('t'+i)?.classList.toggle('active', i === n);
            });
        }
        sync();
    </script>
</body>
</html>`);
});

app.listen(PORT, () => console.log("SERVER ONLINE"));
