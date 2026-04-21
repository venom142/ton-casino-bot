require('dotenv').config();
const express = require('express'), TelegramBot = require('node-telegram-bot-api'), mongoose = require('mongoose'), axios = require('axios');
const app = express(), PORT = process.env.PORT || 10000;

// --- КОНФИГ ---
const CONFIG = {
    ADMIN_ID: 8475323865, 
    WALLET: "UQDoTj0hCwJbI-9fziRCyUZzO2XHmtcDzuiAiGjxG21G3dIX",
    TON_KEY: "fe9429836fd2dfdb009421c6dc389840c9cdadca238477b4e2910250e11fa6d3",
    START_BALANCE: 0.10,
    BG_IMAGE: "https://files.catbox.moe/ep8e91.png"
};

let GAME_SETTINGS = {
    winChance: 0.12, 
    winMultiplier: 10,
    minBet: 0.01,
    bgmUrl: "https://files.catbox.moe/ef3c37.mp3"
};

// --- БД ---
mongoose.connect(process.env.MONGO_URI).then(() => console.log("✅ DB Connected"));

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
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// --- ЛОГИКА БОТА И АДМИНКИ ---
bot.onText(/\/start/, async (msg) => {
    const uid = msg.from.id.toString();
    await User.findOneAndUpdate({ uid }, { uid }, { upsert: true });
    const kb = [[{ text: "🎰 ИГРАТЬ", web_app: { url: process.env.APP_URL } }]];
    if (msg.from.id === CONFIG.ADMIN_ID) kb.push([{ text: "🛠 АДМИНКА", callback_data: "adm_main" }]);
    bot.sendMessage(msg.chat.id, `🎰 *TON CASINO*\n\nТвой ID: \`${uid}\``, { 
        parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } 
    });
});

bot.on('callback_query', async (q) => {
    if (q.from.id !== CONFIG.ADMIN_ID) return;
    const cid = q.message.chat.id;
    if (q.data === "adm_main") {
        bot.sendMessage(cid, "🛠 *МЕНЮ АДМИНА*", {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: "📢 РАССЫЛКА", callback_data: "adm_mail" }, { text: "🎁 ПРОМО", callback_data: "adm_promo" }],
                [{ text: "📊 СТАТЫ", callback_data: "adm_stats" }, { text: "💰 БАЛАНС", callback_data: "adm_balance" }]
            ]}
        });
    }
    if (q.data === "adm_mail") { adminSession[q.from.id] = { step: 'mail' }; bot.sendMessage(cid, "Введите текст рассылки:"); }
    if (q.data === "adm_promo") { adminSession[q.from.id] = { step: 'p_code' }; bot.sendMessage(cid, "Код промо:"); }
    if (q.data === "adm_balance") { adminSession[q.from.id] = { step: 'b_uid' }; bot.sendMessage(cid, "ID юзера:"); }
    if (q.data === "adm_stats") {
        const count = await User.countDocuments();
        bot.sendMessage(cid, `📊 Всего игроков: ${count}`);
    }
});

bot.on('message', async (msg) => {
    const s = adminSession[msg.from.id]; if (!s || msg.text?.startsWith('/')) return;
    if (s.step === 'mail') {
        const users = await User.find();
        for (let u of users) { bot.sendMessage(u.uid, msg.text).catch(()=>{}); }
        bot.sendMessage(msg.chat.id, "✅ Готово"); delete adminSession[msg.from.id];
    } else if (s.step === 'p_code') {
        s.code = msg.text.toUpperCase(); s.step = 'p_sum'; bot.sendMessage(msg.chat.id, "Сумма:");
    } else if (s.step === 'p_sum') {
        s.sum = parseFloat(msg.text); s.step = 'p_lim'; bot.sendMessage(msg.chat.id, "Лимит активаций:");
    } else if (s.step === 'p_lim') {
        await new Promo({ code: s.code, sum: s.sum, limit: parseInt(msg.text) }).save();
        bot.sendMessage(msg.chat.id, "✅ Промо создан"); delete adminSession[msg.from.id];
    } else if (s.step === 'b_uid') {
        s.target = msg.text; s.step = 'b_val'; bot.sendMessage(msg.chat.id, "Сумма (напр. 10 или -10):");
    } else if (s.step === 'b_val') {
        const u = await User.findOne({ uid: s.target });
        if (u) { u.balance += parseFloat(msg.text); await u.save(); bot.sendMessage(msg.chat.id, "✅ Баланс изменен"); }
        delete adminSession[msg.from.id];
    }
});

// --- СКАНЕР ДОНАТОВ С УВЕДОМЛЕНИЕМ ---
setInterval(async () => {
    try {
        const r = await axios.get(`https://toncenter.com/api/v2/getTransactions?address=${CONFIG.WALLET}&limit=15&api_key=${CONFIG.TON_KEY}`);
        if (r.data.ok) {
            for (let tx of r.data.result) {
                const comment = tx.in_msg?.message?.trim();
                const lt = tx.transaction_id.lt;
                const val = parseInt(tx.in_msg?.value || 0) / 1e9;
                if (!comment || isNaN(comment)) continue;
                const u = await User.findOne({ uid: comment });
                if (u && BigInt(lt) > BigInt(u.last_lt || "0")) { 
                    u.balance = parseFloat((u.balance + val).toFixed(2));
                    u.last_lt = lt.toString();
                    await u.save();
                    // СМС юзеру
                    bot.sendMessage(u.uid, `✅ *Баланс пополнен!*\nЗачислено: *${val} TON*`).catch(()=>{});
                    // СМС админу
                    bot.sendMessage(CONFIG.ADMIN_ID, `💰 Донат: *${val} TON* от \`${u.uid}\``).catch(()=>{});
                }
            }
        }
    } catch (e) {}
}, 25000);

// --- API ---
app.post('/api/sync', async (req, res) => {
    const u = await User.findOne({ uid: req.body.uid?.toString() });
    res.json(u || { balance: 0, spins: 0, wins: 0 });
});

app.post('/api/spin', async (req, res) => {
    const { uid, bet } = req.body; const b = parseFloat(bet);
    const u = await User.findOne({ uid: uid.toString() });
    if (!u || u.balance < b || b < GAME_SETTINGS.minBet) return res.json({ err: "Мало TON" });
    u.balance -= b;
    const items = ['🍒','🔔','💎','7️⃣','🍋'];
    let resArr = [items[Math.floor(Math.random()*5)], items[Math.floor(Math.random()*5)], items[Math.floor(Math.random()*5)]];
    if (Math.random() < GAME_SETTINGS.winChance) resArr = ['7️⃣','7️⃣','7️⃣'];
    const isWin = resArr[0] === resArr[1] && resArr[1] === resArr[2];
    const winSum = isWin ? b * GAME_SETTINGS.winMultiplier : 0;
    u.balance += winSum; u.spins++; if(isWin) u.wins++; await u.save();
    res.json({ result: resArr, winSum, balance: u.balance });
});

app.post('/api/promo', async (req, res) => {
    const { uid, code } = req.body;
    const p = await Promo.findOne({ code: code.toUpperCase() });
    const u = await User.findOne({ uid: uid.toString() });
    if (!p || p.count >= p.limit || u.used_promos.includes(p.code)) return res.json({ err: "Ошибка" });
    u.balance += p.sum; u.used_promos.push(p.code); p.count++; await u.save(); await p.save();
    res.json({ msg: "OK", balance: u.balance });
});

// --- ВЕРСТКА ---
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><script src="https://telegram.org/js/telegram-web-app.js"></script><style>
    body { margin:0; font-family:sans-serif; text-align:center; color:#fff; background:#000 url('${CONFIG.BG_IMAGE}') no-repeat center fixed; background-size:cover; overflow:hidden; }
    body::before { content:""; position:absolute; inset:0; background:rgba(0,0,0,0.6); z-index:-1; }
    .nav { display:flex; background:rgba(0,0,0,0.8); border-bottom:2px solid #ff00ff; }
    .tab { flex:1; padding:15px; font-weight:bold; font-size:12px; cursor:pointer; opacity:0.5; }
    .tab.active { opacity:1; color:#00ffff; border-bottom:2px solid #00ffff; }
    .page { display:none; padding:20px; height:85vh; overflow-y:auto; box-sizing:border-box; }
    .page.active { display:block; }
    .card { background:rgba(255,255,255,0.1); border:1px solid #00ffff; padding:15px; margin-bottom:15px; border-radius:15px; backdrop-filter:blur(5px); }
    .bal-val { font-size:35px; color:#ffff00; font-weight:bold; }
    .copy-box { background:#000; border:1px dashed #00ffff; padding:10px; margin:10px 0; font-size:11px; color:#00ffff; cursor:pointer; border-radius:10px; word-break:break-all; }
    .reel-cont { display:flex; justify-content:center; gap:8px; margin:20px 0; }
    .reel { width:80px; height:100px; background:#000; border:2px solid #fff; overflow:hidden; position:relative; border-radius:10px; }
    .strip { width:100%; position:absolute; top:0; left:0; }
    .sym { height:100px; display:flex; align-items:center; justify-content:center; font-size:50px; }
    .btn-main { width:100%; padding:18px; background:#ffff00; color:#000; border:none; font-size:20px; font-weight:bold; border-radius:15px; cursor:pointer; }
    input { width:90%; padding:12px; margin:10px 0; background:#000; border:1px solid #fff; color:#fff; text-align:center; border-radius:10px; }
</style></head>
<body>
    <audio id="bgm" loop src="${GAME_SETTINGS.bgmUrl}"></audio>
    <div class="nav">
        <div class="tab active" onclick="sh(1)">ИГРА</div>
        <div class="tab" onclick="sh(2)">СТАТЫ</div>
        <div class="tab" onclick="sh(3)">КАССА</div>
        <div class="tab" onclick="sh(4)">⚙️</div>
    </div>
    <div id="p1" class="page active">
        <div class="card"><div>БАЛАНС</div><div id="bal" class="bal-val">0.00</div></div>
        <div class="reel-cont"><div class="reel"><div class="strip" id="s1"></div></div><div class="reel"><div class="strip" id="s2"></div></div><div class="reel"><div class="strip" id="s3"></div></div></div>
        <input type="number" id="bet" value="0.1" step="0.1"><button class="btn-main" onclick="spin()" id="sBtn">ИГРАТЬ</button>
        <div class="card" style="margin-top:20px"><input id="p-in" placeholder="ПРОМОКОД"><br><button onclick="applyP()" style="color:#00ffff; background:none; border:none; font-weight:bold; cursor:pointer; margin-top:5px;">ОК</button></div>
    </div>
    <div id="p2" class="page"><div class="card"><h3>СТАТИСТИКА</h3><p>Спинов: <span id="st-s">0</span></p><p>Побед: <span id="st-w">0</span></p></div></div>
    <div id="p3" class="page">
        <div class="card"><h3>ПОПОЛНЕНИЕ</h3><div class="copy-box" onclick="copyText('${CONFIG.WALLET}')">${CONFIG.WALLET}</div>
        <p>КОММЕНТАРИЙ (ID):</p><div class="copy-box" style="font-size:22px" id="u-id-box" onclick="copyText(window.uid)">...</div></div>
    </div>
    <div id="p4" class="page"><div class="card"><button onclick="toggleM()" id="mBtn" style="width:100%; padding:15px; background:#222; color:#fff; border-radius:10px;">🔇 МУЗЫКА</button></div></div>
    <script>
        const tg = window.Telegram.WebApp; window.uid = tg.initDataUnsafe?.user?.id?.toString() || "12345";
        const items = ['🍒','🔔','💎','7️⃣','🍋']; const bgm = document.getElementById('bgm');
        function copyText(t){const e=document.createElement('textarea');e.value=t;document.body.appendChild(e);e.select();document.execCommand('copy');document.body.removeChild(e);tg.showAlert("Скопировано!");}
        function toggleM(){ if(bgm.paused){bgm.play().catch(()=>{}); document.getElementById('mBtn').innerText='🔊 ВКЛ';} else {bgm.pause(); document.getElementById('mBtn').innerText='🔇 ВЫКЛ';}}
        function sh(n){document.querySelectorAll('.page').forEach((p,i)=>p.classList.toggle('active',i+1===n));document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active',i+1===n));sync();}
        async function sync(){ const r=await fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid:window.uid})}); const d=await r.json(); document.getElementById('bal').innerText=d.balance.toFixed(2); document.getElementById('u-id-box').innerText=window.uid; document.getElementById('st-s').innerText=d.spins; document.getElementById('st-w').innerText=d.wins; }
        function build(){[1,2,3].forEach(i=>{const s=document.getElementById('s'+i);s.innerHTML='';for(let j=0;j<41;j++)s.innerHTML+='<div class="sym">'+items[Math.floor(Math.random()*5)]+'</div>';});}
        async function spin(){
            const b=parseFloat(document.getElementById('bet').value); const r=await fetch('/api/spin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid:window.uid,bet:b})}); const d=await r.json(); if(d.err)return tg.showAlert(d.err);
            document.getElementById('sBtn').disabled=true; tg.HapticFeedback.impactOccurred('medium');
            [1,2,3].forEach(i=>{const s=document.getElementById('s'+i);s.lastElementChild.innerText=d.result[i-1];s.style.transition='none';s.style.transform='translateY(0)';setTimeout(()=>{s.style.transition='transform '+(2+i*0.5)+'s cubic-bezier(0.1,0.9,0.1,1)';s.style.transform='translateY(-4000px)';},50);});
            setTimeout(()=>{sync();document.getElementById('sBtn').disabled=false;if(d.winSum>0)tg.showAlert("WIN! +"+d.winSum.toFixed(2));},4000);
        }
        async function applyP(){ const code=document.getElementById('p-in').value; const r=await fetch('/api/promo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid:window.uid,code})}); const d=await r.json(); tg.showAlert(d.err||"OK"); sync(); }
        build(); sync(); tg.expand();
    </script>
</body></html>`);
});
app.listen(PORT,()=>console.log("🚀 SERVER READY"));
