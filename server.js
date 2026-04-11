const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

// === КОНФИГУРАЦИЯ ===
const WALLET = "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn"; 
const TON_KEY = "fe9429836fd2dfdb009421c6dc389840c9cdadca238477b4e2910250e11fa6d3"; 
const ADMIN_ID = "8475323865"; 
const MONGO_URI = "mongodb+srv://sv2951605_db_user:zetatop123@cluster0.k5dri5s.mongodb.net/?appName=Cluster0";

// === БАЗА ДАННЫХ ===
mongoose.connect(MONGO_URI).then(() => console.log(">>> DB CONNECTED"));

const User = mongoose.model('User', { 
    uid: String, 
    balance: { type: Number, default: 0.10 },
    spins: { type: Number, default: 0 }, 
    wins: { type: Number, default: 0 },
    last_lt: { type: String, default: "0" }, 
    used_promos: [String]
});

const Promo = mongoose.model('Promo', { 
    code: String, 
    sum: Number, 
    limit: Number, 
    count: { type: Number, default: 0 } 
});

const bot = process.env.BOT_TOKEN ? new TelegramBot(process.env.BOT_TOKEN, { polling: true }) : null;
app.use(express.json());

// === СКАНЕР ОПЛАТ TON ===
async function checkTransactions() {
    try {
        const url = `https://toncenter.com/api/v2/getTransactions?address=${WALLET}&limit=5&api_key=${TON_KEY}`;
        const response = await axios.get(url);
        if (!response.data.ok) return;

        for (let tx of response.data.result) {
            const inMsg = tx.in_msg;
            if (!inMsg || !inMsg.message) continue;

            const amount = parseInt(inMsg.value) / 1000000000;
            const comment = inMsg.message.trim();
            const currentLt = tx.transaction_id.lt;

            // Ищем юзера по строке или числу, чтобы не терять старые данные
            const user = await User.findOne({ $or: [{ uid: comment }, { uid: Number(comment) }] });
            if (user && currentLt > user.last_lt) {
                user.balance = Number((user.balance + amount).toFixed(2));
                user.last_lt = currentLt;
                await user.save();
                if (bot) bot.sendMessage(user.uid, `✅ Депозит: +${amount} TON`);
            }
        }
    } catch (e) { console.log("Scan error (ignored)"); }
}
setInterval(checkTransactions, 20000);

// === API BACKEND ===
app.post('/api/sync', async (req, res) => {
    const rawUid = req.body.uid.toString();
    // Фикс восстановления старой статистики
    let user = await User.findOne({ $or: [{ uid: rawUid }, { uid: Number(req.body.uid) }] });
    
    if (!user) {
        user = await new User({ uid: rawUid }).save();
    } else if (typeof user.uid !== 'string') {
        user.uid = rawUid; // Обновляем формат на будущее
        await user.save();
    }
    res.json(user);
});

app.post('/api/promo', async (req, res) => {
    const { uid, code } = req.body;
    if (!code) return res.json({ err: "ВВЕДИТЕ КОД" });

    const promo = await Promo.findOne({ code: code.toUpperCase() });
    const user = await User.findOne({ uid: uid.toString() });

    if (!promo || promo.count >= promo.limit) return res.json({ err: "ПРОМОКОД НЕ НАЙДЕН ИЛИ ИСТЕК" });
    if (user.used_promos.includes(promo.code)) return res.json({ err: "ВЫ УЖЕ АКТИВИРОВАЛИ ЭТОТ КОД" });

    user.balance = Number((user.balance + promo.sum).toFixed(2));
    user.used_promos.push(promo.code);
    promo.count += 1;

    await user.save();
    await promo.save();
    res.json({ msg: `✅ +${promo.sum} TON`, balance: user.balance });
});

app.post('/api/spin', async (req, res) => {
    const { uid, bet } = req.body;
    const betNum = parseFloat(bet);
    const user = await User.findOne({ uid: uid.toString() });

    if (!user || user.balance < betNum) return res.json({ err: "НЕДОСТАТОЧНО СРЕДСТВ" });

    user.balance = Number((user.balance - betNum).toFixed(2));
    user.spins += 1;

    const items = ['🍒','7️⃣','💎','💰','⭐'];
    let result;

    if (Math.random() < 0.10) { // Шанс победы 10%
        const jackpot = items[Math.floor(Math.random() * 5)];
        result = [jackpot, jackpot, jackpot];
    } else {
        result = [0,0,0].map(() => items[Math.floor(Math.random() * 5)]);
        if (result[0] === result[1] && result[1] === result[2]) {
            result[2] = items[(items.indexOf(result[2]) + 1) % 5];
        }
    }

    let winAmount = (result[0] === result[1] && result[1] === result[2]) ? Number((betNum * 10).toFixed(2)) : 0;
    user.balance = Number((user.balance + winAmount).toFixed(2));
    if (winAmount > 0) user.wins += 1;

    await user.save();
    res.json({ result, winAmount, balance: user.balance });
});

app.post('/api/admin', async (req, res) => {
    if (req.body.admin_id.toString() !== ADMIN_ID) return res.status(403).send("DENIED");
    
    try {
        if (req.body.type === 'promo') {
            const sum = parseFloat(req.body.sum);
            const limit = parseInt(req.body.limit);
            if (!req.body.code || isNaN(sum) || isNaN(limit)) return res.json({ err: "Неверные данные формы" });
            
            await new Promo({ 
                code: req.body.code.toUpperCase(), 
                sum: sum, 
                limit: limit 
            }).save();
            return res.json({ ok: true });
        }
        
        if (req.body.type === 'broadcast') {
            const users = await User.find();
            for (let u of users) {
                if(bot && req.body.text) {
                    bot.sendMessage(u.uid, req.body.text).catch(() => {});
                }
            }
            return res.json({ ok: true });
        }
    } catch(e) {
        return res.json({ err: "Ошибка сервера" });
    }
});

// === FRONTEND ===
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        body { margin: 0; background: #000 url('https://files.catbox.moe/622ngf.jpg') center/cover; color: #fff; font-family: sans-serif; text-align: center; height: 100vh; overflow: hidden; }
        .nav { display: flex; background: rgba(0,0,0,0.9); padding: 10px; border-bottom: 2px solid #333; }
        .tab { flex: 1; padding: 12px; opacity: 0.4; font-size: 11px; color: #0ff; font-weight: bold; transition: 0.2s; }
        .tab.active { opacity: 1; text-shadow: 0 0 10px #0ff; border-bottom: 2px solid #0ff; }
        .card { background: rgba(0,0,0,0.85); border: 1px solid #0ff; box-shadow: 0 0 15px rgba(0,255,255,0.1); border-radius: 20px; margin: 10px; padding: 15px; }
        
        /* Исправлен черный фон кнопок на красивое полупрозрачное стекло */
        .reel { width: 75px; height: 85px; background: rgba(255,255,255,0.05); border: 2px solid #0ff; border-radius: 15px; font-size: 45px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
        
        /* Плавная анимация вращения */
        @keyframes spin-blur {
            0% { transform: translateY(-15px) scaleY(1.2); filter: blur(3px); opacity: 0.7; }
            100% { transform: translateY(15px) scaleY(1.2); filter: blur(3px); opacity: 0.7; }
        }
        .spinning { animation: spin-blur 0.1s infinite alternate linear; }
        
        .btn { width: 92%; padding: 18px; background: linear-gradient(45deg, #f0f, #70f); border: none; border-radius: 15px; color: #fff; font-size: 16px; font-weight: 900; box-shadow: 0 5px 15px rgba(255,0,255,0.4); transition: 0.2s; }
        .btn:active { transform: scale(0.95); }
        input, textarea, select { width: 85%; background: rgba(0,0,0,0.7); color: #0ff; border: 1px solid #0ff; border-radius: 10px; padding: 12px; margin: 6px 0; text-align: center; outline: none; }
        .hidden { display: none !important; }
    </style>
</head>
<body>
    <audio id="bgm" loop src="https://files.catbox.moe/78surr.mp3"></audio>
    <div class="nav" id="main-nav">
        <div class="tab active" onclick="sw(1)" id="t1">🎰 ИГРА</div>
        <div class="tab" onclick="sw(2)" id="t2">📊 СТАТЫ</div>
        <div class="tab" onclick="sw(3)" id="t3">💎 КАССА</div>
        <div class="tab" onclick="sw(4)" id="t4">⚙️ НАСТРОЙКИ</div>
    </div>
    
    <div id="p1">
        <div class="card">
            <div id="v-bal" style="font-size:50px; color:#0ff; font-weight:900; text-shadow: 0 0 10px #0ff;">0.00</div>
            <select id="v-bet">
                <option value="0.01">СТАВКА: 0.01 TON</option>
                <option value="0.05">СТАВКА: 0.05 TON</option>
                <option value="0.10">СТАВКА: 0.10 TON</option>
            </select>
        </div>
        <div style="display:flex; justify-content:center; gap:10px; margin:25px 0;">
            <div class="reel" id="r1">💎</div>
            <div class="reel" id="r2">💎</div>
            <div class="reel" id="r3">💎</div>
        </div>
        <button class="btn" onclick="spin()" id="spin-btn">ИГРАТЬ</button>
        <div class="card" style="margin-top:20px;">
            <h5 style="margin:5px 0;">ПРОМОКОД</h5>
            <input id="p-code" placeholder="Введите код...">
            <button onclick="useP()" style="background:#0ff; border:none; padding:12px; border-radius:10px; width:90%; margin-top:5px; font-weight:bold; color:#000;">АКТИВИРОВАТЬ</button>
        </div>
    </div>
    
    <div id="p2" class="hidden">
        <div class="card">
            <h2>ТВОЯ СТАТИСТИКА</h2>
            <p id="stats_text" style="font-size:20px; color:#f0f;"></p>
        </div>
    </div>
    
    <div id="p3" class="hidden">
        <div class="card">
            <h3>ПОПОЛНЕНИЕ (TON)</h3>
            <p style="font-size:12px;">Отправь TON на этот кошелек:</p>
            <div style="font-size:12px; border:1px dashed #0ff; background:rgba(0,255,255,0.1); padding:15px; word-break:break-all; border-radius:10px;" onclick="cp('${WALLET}')">${WALLET}</div>
            <p style="color:orange; font-weight:bold;">ОБЯЗАТЕЛЬНО УКАЖИ КОММЕНТАРИЙ:</p>
            <div id="v-id" style="font-size:35px; color:#0ff; font-weight:bold; text-shadow:0 0 10px #0ff;">...</div>
        </div>
    </div>
    
    <div id="p4" class="hidden">
        <div class="card">
            <h3>ЗВУК И МУЗЫКА</h3>
            <button onclick="mT()" id="music-btn" style="width:90%; padding:15px; border-radius:12px; background:#222; color:#0ff; border:1px solid #0ff; font-weight:bold;">ВКЛЮЧИТЬ МУЗЫКУ</button>
        </div>
    </div>
    
    <div id="p5" class="hidden">
        <div class="card">
            <h3>РАССЫЛКА</h3>
            <textarea id="bc-msg" placeholder="Текст сообщения..."></textarea>
            <button onclick="adm('broadcast')" style="background:orange; color:#000; width:90%; padding:12px; border:none; border-radius:10px; font-weight:bold;">ОТПРАВИТЬ ВСЕМ</button>
        </div>
        <div class="card">
            <h3>СОЗДАТЬ ПРОМО</h3>
            <input id="n-p-c" placeholder="Код (например: VIP10)">
            <input type="number" id="n-p-s" placeholder="Сумма TON (например: 0.1)">
            <input type="number" id="n-p-l" placeholder="Количество активаций (например: 100)">
            <button onclick="adm('promo')" style="background:#0f0; color:#000; width:90%; padding:12px; border:none; border-radius:10px; font-weight:bold;">ДОБАВИТЬ ПРОМОКОД</button>
        </div>
    </div>

    <script>
        const tg = window.Telegram.WebApp; 
        const uid = tg.initDataUnsafe?.user?.id || "12345";
        
        // Фикс автозапуска аудио
        let audioInit = false;
        document.body.addEventListener('click', () => {
            if(!audioInit) {
                const m = document.getElementById('bgm');
                m.volume = 0.5;
                m.play().catch(()=>{});
                document.getElementById('music-btn').innerText = "ВЫКЛЮЧИТЬ МУЗЫКУ";
                audioInit = true;
            }
        }, {once: true});

        function sw(n) { 
            [1,2,3,4,5].forEach(i => { 
                if(document.getElementById('p'+i)) document.getElementById('p'+i).classList.toggle('hidden', i!==n); 
                if(document.getElementById('t'+i)) document.getElementById('t'+i).classList.toggle('active', i===n); 
            }); 
        }
        
        function cp(t) { navigator.clipboard.writeText(t); tg.showAlert("Адрес скопирован!"); }
        
        function mT() { 
            const m = document.getElementById('bgm'); 
            const btn = document.getElementById('music-btn');
            if(m.paused) { m.play(); btn.innerText = "ВЫКЛЮЧИТЬ МУЗЫКУ"; } 
            else { m.pause(); btn.innerText = "ВКЛЮЧИТЬ МУЗЫКУ"; }
        }
        
        async function sync() {
            const r = await fetch('/api/sync', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid})});
            const d = await r.json(); 
            document.getElementById('v-bal').innerText = d.balance.toFixed(2);
            document.getElementById('stats_text').innerText = "Спинов: " + d.spins + "\\nПобед: " + d.wins; 
            document.getElementById('v-id').innerText = uid;
            
            if(uid.toString() === "${ADMIN_ID}" && !document.getElementById('t5')) {
                const nt = document.createElement('div'); nt.className='tab'; nt.id='t5'; nt.innerText='🛡️ АДМИН'; nt.onclick=()=>sw(5);
                document.getElementById('main-nav').appendChild(nt);
            }
        }
        
        async function spin() {
            const btn = document.getElementById('spin-btn'); 
            btn.disabled = true;
            
            const res = await fetch('/api/spin', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, bet:document.getElementById('v-bet').value})});
            const d = await res.json(); 
            if(d.err) { tg.showAlert(d.err); btn.disabled = false; return; }
            
            // Плавная анимация
            const reels = ['r1','r2','r3'].map(id => document.getElementById(id));
            reels.forEach(r => r.classList.add('spinning'));
            
            let count = 0; 
            const interval = setInterval(() => {
                reels.forEach(r => r.innerText = ['🍒','7️⃣','💎','💰','⭐'][Math.floor(Math.random()*5)]);
                if(++count > 20) { 
                    clearInterval(interval); 
                    reels.forEach((r, i) => { 
                        r.classList.remove('spinning'); 
                        r.innerText = d.result[i]; 
                    });
                    sync(); 
                    btn.disabled = false; 
                    if(d.winAmount > 0) tg.showConfirm("🎉 ДЖЕКПОТ! ВЫИГРЫШ: " + d.winAmount + " TON!");
                }
            }, 80);
        }
        
        async function useP() {
            const r = await fetch('/api/promo', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, code: document.getElementById('p-code').value})});
            const d = await r.json(); 
            tg.showAlert(d.err || d.msg); 
            sync();
            document.getElementById('p-code').value = '';
        }
        
        async function adm(t) {
            const payload = {
                admin_id: uid, 
                type: t, 
                text: document.getElementById('bc-msg').value, 
                code: document.getElementById('n-p-c').value, 
                sum: document.getElementById('n-p-s').value, 
                limit: document.getElementById('n-p-l').value
            };
            const r = await fetch('/api/admin', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)});
            const data = await r.json();
            if(data.err) { tg.showAlert("Ошибка: " + data.err); } 
            else { tg.showAlert("✅ Успешно выполнено!"); }
        }
        
        sync(); 
        tg.expand();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, '0.0.0.0', () => console.log(">>> СЕРВЕР ЗАПУЩЕН И СТАБИЛЕН"));
