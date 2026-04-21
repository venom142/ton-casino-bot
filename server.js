require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

// ==========================================
// ⚙️ НАСТРОЙКИ (Game & Stats)
// ==========================================
const CONFIG = {
    ADMIN_ID: 8475323865, 
    WALLET: "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn",
    TON_KEY: "fe9429836fd2dfdb009421c6dc389840c9cdadca238477b4e2910250e11fa6d3",
    WIN_CHANCE: 0.12,         // 12% на 3 в ряд
    WIN_MULTIPLIER: 10,       // В 10 раз ставка
    MIN_BET: 0.01,
    MAX_BET: 5.0,
    START_BALANCE: 0.10,
    BG_IMAGE: "https://r4.wallpaperflare.com/wallpaper/478/489/414/nature-wallpaper-478a834f37803650209995be9895015f.jpg" // Твоя ретро-картинка
};

const MONGO_URI = process.env.MONGO_URI;
const BOT_TOKEN = process.env.BOT_TOKEN;
const APP_URL = process.env.APP_URL;

// ==========================================
// 🗄 БАЗА ДАННЫХ (Retro Models)
// ==========================================
mongoose.connect(MONGO_URI).then(() => console.log("✅ РЕТРО-БАЗА ПОДКЛЮЧЕНА"));

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
    sum: Number, limit: Number, count: { type: Number, default: 0 } 
});

app.use(express.json());
const adminSession = {};

// ==========================================
// 🤖 ТЕЛЕГРАМ БОТ (Retro Control)
// ==========================================
if (BOT_TOKEN) {
    const bot = new TelegramBot(BOT_TOKEN, { polling: true });

    bot.onText(/\/start/, async (msg) => {
        const uid = msg.from.id.toString();
        await User.findOneAndUpdate({ uid }, { uid }, { upsert: true });
        const kb = [[{ text: "🕹 ИГРАТЬ", web_app: { url: APP_URL } }]];
        if (msg.from.id === CONFIG.ADMIN_ID) kb.push([{ text: "🛠 АДМИНКА", callback_data: "adm_main" }]);
        bot.sendMessage(msg.chat.id, `👾 *RETRO TON CASINO*\n\nТвой ID для пополнения: \`${uid}\``, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: kb }
        });
    });

    bot.on('callback_query', async (q) => {
        if (q.from.id !== CONFIG.ADMIN_ID) return;
        if (q.data === "adm_main") {
            bot.sendMessage(q.message.chat.id, "🛠 *МЕНЮ*", {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: "📢 РАССЫЛКА", callback_data: "adm_mail" }], [{ text: "🎁 ПРОМО", callback_data: "adm_promo" }]] }
            });
        }
        if (q.data === "adm_mail") { adminSession[q.from.id] = { step: 'mail' }; bot.sendMessage(q.message.chat.id, "Введите текст:"); }
        if (q.data === "adm_promo") { adminSession[q.from.id] = { step: 'p_code' }; bot.sendMessage(q.message.chat.id, "Название кода:"); }
    });

    bot.on('message', async (msg) => {
        const sess = adminSession[msg.from.id];
        if (!sess || msg.text?.startsWith('/')) return;
        if (sess.step === 'mail') {
            delete adminSession[msg.from.id];
            const users = await User.find();
            for (let u of users) { try { await bot.sendMessage(u.uid, msg.text); } catch(e) {} }
            bot.sendMessage(msg.chat.id, "✅ Рассылка готова");
        }
        if (sess.step === 'p_code') { sess.code = msg.text.toUpperCase(); sess.step = 'p_sum'; bot.sendMessage(msg.chat.id, "Сумма (TON):"); }
        else if (sess.step === 'p_sum') { sess.sum = parseFloat(msg.text); sess.step = 'p_lim'; bot.sendMessage(msg.chat.id, "Лимит:"); }
        else if (sess.step === 'p_lim') {
            try { await new Promo({ code: sess.code, sum: sess.sum, limit: parseInt(msg.text) }).save(); bot.sendMessage(msg.chat.id, "✅ Промо создан"); } catch(e) { bot.sendMessage(msg.chat.id, "❌ Ошибка"); }
            delete adminSession[msg.from.id];
        }
    });
}

// ==========================================
// 💸 СКАНЕР ОПЛАТ (Automated Dep)
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
    const u = await User.findOne({ uid: uid.toString() });
    if (!u || u.balance < b) return res.json({ err: "МАЛО TON" });
    
    u.balance -= b;
    const items = ['🍒','🔔','💎','7️⃣','🍋'];
    let resArr = [items[Math.floor(Math.random()*5)], items[Math.floor(Math.random()*5)], items[Math.floor(Math.random()*5)]];
    if (Math.random() < CONFIG.WIN_CHANCE) resArr = ['7️⃣','7️⃣','7️⃣']; // 12% на супер-вин
    
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
    if (!p || p.count >= p.limit || u.used_promos.includes(p.code)) return res.json({ err: "ОШИБКА КОДА" });
    u.balance += p.sum; u.used_promos.push(p.code); p.count++;
    await u.save(); await p.save();
    res.json({ msg: "БОНУС +", balance: u.balance });
});

// ==========================================
// 🌐 ФРОНТЕНД (Retro Synthwave Style)
// ==========================================
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html><html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
    /* Подключаем пиксельный шрифт */
    @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
    
    :root { --neon: #ff00ff; --cyan: #00ffff; --yellow: #ffff00; }
    
    body { 
        margin:0; padding:0; font-family: 'Press Start 2P', cursive; text-align:center; overflow:hidden; height:100vh;
        color:#fff;
        /* ФОН: Твоя ретро-картинка */
        background: url('${CONFIG.BG_IMAGE}') no-repeat center center fixed;
        background-size: cover;
    }
    
    /* Навигация */
    .nav { display:flex; background:rgba(0,0,0,0.9); border-bottom:4px solid var(--neon); position:relative; z-index:100; }
    .tab { flex:1; padding:15px; font-size:8px; opacity:0.6; cursor:pointer; color:#fff; }
    .tab.active { opacity:1; color:var(--cyan); text-shadow: 0 0 10px var(--cyan); }
    
    /* Страницы */
    .page { display:none; padding:15px; height:85vh; overflow-y:auto; box-sizing:border-box; position:relative; z-index:5; }
    .page.active { display:block; }
    
    /* Компоненты */
    .card { background:rgba(0,0,0,0.8); border:4px solid var(--neon); border-radius:0; padding:15px; margin-bottom:15px; box-shadow: 5px 5px 0px var(--cyan); }
    .bal-val { font-size:22px; color:var(--yellow); margin:10px 0; font-weight:900; }
    
    /* Фикс кошелька */
    .wallet-box { font-size:10px; color:var(--cyan); word-break: break-all; background:#000; padding:10px; border:2px solid #333; margin:10px 0; }

    /* Слоты */
    .reel-cont { display:flex; justify-content:center; gap:8px; margin:20px 0; }
    .reel { width:80px; height:100px; background:#111; border:3px solid #fff; overflow:hidden; position:relative; }
    .strip { width:100%; position:absolute; top:0; left:0; }
    .sym { height:100px; display:flex; align-items:center; justify-content:center; font-size:50px; }
    
    /* Кнопки и инпуты */
    .btn-main { 
        width:100%; padding:18px; background:var(--yellow); color:#000; border:none; border-radius:0; 
        font-family: inherit; font-size:14px; font-weight:bold; box-shadow: 4px 4px 0px #b2b200; cursor:pointer; 
    }
    .btn-main:active { transform: translate(2px, 2px); box-shadow: 2px 2px 0px #b2b200; }
    
    input { width:85%; padding:12px; margin:10px 0; background:#000; border:2px solid #fff; color:#fff; font-family: inherit; font-size:12px; text-align:center; }
</style></head>
<body>
    <audio id="bgm" loop src="https://files.catbox.moe/78surr.mp3"></audio>
    
    <div class="nav">
        <div class="tab active" onclick="sh(1)" id="t1">ИГРА</div>
        <div class="tab" onclick="sh(2)" id="t2">СТАТЫ</div>
        <div class="tab" onclick="sh(3)" id="t3">КАССА</div>
        <div class="tab" onclick="sh(4)" id="t4">⚙️</div>
    </div>

    <div id="p1" class="page active">
        <div class="card"><div style="font-size:10px;">CREDITS</div><div id="bal" class="bal-val">0.00</div></div>
        <div class="reel-cont">
            <div class="reel"><div class="strip" id="s1"></div></div>
            <div class="reel"><div class="strip" id="s2"></div></div>
            <div class="reel"><div class="strip" id="s3"></div></div>
        </div>
        <input type="number" id="bet" value="0.01" step="0.01">
        <button class="btn-main" onclick="spin()" id="sBtn">INSERT COIN</button>
        <div class="card" style="margin-top:20px;"><input id="p-in" placeholder="PROMO"><br><button onclick="applyP()" style="color:var(--cyan); background:none; border:none; font-family:inherit; font-size:10px; cursor:pointer;">[АКТИВИРОВАТЬ]</button></div>
    </div>

    <div id="p2" class="page">
        <div class="card">
            <h3>RECORDs</h3>
            <p style="font-size:12px;">Игр: <span id="st-s">0</span></p>
            <p style="font-size:12px;">Побед: <span id="st-w">0</span></p>
        </div>
    </div>

    <div id="p3" class="page">
        <div class="card">
            <h3>ПОПОЛНЕНИЕ</h3>
            <div class="wallet-box">${CONFIG.WALLET}</div>
            <p style="font-size:12px; margin-top:15px;">ВАШ ID В КОММЕНТАРИЙ:</p>
            <h1 id="u-id" style="background:#222; padding:15px; border-radius:0; border:2px solid var(--cyan); color:var(--yellow); font-size:18px;">...</h1>
        </div>
    </div>

    <div id="p4" class="page">
        <div class="card">
            <h3>AUDIO</h3>
            <button onclick="toggleM()" id="mBtn" style="width:100%; padding:15px; border-radius:0; background:#222; color:#fff; border:2px solid var(--neon);">🔇 MUSIC: OFF</button>
            <div style="margin-top:25px; text-align:left;">
                <label style="font-size:11px;">ГРОМКОСТЬ: <span id="vV">50%</span></label>
                <input type="range" min="0" max="1" step="0.1" value="0.5" oninput="bgm.volume=this.value; document.getElementById('vV').innerText=Math.round(this.value*100)+'%'" style="width:100%; accent-color:var(--neon);">
            </div>
        </div>
    </div>

    <script>
        const tg = window.Telegram.WebApp; const uid = tg.initDataUnsafe?.user?.id || "12345";
        const items = ['🍒','🔔','💎','7️⃣','🍋']; const bgm = document.getElementById('bgm');
        
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
            
            document.getElementById('sBtn').disabled = true; tg.HapticFeedback.impactOccurred('medium');
            [1,2,3].forEach(i=>{
                const s = document.getElementById('s'+i); s.lastElementChild.innerText = d.result[i-1];
                s.style.transition = 'none'; s.style.transform = 'translateY(0)';
                setTimeout(() => { s.style.transition = 'transform '+(2 + i*0.5)+'s cubic-bezier(0.1, 0.9, 0.1, 1)'; s.style.transform = 'translateY(-4000px)'; }, 50);
            });
            setTimeout(()=>{ sync(); document.getElementById('sBtn').disabled = false; if(d.winSum>0) tg.showAlert("WINNER! +"+d.winSum); }, 4000);
        }

        async function applyP(){ const code = document.getElementById('p-in').value; const r = await fetch('/api/promo', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, code})}); const d = await r.json(); tg.showAlert(d.err || d.msg); sync(); }

        build(); sync(); tg.expand();
    </script>
</body></html>
    `);
});

app.listen(PORT, () => console.log("🚀 ENGINE READY (Retro Edition)"));
