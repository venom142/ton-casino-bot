require('dotenv').config();
const express = require('express'), TelegramBot = require('node-telegram-bot-api'), mongoose = require('mongoose'), axios = require('axios');
const app = express(), PORT = process.env.PORT || 10000;

const CONFIG = {
    ADMIN_ID: 8475323865, 
    WALLET: "UQDoTj0hCwJbI-9fziRCyUZzO2XHmtcDzuiAiGjxG21G3dIX",
    TON_KEY: "fe9429836fd2dfdb009421c6dc389840c9cdadca238477b4e2910250e11fa6d3",
    START_BALANCE: 0.10,
    BG_IMAGE: "https://files.catbox.moe/ep8e91.png"
};
let SET = { ch: 0.12, x: 10, min: 0.01, bgm: "https://files.catbox.moe/ef3c37.mp3" };

mongoose.connect(process.env.MONGO_URI).then(()=>console.log("🚀 DB OK"));
const User = mongoose.model('User', { uid: String, balance: { type: Number, default: CONFIG.START_BALANCE }, last_lt: { type: String, default: "0" }, spins: { type: Number, default: 0 }, wins: { type: Number, default: 0 }, used_p: [String] });

app.use(express.json());

// --- УЛЬТРА-СКАНЕР (ПРОВЕРЯЕТ ВСЁ) ---
setInterval(async () => {
    try {
        // Пробуем получить транзакции через официальное API
        const resp = await axios.get(`https://toncenter.com/api/v2/getTransactions?address=${CONFIG.WALLET}&limit=20&api_key=${CONFIG.TON_KEY}`);
        
        if (resp.data && resp.data.ok) {
            const txs = resp.data.result;
            for (let tx of txs) {
                const lt = tx.transaction_id.lt;
                const value = parseInt(tx.in_msg?.value || 0) / 1000000000;
                const comment = tx.in_msg?.message?.trim(); // Это и есть ID юзера

                if (!comment || isNaN(comment) || value <= 0) continue;

                const user = await User.findOne({ uid: comment });
                if (user) {
                    // Если эта транзакция новая (LT больше сохраненного)
                    if (BigInt(lt) > BigInt(user.last_lt || "0")) {
                        user.balance = parseFloat((user.balance + value).toFixed(2));
                        user.last_lt = lt.toString();
                        await user.save();
                        console.log(`💰 ДОНАТ: +${value} TON для ${user.uid}`);
                    }
                }
            }
        }
    } catch (err) {
        console.log("Ошибка сканера (возможно, лимит API):", err.message);
    }
}, 20000); // Проверка каждые 20 секунд

// --- ОСТАЛЬНОЙ КОД (БЕЗ ИЗМЕНЕНИЙ) ---
app.post('/api/sync', async (req, res) => {
    let u = await User.findOne({ uid: req.body.uid?.toString() });
    if (!u && req.body.uid) u = await User.create({ uid: req.body.uid.toString() });
    res.json(u || { balance: 0 });
});

app.post('/api/spin', async (req, res) => {
    const { uid, bet } = req.body; 
    const u = await User.findOne({ uid: uid.toString() });
    if (!u || u.balance < bet || bet < SET.min) return res.json({ err: "Недостаточно TON" });
    u.balance -= bet;
    const symbols = ['🍒','🔔','💎','7️⃣','🍋'];
    let result = [symbols[Math.floor(Math.random()*5)], symbols[Math.floor(Math.random()*5)], symbols[Math.floor(Math.random()*5)]];
    if (Math.random() < SET.ch) result = ['7️⃣','7️⃣','7️⃣'];
    const isWin = result[0] === result[1] && result[1] === result[2];
    const winAmount = isWin ? bet * SET.x : 0;
    u.balance += winAmount; u.spins++; if(isWin) u.wins++;
    await u.save();
    res.json({ result, winSum: winAmount, balance: u.balance });
});

app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><script src="https://telegram.org/js/telegram-web-app.js"></script><style>
    body { margin:0; font-family:sans-serif; text-align:center; color:#fff; background:#000 url('${CONFIG.BG_IMAGE}') no-repeat center; background-size:cover; height:100vh; overflow:hidden; }
    .nav { display:flex; background:rgba(0,0,0,0.8); border-bottom:1px solid #ff00ff; }
    .tab { flex:1; padding:15px; font-size:12px; cursor:pointer; opacity:0.5; }
    .tab.active { opacity:1; color:#00ffff; border-bottom:2px solid #00ffff; }
    .page { display:none; padding:20px; } .page.active { display:block; }
    .card { background:rgba(255,255,255,0.1); padding:15px; border-radius:15px; backdrop-filter:blur(10px); border:1px solid #00ffff; margin-bottom:10px; }
    .btn { width:100%; padding:15px; background:#ff0; color:#000; border:none; border-radius:10px; font-weight:bold; font-size:18px; }
    .reel-c { display:flex; justify-content:center; gap:5px; margin:15px 0; }
    .reel { width:80px; height:100px; background:#000; border:2px solid #fff; border-radius:10px; font-size:50px; line-height:100px; }
    .copy { background:#222; padding:10px; font-size:10px; border-radius:5px; margin:5px; cursor:pointer; border:1px dashed #00ffff; }
    </style></head><body>
    <audio id="bgm" loop src="${SET.bgm}"></audio>
    <div class="nav"><div class="tab active" onclick="sh(1)">ИГРА</div><div class="tab" onclick="sh(2)">КАССА</div></div>
    <div id="p1" class="page active">
        <div class="card">БАЛАНС: <span id="bal" style="font-size:25px;color:#ff0">0.00</span> TON</div>
        <div class="reel-c"><div class="reel" id="r1">🍒</div><div class="reel" id="r2">🍒</div><div class="reel" id="r3">🍒</div></div>
        <input type="number" id="bet" value="0.1" style="width:80%;padding:10px;margin-bottom:10px;border-radius:10px;border:none;"><button class="btn" onclick="spin()">ИГРАТЬ</button>
    </div>
    <div id="p2" class="page">
        <div class="card"><h3>ПОПОЛНЕНИЕ</h3><div class="copy" onclick="cp('${CONFIG.WALLET}')">${CONFIG.WALLET}</div>
        <p>КОММЕНТАРИЙ (ТВОЙ ID):</p><div class="copy" style="font-size:20px;color:#ff0" id="myid" onclick="cp(window.uid)">...</div></div>
    </div>
    <script>
        const tg = window.Telegram.WebApp; window.uid = tg.initDataUnsafe?.user?.id?.toString() || "12345";
        function cp(t){const e=document.createElement('textarea');e.value=t;document.body.appendChild(e);e.select();document.execCommand('copy');document.body.removeChild(e);tg.showAlert("Скопировано!");}
        function sh(n){document.querySelectorAll('.page').forEach((p,i)=>p.classList.toggle('active',i+1===n));sync();}
        async function sync(){ const r=await fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid:window.uid})}); const d=await r.json(); document.getElementById('bal').innerText=d.balance.toFixed(2); document.getElementById('myid').innerText=window.uid; }
        async function spin(){
            const b=parseFloat(document.getElementById('bet').value);
            const r=await fetch('/api/spin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid:window.uid,bet:b})});
            const d=await r.json(); if(d.err)return tg.showAlert(d.err);
            document.getElementById('r1').innerText='🎰';document.getElementById('r2').innerText='🎰';document.getElementById('r3').innerText='🎰';
            setTimeout(()=>{ document.getElementById('r1').innerText=d.result[0];document.getElementById('r2').innerText=d.result[1];document.getElementById('r3').innerText=d.result[2]; sync(); if(d.winSum>0)tg.showAlert("WIN! +"+d.winSum); }, 1000);
        }
        sync(); tg.expand();
    </script></body></html>`);
});
app.listen(PORT, ()=>console.log("SERVER START"));
