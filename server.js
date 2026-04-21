require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

// ==========================================
// ⚙️ ГЛОБАЛЬНЫЕ НАСТРОЙКИ И КОНФИГ
// ==========================================
const CONFIG = {
    ADMIN_ID: 8475323865,           // Твой Telegram ID
    WALLET: "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn", // Твой кошелек
    TON_KEY: "fe9429836fd2dfdb009421c6dc389840c9cdadca238477b4e2910250e11fa6d3", // TON API KEY
    
    // МАТЕМАТИКА ИГРЫ
    WIN_CHANCE: 0.12,               // 12% на выигрыш (3 в ряд)
    WIN_MULTIPLIER: 10,             // Во сколько раз умножаем ставку
    MIN_BET: 0.01,                  // Минималка
    MAX_BET: 5.0,                   // Максималка
    START_BALANCE: 0.10,            // Бонус при регистрации
    
    // ВИЗУАЛ
    SPIN_DURATION: 2500,            // Время вращения (мс)
    SYMBOL_HEIGHT: 110              // Высота одного символа в px
};

const MONGO_URI = process.env.MONGO_URI;
const BOT_TOKEN = process.env.BOT_TOKEN;
const APP_URL = process.env.APP_URL;

// ==========================================
// 🗄 БАЗА ДАННЫХ (MONGODB)
// ==========================================
mongoose.connect(MONGO_URI).then(() => console.log("✅ База данных заряжена"));

const User = mongoose.model('User', { 
    uid: String, 
    balance: { type: Number, default: CONFIG.START_BALANCE },
    spins: { type: Number, default: 0 }, 
    wins: { type: Number, default: 0 },
    last_lt: { type: String, default: "0" }, // Для сканера платежей
    used_promos: [String]
});

const Promo = mongoose.model('Promo', { 
    code: { type: String, uppercase: true }, 
    sum: Number, 
    limit: Number, 
    count: { type: Number, default: 0 } 
});

app.use(express.json());

// ==========================================
// 🤖 ТЕЛЕГРАМ БОТ (АДМИНКА + РАССЫЛКА)
// ==========================================
if (BOT_TOKEN) {
    const bot = new TelegramBot(BOT_TOKEN, { polling: true });

    // Команда старт
    bot.onText(/\/start/, async (msg) => {
        const uid = msg.from.id.toString();
        let user = await User.findOne({ uid });
        if (!user) await new User({ uid }).save();

        let keyboard = [[{ text: "🎰 ИГРАТЬ В КАЗИНО", web_app: { url: APP_URL } }]];
        if (msg.from.id === CONFIG.ADMIN_ID) {
            keyboard.push([{ text: "👑 АДМИН-МЕНЮ", callback_data: "admin_main" }]);
        }

        bot.sendMessage(msg.chat.id, `🎰 *TON CASINO* 🎰\n\nТвой ID: \`${uid}\`\nИспользуй его как комментарий при пополнении!`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    });

    // Обработка кнопок админки
    bot.on('callback_query', async (q) => {
        if (q.from.id !== CONFIG.ADMIN_ID) return;
        
        if (q.data === "admin_main") {
            const count = await User.countDocuments();
            bot.sendMessage(q.message.chat.id, `🛠 *АДМИНКА*\n\nВсего юзеров: ${count}`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "📢 СДЕЛАТЬ РАССЫЛКУ", callback_data: "broadcast" }],
                        [{ text: "🎁 СОЗДАТЬ ПРОМО", callback_data: "create_promo" }]
                    ]
                }
            });
        }

        if (q.data === "broadcast") {
            bot.sendMessage(q.message.chat.id, "Пришли текст рассылки:");
            bot.once('text', async (msg) => {
                const users = await User.find();
                let ok = 0;
                for (let u of users) {
                    try { await bot.sendMessage(u.uid, msg.text); ok++; } catch(e) {}
                }
                bot.sendMessage(msg.chat.id, `✅ Рассылка завершена! Получили: ${ok}`);
            });
        }
    });
}

// ==========================================
// 💸 СКАНЕР ПЛАТЕЖЕЙ TONCENTER
// ==========================================
setInterval(async () => {
    try {
        const url = `https://toncenter.com/api/v2/getTransactions?address=${CONFIG.WALLET}&limit=15&api_key=${CONFIG.TON_KEY}`;
        const response = await axios.get(url);
        if (response.data.ok) {
            for (let tx of response.data.result) {
                const comment = tx.in_msg?.message?.trim();
                const lt = tx.transaction_id.lt;
                const value = parseInt(tx.in_msg?.value || 0) / 1e9;

                if (!comment) continue;

                const user = await User.findOne({ uid: comment });
                if (user && BigInt(lt) > BigInt(user.last_lt)) {
                    user.balance += value;
                    user.last_lt = lt.toString();
                    await user.save();
                    console.log(`[DEPOSIT] +${value} TON for UID ${comment}`);
                }
            }
        }
    } catch (err) { /* Игнорим ошибки сети */ }
}, 25000);

// ==========================================
// 🛠 API ДЛЯ ВЕБ-ПРИЛОЖЕНИЯ
// ==========================================
app.post('/api/sync', async (req, res) => {
    const u = await User.findOne({ uid: req.body.uid?.toString() });
    res.json(u || { balance: 0, spins: 0, wins: 0 });
});

app.post('/api/spin', async (req, res) => {
    const { uid, bet } = req.body;
    const amount = parseFloat(bet);

    if (amount < CONFIG.MIN_BET || amount > CONFIG.MAX_BET) return res.json({ err: "Неверная ставка" });

    const u = await User.findOne({ uid: uid.toString() });
    if (!u || u.balance < amount) return res.json({ err: "Мало TON на балансе" });

    u.balance -= amount;
    const items = ['🍒','7️⃣','💎','💰','⭐'];
    let resArr;

    // Расчет шанса
    if (Math.random() < CONFIG.WIN_CHANCE) {
        const sym = items[Math.floor(Math.random() * items.length)];
        resArr = [sym, sym, sym];
    } else {
        resArr = [items[Math.floor(Math.random()*5)], items[Math.floor(Math.random()*5)], items[Math.floor(Math.random()*5)]];
        if (resArr[0] === resArr[1] && resArr[1] === resArr[2]) resArr[2] = '🍒';
    }

    const isWin = resArr[0] === resArr[1] && resArr[1] === resArr[2];
    const winSum = isWin ? amount * CONFIG.WIN_MULTIPLIER : 0;
    
    u.balance += winSum; u.spins++; if(isWin) u.wins++;
    await u.save();
    res.json({ result: resArr, winSum, balance: u.balance });
});

app.post('/api/promo', async (req, res) => {
    const { uid, code } = req.body;
    const p = await Promo.findOne({ code: code.toUpperCase() });
    const u = await User.findOne({ uid: uid.toString() });
    
    if (!p || p.count >= p.limit || u.used_promos.includes(p.code)) {
        return res.json({ err: "Код недействителен" });
    }

    u.balance += p.sum; 
    u.used_promos.push(p.code); 
    p.count++;
    await u.save(); await p.save();
    res.json({ msg: "Бонус зачислен!", balance: u.balance });
});

// ==========================================
// 🌐 ФРОНТЕНД (HTML/CSS/JS)
// ==========================================
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        :root { --neon: #0ff; --dark: #000; --card: #111; }
        body { margin:0; background:var(--dark); color:#fff; font-family:sans-serif; text-align:center; overflow:hidden; height:100vh; }
        
        /* Навигация */
        .nav { display:flex; background:rgba(0,0,0,0.9); border-bottom:1px solid #333; position:sticky; top:0; z-index:100; }
        .tab { flex:1; padding:15px; font-size:10px; font-weight:900; color:var(--neon); opacity:0.4; transition:0.3s; }
        .tab.active { opacity:1; border-bottom:3px solid var(--neon); }
        
        /* Страницы */
        .page { display:none; padding:20px; height:85vh; overflow-y:auto; box-sizing:border-box; }
        .page.active { display:block; }
        
        /* Компоненты */
        .card { background:var(--card); border:1px solid #222; border-radius:20px; padding:20px; margin-bottom:20px; box-shadow: 0 5px 15px rgba(0,0,0,0.5); }
        .bal-val { font-size:48px; font-weight:900; color:var(--neon); text-shadow: 0 0 10px var(--neon); }
        
        /* Слоты */
        .reel-cont { display:flex; justify-content:center; gap:10px; margin:25px 0; perspective: 1000px; }
        .reel { width:80px; height:110px; background:#050505; border:2px solid #333; border-radius:15px; overflow:hidden; position:relative; }
        .strip { width:100%; position:absolute; top:0; left:0; }
        .sym { height:110px; display:flex; align-items:center; justify-content:center; font-size:55px; }
        
        /* Кнопки и инпуты */
        .btn-main { width:100%; padding:18px; background:var(--neon); border:none; border-radius:15px; color:#000; font-weight:900; font-size:18px; transition:0.2s; cursor:pointer; }
        .btn-main:active { transform: scale(0.95); opacity:0.8; }
        input { width:90%; padding:12px; margin:10px 0; background:#111; border:1px solid #333; color:#fff; border-radius:10px; text-align:center; font-size:16px; }
        
        /* Ползунки */
        input[type=range] { width:100%; accent-color: var(--neon); margin-top:15px; }
    </style>
</head>
<body onclick="tryPlay()">
    <audio id="bgm" loop src="https://files.catbox.moe/78surr.mp3"></audio>
    
    <div class="nav">
        <div class="tab active" onclick="sh(1)" id="t1">🎰 ИГРА</div>
        <div class="tab" onclick="sh(2)" id="t2">📊 СТАТЫ</div>
        <div class="tab" onclick="sh(3)" id="t3">🏦 КАССА</div>
        <div class="tab" onclick="sh(4)" id="t4">⚙️ НАСТР.</div>
    </div>

    <div id="p1" class="page active">
        <div class="card"><div id="bal" class="bal-val">0.00</div><div style="font-size:10px; opacity:0.5;">TON COINS</div></div>
        <div class="reel-cont">
            <div class="reel"><div class="strip" id="s1"></div></div>
            <div class="reel"><div class="strip" id="s2"></div></div>
            <div class="reel"><div class="strip" id="s3"></div></div>
        </div>
        <div style="margin-bottom:15px;">
            <span style="font-size:12px; opacity:0.6;">СТАВКА:</span><br>
            <input type="number" id="betInput" value="${CONFIG.MIN_BET}" step="0.01">
        </div>
        <button class="btn-main" onclick="spin()" id="spinBtn">ИГРАТЬ</button>
        <div class="card" style="margin-top:20px;">
            <input id="p-in" placeholder="ПРОМОКОД">
            <button onclick="applyP()" style="background:none; border:1px solid var(--neon); color:var(--neon); padding:8px 20px; border-radius:10px;">ВВЕСТИ</button>
        </div>
    </div>

    <div id="p2" class="page">
        <div class="card">
            <h2>ТВОИ СТАТЫ</h2>
            <div style="display:flex; justify-content:space-around;">
                <div><h1 id="st-s">0</h1><p>Игр</p></div>
                <div><h1 id="st-w">0</h1><p>Побед</p></div>
            </div>
        </div>
    </div>

    <div id="p3" class="page">
        <div class="card">
            <h3>ПОПОЛНЕНИЕ</h3>
            <p style="font-size:12px; color:var(--neon);">${CONFIG.WALLET}</p>
            <p>ОБЯЗАТЕЛЬНО УКАЖИ ЭТОТ КОММЕНТАРИЙ:</p>
            <h1 id="u-id" style="background:#222; padding:10px; border-radius:10px;">...</h1>
            <p style="font-size:10px; opacity:0.5;">Деньги зачислятся автоматически в течение 1-2 минут</p>
        </div>
    </div>

    <div id="p4" class="page">
        <div class="card">
            <h3>ЗВУК И МУЗЫКА</h3>
            <button id="mBtn" class="btn-main" onclick="toggleM()" style="background:#222; color:#fff; border:1px solid var(--neon);">🔇 ВКЛЮЧИТЬ МУЗЫКУ</button>
            <div style="margin-top:25px; text-align:left;">
                <label>ГРОМКОСТЬ: <span id="vVal">50%</span></label>
                <input type="range" min="0" max="1" step="0.05" value="0.5" oninput="changeV(this.value)">
            </div>
        </div>
    </div>

    <script>
        const tg = window.Telegram.WebApp;
        const uid = tg.initDataUnsafe?.user?.id || "12345";
        const items = ['🍒','7️⃣','💎','💰','⭐'];
        const bgm = document.getElementById('bgm');
        bgm.volume = 0.5;

        function sh(n) {
            document.querySelectorAll('.page').forEach((p,i)=>p.classList.toggle('active', i+1===n));
            document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active', i+1===n));
            if(n===2 || n===3) sync();
        }

        function tryPlay() { if(bgm.paused && bgm.dataset.on === "1") bgm.play(); }

        function toggleM() {
            const b = document.getElementById('mBtn');
            if(bgm.paused) {
                bgm.play().catch(()=>{}); bgm.dataset.on = "1";
                b.innerText = "🔊 МУЗЫКА: ВКЛ"; b.style.background = "var(--neon)"; b.style.color = "#000";
            } else {
                bgm.pause(); bgm.dataset.on = "0";
                b.innerText = "🔇 МУЗЫКА: ВЫКЛ"; b.style.background = "#222"; b.style.color = "#fff";
            }
        }

        function changeV(v) {
            bgm.volume = v;
            document.getElementById('vVal').innerText = Math.round(v*100) + '%';
        }

        async function sync() {
            const r = await fetch('/api/sync', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid})});
            const d = await r.json();
            document.getElementById('bal').innerText = d.balance.toFixed(2);
            document.getElementById('u-id').innerText = uid;
            document.getElementById('st-s').innerText = d.spins || 0;
            document.getElementById('st-w').innerText = d.wins || 0;
        }

        function build() {
            [1,2,3].forEach(i=>{
                const s = document.getElementById('s'+i);
                s.innerHTML = '';
                for(let j=0; j<41; j++) s.innerHTML += '<div class="sym">'+items[Math.floor(Math.random()*5)]+'</div>';
            });
        }

        async function spin() {
            const bet = document.getElementById('betInput').value;
            const r = await fetch('/api/spin', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, bet})});
            const d = await r.json();
            if(d.err) return tg.showAlert(d.err);

            document.getElementById('spinBtn').disabled = true;
            tg.HapticFeedback.impactOccurred('heavy');

            [1,2,3].forEach(i=>{
                const s = document.getElementById('s'+i);
                s.lastElementChild.innerText = d.result[i-1];
                s.style.transition = 'none';
                s.style.transform = 'translateY(0)';
                setTimeout(() => {
                    s.style.transition = 'transform '+(2 + i*0.5)+'s cubic-bezier(0.1, 0.9, 0.1, 1)';
                    s.style.transform = 'translateY(-4400px)';
                }, 50);
            });

            setTimeout(()=>{
                sync();
                document.getElementById('spinBtn').disabled = false;
                if(d.winSum > 0) tg.showAlert("🎉 ВЫИГРЫШ: " + d.winSum + " TON!");
            }, 4000);
        }

        async function applyP() {
            const code = document.getElementById('p-in').value;
            const r = await fetch('/api/promo', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, code})});
            const d = await r.json();
            tg.showAlert(d.err || d.msg);
            sync();
        }

        build(); sync(); tg.expand();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log(`🚀 СЕРВЕР ЗАПУЩЕН НА ПОРТУ ${PORT}`));
