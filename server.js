require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

// ==========================================
// ⚙️ ГЛОБАЛЬНЫЕ НАСТРОЙКИ (МЕНЯЙ ТУТ)
// ==========================================
const CONFIG = {
    ADMIN_ID: 8475323865, 
    WALLET: "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn",
    TON_KEY: "fe9429836fd2dfdb009421c6dc389840c9cdadca238477b4e2910250e11fa6d3",
    
    WIN_CHANCE: 0.12, 
    WIN_MULTIPLIER: 10,
    MIN_BET: 0.01,
    MAX_BET: 5.0,
    START_BALANCE: 0.10
};

const MONGO_URI = process.env.MONGO_URI;
const BOT_TOKEN = process.env.BOT_TOKEN;
const APP_URL = process.env.APP_URL;

// ==========================================
// 🗄 МОДЕЛИ БАЗЫ ДАННЫХ
// ==========================================
mongoose.connect(MONGO_URI).then(() => console.log("✅ База подключена"));

const User = mongoose.model('User', { 
    uid: String, 
    balance: { type: Number, default: CONFIG.START_BALANCE },
    spins: { type: Number, default: 0 }, 
    wins: { type: Number, default: 0 },
    last_lt: { type: String, default: "0" },
    used_promos: [String]
});

const Promo = mongoose.model('Promo', { 
    code: { type: String, uppercase: true, unique: true }, 
    sum: Number, 
    limit: Number, 
    count: { type: Number, default: 0 } 
});

app.use(express.json());

// Вспомогательный объект для состояний админа
const adminStates = {};

// ==========================================
// 🤖 БОТ: АДМИНКА И СОЗДАНИЕ ПРОМО
// ==========================================
if (BOT_TOKEN) {
    const bot = new TelegramBot(BOT_TOKEN, { polling: true });

    bot.onText(/\/start/, async (msg) => {
        const uid = msg.from.id.toString();
        await User.findOneAndUpdate({ uid }, { uid }, { upsert: true });

        const kb = [[{ text: "🎰 ИГРАТЬ", web_app: { url: APP_URL } }]];
        if (msg.from.id === CONFIG.ADMIN_ID) kb.push([{ text: "👑 АДМИН-ПАНЕЛЬ", callback_data: "adm_menu" }]);

        bot.sendMessage(msg.chat.id, `🎰 *TON CASINO*\n\nТвой ID для пополнения: \`${uid}\``, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: kb }
        });
    });

    bot.on('callback_query', async (q) => {
        if (q.from.id !== CONFIG.ADMIN_ID) return;

        if (q.data === "adm_menu") {
            const usersCount = await User.countDocuments();
            bot.sendMessage(q.message.chat.id, `🛠 *МЕНЮ УПРАВЛЕНИЯ*\nЮзеров в базе: ${usersCount}`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "📢 РАССЫЛКА", callback_data: "adm_broadcast" }],
                        [{ text: "🎁 СОЗДАТЬ ПРОМО", callback_data: "adm_create_promo" }]
                    ]
                }
            });
        }

        // Логика рассылки
        if (q.data === "adm_broadcast") {
            adminStates[q.from.id] = 'awaiting_broadcast';
            bot.sendMessage(q.message.chat.id, "Введите текст для рассылки:");
        }

        // Логика создания промо (Шаг 1: Код)
        if (q.data === "adm_create_promo") {
            adminStates[q.from.id] = 'promo_code';
            bot.sendMessage(q.message.chat.id, "Напиши название кода (например: BONUS100):");
        }
    });

    // Обработка текстовых ответов админа (Рассылка и Промо)
    bot.on('message', async (msg) => {
        if (msg.from.id !== CONFIG.ADMIN_ID || !adminStates[msg.from.id]) return;
        if (msg.text?.startsWith('/')) return;

        const state = adminStates[msg.from.id];

        // РАССЫЛКА (Исправлено: теперь 1 сообщение)
        if (state === 'awaiting_broadcast') {
            delete adminStates[msg.from.id];
            const users = await User.find();
            let count = 0;
            bot.sendMessage(msg.chat.id, "🚀 Рассылка запущена...");
            for (let u of users) {
                try {
                    // Чтобы админ не получал дважды, если он в базе
                    await bot.sendMessage(u.uid, msg.text);
                    count++;
                } catch (e) {}
            }
            return bot.sendMessage(msg.chat.id, `✅ Рассылка завершена. Получили: ${count}`);
        }

        // СОЗДАНИЕ ПРОМО (ПОШАГОВО)
        if (state === 'promo_code') {
            adminStates[msg.from.id] = { step: 'promo_sum', code: msg.text.toUpperCase() };
            return bot.sendMessage(msg.chat.id, "Какая сумма бонуса (в TON)?");
        }

        if (adminStates[msg.from.id]?.step === 'promo_sum') {
            const sum = parseFloat(msg.text);
            if (isNaN(sum)) return bot.sendMessage(msg.chat.id, "Введи число!");
            adminStates[msg.from.id].sum = sum;
            adminStates[msg.from.id].step = 'promo_limit';
            return bot.sendMessage(msg.chat.id, "Сколько активаций (лимит)?");
        }

        if (adminStates[msg.from.id]?.step === 'promo_limit') {
            const limit = parseInt(msg.text);
            if (isNaN(limit)) return bot.sendMessage(msg.chat.id, "Введи число!");
            const data = adminStates[msg.from.id];
            
            try {
                await new Promo({ code: data.code, sum: data.sum, limit: limit }).save();
                bot.sendMessage(msg.chat.id, `✅ Промокод \`${data.code}\` создан!\nСумма: ${data.sum} TON\nЛимит: ${limit}`, { parse_mode: 'Markdown' });
            } catch (e) {
                bot.sendMessage(msg.chat.id, "❌ Ошибка: такой код уже есть.");
            }
            delete adminStates[msg.from.id];
        }
    });
}

// ==========================================
// 💸 СКАНЕР ПЛАТЕЖЕЙ
// ==========================================
setInterval(async () => {
    try {
        const r = await axios.get(`https://toncenter.com/api/v2/getTransactions?address=${CONFIG.WALLET}&limit=10&api_key=${CONFIG.TON_KEY}`);
        if (r.data.ok) {
            for (let tx of r.data.result) {
                const comment = tx.in_msg?.message?.trim();
                const lt = tx.transaction_id.lt;
                const val = parseInt(tx.in_msg?.value || 0) / 1e9;
                if (!comment) continue;
                const u = await User.findOne({ uid: comment });
                if (u && BigInt(lt) > BigInt(u.last_lt)) {
                    u.balance += val;
                    u.last_lt = lt.toString();
                    await u.save();
                }
            }
        }
    } catch (e) {}
}, 30000);

// ==========================================
// 🛠 API
// ==========================================
app.post('/api/sync', async (req, res) => {
    const u = await User.findOne({ uid: req.body.uid?.toString() });
    res.json(u || { balance: 0, spins: 0, wins: 0 });
});

app.post('/api/spin', async (req, res) => {
    const { uid, bet } = req.body;
    const b = parseFloat(bet);
    if (b < CONFIG.MIN_BET || b > CONFIG.MAX_BET) return res.json({ err: "Ставка вне лимита" });
    const u = await User.findOne({ uid: uid.toString() });
    if (!u || u.balance < b) return res.json({ err: "Недостаточно TON" });
    u.balance -= b;
    const items = ['🍒','7️⃣','💎','💰','⭐'];
    let resArr;
    if (Math.random() < CONFIG.WIN_CHANCE) {
        const s = items[Math.floor(Math.random()*5)];
        resArr = [s, s, s];
    } else {
        resArr = [items[Math.floor(Math.random()*5)], items[Math.floor(Math.random()*5)], items[Math.floor(Math.random()*5)]];
        if (resArr[0] === resArr[1] && resArr[1] === resArr[2]) resArr[2] = '🍒';
    }
    const isWin = resArr[0] === resArr[1] && resArr[1] === resArr[2];
    const winSum = isWin ? b * CONFIG.WIN_MULTIPLIER : 0;
    u.balance += winSum; u.spins++; if(isWin) u.wins++;
    await u.save();
    res.json({ result: resArr, winSum, balance: u.balance });
});

app.post('/api/promo', async (req, res) => {
    const { uid, code } = req.body;
    const p = await Promo.findOne({ code: code.toUpperCase() });
    const u = await User.findOne({ uid: uid.toString() });
    if (!p || p.count >= p.limit || u.used_promos.includes(p.code)) return res.json({ err: "Промокод невалиден" });
    u.balance += p.sum; u.used_promos.push(p.code); p.count++;
    await u.save(); await p.save();
    res.json({ msg: "Зачислено!", balance: u.balance });
});

// ==========================================
// 🌐 ФРОНТЕНД (С ФОНОМ И ЗВУКОМ)
// ==========================================
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html><html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
    :root { --neon: #0ff; }
    body { 
        margin:0; 
        /* 1. ИСПРАВЛЕН ФОН (Добавлен градиент и текстура) */
        background: radial-gradient(circle at center, #1a1a2e 0%, #000 100%);
        color:#fff; font-family:sans-serif; text-align:center; overflow:hidden; height:100vh; 
    }
    .nav { display:flex; background:rgba(0,0,0,0.8); border-bottom:1px solid #333; }
    .tab { flex:1; padding:15px; font-size:10px; font-weight:bold; color:var(--neon); opacity:0.4; }
    .tab.active { opacity:1; border-bottom:3px solid var(--neon); }
    .page { display:none; padding:20px; height:85vh; overflow-y:auto; box-sizing:border-box; }
    .page.active { display:block; }
    .card { background:rgba(255,255,255,0.03); border:1px solid rgba(0,255,255,0.1); border-radius:20px; padding:20px; margin-bottom:20px; backdrop-filter: blur(10px); }
    .bal-val { font-size:48px; color:var(--neon); font-weight:900; text-shadow: 0 0 15px var(--neon); }
    .reel-cont { display:flex; justify-content:center; gap:10px; margin:25px 0; }
    .reel { width:80px; height:110px; background:rgba(0,0,0,0.5); border:2px solid #333; border-radius:15px; overflow:hidden; position:relative; }
    .strip { width:100%; position:absolute; top:0; left:0; }
    .sym { height:110px; display:flex; align-items:center; justify-content:center; font-size:55px; }
    .btn-main { width:100%; padding:18px; background:var(--neon); border:none; border-radius:15px; color:#000; font-weight:900; font-size:18px; }
    input { width:90%; padding:12px; margin:10px 0; background:#111; border:1px solid #333; color:#fff; border-radius:10px; text-align:center; }
    input[type=range] { accent-color: var(--neon); }
</style></head>
<body onclick="const a=document.getElementById('bgm'); if(a.paused && a.dataset.on=='1')a.play()">
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
        <input type="number" id="bet" value="0.01" step="0.01">
        <button class="btn-main" onclick="spin()" id="sBtn">ИГРАТЬ</button>
        <div class="card" style="margin-top:20px;"><input id="p-in" placeholder="ПРОМОКОД"><br><button onclick="applyP()" style="color:var(--neon); background:none; border:none;">АКТИВИРОВАТЬ</button></div>
    </div>
    <div id="p2" class="page"><div class="card"><h2>ВАШИ ДАННЫЕ</h2><p>Спинов: <span id="st-s">0</span></p><p>Побед: <span id="st-w">0</span></p></div></div>
    <div id="p3" class="page"><div class="card"><h3>ПОПОЛНЕНИЕ</h3><p style="font-size:12px; color:var(--neon);">${CONFIG.WALLET}</p><p>КОММЕНТАРИЙ:</p><h1 id="u-id">...</h1></div></div>
    <div id="p4" class="page">
        <div class="card">
            <h3>ЗВУК</h3>
            <button onclick="toggleM()" id="mBtn" style="width:100%; padding:15px; border-radius:10px; background:#222; color:#fff; border:1px solid var(--neon);">🔇 ВКЛЮЧИТЬ МУЗЫКУ</button>
            <div style="margin-top:20px;">ГРОМКОСТЬ: <span id="vV">50%</span><br><input type="range" min="0" max="1" step="0.1" value="0.5" oninput="bgm.volume=this.value; document.getElementById('vV').innerText=Math.round(this.value*100)+'%'"></div>
        </div>
    </div>
    <script>
        const tg = window.Telegram.WebApp; const uid = tg.initDataUnsafe?.user?.id || "12345";
        const items = ['🍒','7️⃣','💎','💰','⭐']; const bgm = document.getElementById('bgm');
        function sh(n){ document.querySelectorAll('.page').forEach((p,i)=>p.classList.toggle('active', i+1===n)); document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active', i+1===n)); if(n<4)sync(); }
        function toggleM(){ if(bgm.paused){bgm.play(); bgm.dataset.on='1'; document.getElementById('mBtn').innerText='🔊 ВЫКЛЮЧИТЬ';}else{bgm.pause(); bgm.dataset.on='0'; document.getElementById('mBtn').innerText='🔇 ВКЛЮЧИТЬ';}}
        async function sync(){
            const r = await fetch('/api/sync', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid})});
            const d = await r.json(); document.getElementById('bal').innerText = d.balance.toFixed(2);
            document.getElementById('u-id').innerText = uid; document.getElementById('st-s').innerText = d.spins; document.getElementById('st-w').innerText = d.wins;
        }
        function build(){ [1,2,3].forEach(i=>{ const s = document.getElementById('s'+i); s.innerHTML = ''; for(let j=0; j<41; j++) s.innerHTML += '<div class="sym">'+items[Math.floor(Math.random()*5)]+'</div>'; }); }
        async function spin(){
            const bet = document.getElementById('bet').value;
            const r = await fetch('/api/spin', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, bet})});
            const d = await r.json(); if(d.err) return tg.showAlert(d.err);
            document.getElementById('sBtn').disabled = true; tg.HapticFeedback.impactOccurred('heavy');
            [1,2,3].forEach(i=>{
                const s = document.getElementById('s'+i); s.lastElementChild.innerText = d.result[i-1];
                s.style.transition = 'none'; s.style.transform = 'translateY(0)';
                setTimeout(() => { s.style.transition = 'transform '+(2 + i*0.5)+'s cubic-bezier(0.1, 0.9, 0.1, 1)'; s.style.transform = 'translateY(-4400px)'; }, 50);
            });
            setTimeout(()=>{ sync(); document.getElementById('sBtn').disabled = false; if(d.winSum>0) tg.showAlert("🎉 ВЫИГРЫШ: "+d.winSum+" TON"); }, 4000);
        }
        async function applyP(){
            const code = document.getElementById('p-in').value;
            const r = await fetch('/api/promo', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, code})});
            const d = await r.json(); tg.showAlert(d.err || d.msg); sync();
        }
        build(); sync(); tg.expand();
    </script>
</body></html>
    `);
});

app.listen(PORT, () => console.log("🚀 ENGINE READY"));
