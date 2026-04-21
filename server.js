require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

// ==========================================
// ⚙️ ГЛОБАЛЬНЫЙ КОНФИГ
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
// 🗄 БАЗА ДАННЫХ
// ==========================================
mongoose.connect(MONGO_URI).then(() => console.log("✅ DB CONNECTED"));

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

const adminSession = {}; // Для пошаговых действий админа

// ==========================================
// 🤖 ТЕЛЕГРАМ БОТ (УЛУЧШЕННЫЙ)
// ==========================================
if (BOT_TOKEN) {
    const bot = new TelegramBot(BOT_TOKEN, { polling: true });

    bot.onText(/\/start/, async (msg) => {
        const uid = msg.from.id.toString();
        await User.findOneAndUpdate({ uid }, { uid }, { upsert: true });

        const kb = [[{ text: "🎰 ИГРАТЬ", web_app: { url: APP_URL } }]];
        if (msg.from.id === CONFIG.ADMIN_ID) kb.push([{ text: "👑 АДМИН-МЕНЮ", callback_data: "adm_home" }]);

        bot.sendMessage(msg.chat.id, `🎰 *TON CASINO*\n\nВаш персональный ID: \`${uid}\``, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: kb }
        });
    });

    bot.on('callback_query', async (q) => {
        if (q.from.id !== CONFIG.ADMIN_ID) return;

        if (q.data === "adm_home") {
            bot.sendMessage(q.message.chat.id, "🛠 *УПРАВЛЕНИЕ КАЗИНО*", {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "📢 РАССЫЛКА", callback_data: "adm_mail" }],
                        [{ text: "🎁 СОЗДАТЬ ПРОМО", callback_data: "adm_p_new" }]
                    ]
                }
            });
        }

        if (q.data === "adm_mail") {
            adminSession[q.from.id] = { step: 'mail_text' };
            bot.sendMessage(q.message.chat.id, "Отправь текст для рассылки всем пользователям:");
        }

        if (q.data === "adm_p_new") {
            adminSession[q.from.id] = { step: 'p_code' };
            bot.sendMessage(q.message.chat.id, "Введите название промокода (одним словом):");
        }
    });

    bot.on('message', async (msg) => {
        const sess = adminSession[msg.from.id];
        if (!sess || msg.text?.startsWith('/')) return;

        // Рассылка
        if (sess.step === 'mail_text') {
            delete adminSession[msg.from.id];
            const users = await User.find();
            bot.sendMessage(msg.chat.id, `🚀 Начинаю рассылку на ${users.length} чел...`);
            let ok = 0;
            for (let u of users) {
                try { await bot.sendMessage(u.uid, msg.text); ok++; } catch(e) {}
            }
            return bot.sendMessage(msg.chat.id, `✅ Готово! Получили: ${ok}`);
        }

        // Логика промокодов
        if (sess.step === 'p_code') {
            sess.code = msg.text.toUpperCase();
            sess.step = 'p_sum';
            return bot.sendMessage(msg.chat.id, `Окей, код [${sess.code}].\nКакую сумму даем (TON)?`);
        }
        if (sess.step === 'p_sum') {
            sess.sum = parseFloat(msg.text);
            sess.step = 'p_lim';
            return bot.sendMessage(msg.chat.id, "Сколько активаций доступно?");
        }
        if (sess.step === 'p_lim') {
            const lim = parseInt(msg.text);
            try {
                await new Promo({ code: sess.code, sum: sess.sum, limit: lim }).save();
                bot.sendMessage(msg.chat.id, `✅ ПРОМО СОЗДАН!\nКод: ${sess.code}\nБонус: ${sess.sum} TON\nЛимит: ${lim}`);
            } catch(e) { bot.sendMessage(msg.chat.id, "❌ Ошибка: такой код уже есть."); }
            delete adminSession[msg.from.id];
        }
    });
}

// ==========================================
// 💸 СКАНЕР ТРАНЗАКЦИЙ
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
                    u.balance += val; u.last_lt = lt.toString();
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
    res.json({ msg: "Бонус зачислен!", balance: u.balance });
});

// ==========================================
// 🌐 ФРОНТЕНД (ФИКС ВЕРСТКИ И ФОНА)
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
        padding:0;
        /* ФОН: Градиент + сетка для эффекта глубины */
        background: radial-gradient(circle at center, #1a1a2e 0%, #000 100%);
        background-attachment: fixed;
        color:#fff; font-family:sans-serif; text-align:center; overflow:hidden; height:100vh; 
    }
    .nav { display:flex; background:rgba(0,0,0,0.85); border-bottom:1px solid #333; position:sticky; top:0; z-index:100; }
    .tab { flex:1; padding:15px; font-size:10px; font-weight:bold; color:var(--neon); opacity:0.4; }
    .tab.active { opacity:1; border-bottom:3px solid var(--neon); }
    
    .page { display:none; padding:20px; height:88vh; overflow-y:auto; box-sizing:border-box; }
    .page.active { display:block; }
    
    .card { background:rgba(255,255,255,0.05); border:1px solid rgba(0,255,255,0.1); border-radius:20px; padding:20px; margin-bottom:20px; backdrop-filter: blur(10px); }
    .bal-val { font-size:44px; color:var(--neon); font-weight:900; text-shadow: 0 0 15px var(--neon); }
    
    /* ФИКС КОШЕЛЬКА */
    .wallet-box { 
        font-size:12px; 
        color:var(--neon); 
        background:rgba(0,0,0,0.3); 
        padding:10px; 
        border-radius:10px; 
        word-break: break-all; /* Чтобы адрес не улетал за экран */
        line-height:1.4;
        border: 1px dashed #333;
    }

    .reel-cont { display:flex; justify-content:center; gap:8px; margin:20px 0; }
    .reel { width:80px; height:110px; background:rgba(0,0,0,0.6); border:2px solid #333; border-radius:15px; overflow:hidden; position:relative; }
    .strip { width:100%; position:absolute; top:0; left:0; }
    .sym { height:110px; display:flex; align-items:center; justify-content:center; font-size:50px; }
    
    .btn-main { width:100%; padding:18px; background:var(--neon); border:none; border-radius:15px; color:#000; font-weight:900; font-size:18px; box-shadow: 0 0 20px rgba(0,255,255,0.2); }
    input { width:90%; padding:12px; margin:10px 0; background:#111; border:1px solid #333; color:#fff; border-radius:10px; text-align:center; font-size:16px; }
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
        <div class="card"><div id="bal" class="bal-val">0.00</div><div style="font-size:10px; opacity:0.6;">TON BALANCE</div></div>
        <div class="reel-cont">
            <div class="reel"><div class="strip" id="s1"></div></div>
            <div class="reel"><div class="strip" id="s2"></div></div>
            <div class="reel"><div class="strip" id="s3"></div></div>
        </div>
        <input type="number" id="bet" value="0.01" step="0.01">
        <button class="btn-main" onclick="spin()" id="sBtn">SPIN</button>
        <div class="card" style="margin-top:20px;">
            <input id="p-in" placeholder="PROMOCODE">
            <button onclick="applyP()" style="color:var(--neon); background:none; border:none; font-weight:bold;">ACTIVATE</button>
        </div>
    </div>

    <div id="p2" class="page">
        <div class="card">
            <h2>MY STATS</h2>
            <p>Spins: <span id="st-s">0</span></p>
            <p>Wins: <span id="st-w">0</span></p>
        </div>
    </div>

    <div id="p3" class="page">
        <div class="card">
            <h3 style="margin-top:0;">DEPOSIT TON</h3>
            <div class="wallet-box">${CONFIG.WALLET}</div>
            <p style="margin:20px 0 10px 0; font-size:14px;">COMMENT (REQUIRED):</p>
            <h1 id="u-id" style="background:#222; padding:15px; border-radius:15px; margin:0; border:1px solid var(--neon);">...</h1>
            <p style="font-size:11px; opacity:0.5; margin-top:15px;">Send any amount of TON to the address above with your ID as a comment. Balance updates in 1-2 min.</p>
        </div>
    </div>

    <div id="p4" class="page">
        <div class="card">
            <h3>AUDIO</h3>
            <button onclick="toggleM()" id="mBtn" style="width:100%; padding:15px; border-radius:12px; background:#222; color:#fff; border:1px solid var(--neon);">🔇 MUSIC: OFF</button>
            <div style="margin-top:25px;">
                VOLUME: <span id="vV">50%</span><br>
                <input type="range" min="0" max="1" step="0.1" value="0.5" oninput="bgm.volume=this.value; document.getElementById('vV').innerText=Math.round(this.value*100)+'%'" style="width:100%; accent-color:var(--neon);">
            </div>
        </div>
    </div>

    <script>
        const tg = window.Telegram.WebApp; const uid = tg.initDataUnsafe?.user?.id || "12345";
        const items = ['🍒','7️⃣','💎','💰','⭐']; const bgm = document.getElementById('bgm');
        
        function sh(n){ 
            document.querySelectorAll('.page').forEach((p,i)=>p.classList.toggle('active', i+1===n)); 
            document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active', i+1===n)); 
            sync(); 
        }

        function toggleM(){ 
            if(bgm.paused){ bgm.play(); bgm.dataset.on='1'; document.getElementById('mBtn').innerText='🔊 MUSIC: ON'; }
            else { bgm.pause(); bgm.dataset.on='0'; document.getElementById('mBtn').innerText='🔇 MUSIC: OFF'; }
        }

        async function sync(){
            const r = await fetch('/api/sync', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid})});
            const d = await r.json(); 
            document.getElementById('bal').innerText = d.balance.toFixed(2);
            document.getElementById('u-id').innerText = uid; 
            document.getElementById('st-s').innerText = d.spins; 
            document.getElementById('st-w').innerText = d.wins;
        }

        function build(){ 
            [1,2,3].forEach(i=>{ 
                const s = document.getElementById('s'+i); s.innerHTML = ''; 
                for(let j=0; j<41; j++) s.innerHTML += '<div class="sym">'+items[Math.floor(Math.random()*5)]+'</div>'; 
            }); 
        }

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
            setTimeout(()=>{ sync(); document.getElementById('sBtn').disabled = false; if(d.winSum>0) tg.showAlert("🎉 WIN: "+d.winSum+" TON"); }, 4000);
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

app.listen(PORT, () => console.log("🚀 ENGINE ONLINE"));
