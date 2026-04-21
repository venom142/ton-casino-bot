require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

const CONFIG = {
    ADMIN_ID: 8475323865, 
    WALLET: "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn",
    TON_KEY: "fe9429836fd2dfdb009421c6dc389840c9cdadca238477b4e2910250e11fa6d3",
    WIN_CHANCE: 0.12, 
    WIN_MULTIPLIER: 10,
    START_BALANCE: 0.10,
    BG_IMAGE: "https://files.catbox.moe/ep8e91.png",
    BGM_URL: "https://files.catbox.moe/78surr.mp3",
    MIN_BET: 0.01
};

mongoose.connect(process.env.MONGO_URI).then(() => console.log("✅ База подключена"));

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

// БОТ И АДМИНКА
if (process.env.BOT_TOKEN) {
    const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
    bot.onText(/\/start/, async (msg) => {
        const uid = msg.from.id.toString();
        await User.findOneAndUpdate({ uid }, { uid }, { upsert: true });
        const kb = [[{ text: "🎰 ИГРАТЬ", web_app: { url: process.env.APP_URL } }]];
        if (msg.from.id === CONFIG.ADMIN_ID) kb.push([{ text: "🛠 АДМИНКА", callback_data: "adm_main" }]);
        bot.sendMessage(msg.chat.id, `🎰 *TON CASINO*\n\nID: \`${uid}\``, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
    });

    bot.on('callback_query', async (q) => {
        if (q.from.id !== CONFIG.ADMIN_ID) return;
        if (q.data === "adm_main") {
            bot.sendMessage(q.message.chat.id, "🛠 *МЕНЮ*", {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "📢 РАССЫЛКА", callback_data: "adm_mail" }],
                        [{ text: "🎁 ПРОМО", callback_data: "adm_promo" }],
                        [{ text: "📊 СТАТИСТИКА", callback_data: "adm_stats" }],
                        [{ text: "💰 ИЗМЕНИТЬ БАЛАНС", callback_data: "adm_balance" }]
                    ]
                }
            });
        }
        if (q.data === "adm_mail") { adminSession[q.from.id] = { step: 'mail' }; bot.sendMessage(q.message.chat.id, "Текст рассылки:"); }
        if (q.data === "adm_promo") { adminSession[q.from.id] = { step: 'p_code' }; bot.sendMessage(q.message.chat.id, "Код:"); }
        if (q.data === "adm_balance") { adminSession[q.from.id] = { step: 'b_uid' }; bot.sendMessage(q.message.chat.id, "ID пользователя:"); }
        if (q.data === "adm_stats") {
            const [usersCount, promoCount, top] = await Promise.all([
                User.countDocuments(),
                Promo.countDocuments(),
                User.find().sort({ balance: -1 }).limit(5).lean()
            ]);
            const topRows = top.length
                ? top.map((u, i) => `${i + 1}. \`${u.uid}\` — *${u.balance.toFixed(2)} TON*`).join('\n')
                : "_Пока пусто_";
            bot.sendMessage(
                q.message.chat.id,
                `📊 *СТАТИСТИКА*\n\nПользователей: *${usersCount}*\nПромокодов: *${promoCount}*\n\n🏆 *ТОП БАЛАНСОВ*\n${topRows}`,
                { parse_mode: 'Markdown' }
            );
        }
    });

    bot.on('message', async (msg) => {
        const s = adminSession[msg.from.id]; if (!s || msg.text?.startsWith('/')) return;
        if (msg.text.toLowerCase() === 'отмена') {
            delete adminSession[msg.from.id];
            return bot.sendMessage(msg.chat.id, "❌ Отменено");
        }

        if (s.step === 'mail') {
            const users = await User.find().lean();
            let ok = 0;
            for (const u of users) {
                try { await bot.sendMessage(u.uid, msg.text); ok++; } catch (e) {}
            }
            bot.sendMessage(msg.chat.id, `✅ Готово. Отправлено: ${ok}/${users.length}`);
            delete adminSession[msg.from.id];
            return;
        }

        if (s.step === 'p_code') {
            s.code = msg.text.toUpperCase().trim();
            s.step = 'p_sum';
            return bot.sendMessage(msg.chat.id, "Сумма:");
        }

        if (s.step === 'p_sum') {
            const sum = parseFloat(msg.text);
            if (!Number.isFinite(sum) || sum <= 0) return bot.sendMessage(msg.chat.id, "❌ Неверная сумма");
            s.sum = sum;
            s.step = 'p_lim';
            return bot.sendMessage(msg.chat.id, "Лимит:");
        }

        if (s.step === 'p_lim') {
            const limit = parseInt(msg.text, 10);
            if (!Number.isFinite(limit) || limit <= 0) return bot.sendMessage(msg.chat.id, "❌ Неверный лимит");
            await Promo.findOneAndUpdate(
                { code: s.code },
                { code: s.code, sum: s.sum, limit, count: 0 },
                { upsert: true, new: true }
            );
            bot.sendMessage(msg.chat.id, "✅ Промо создан/обновлён");
            delete adminSession[msg.from.id];
            return;
        }

        if (s.step === 'b_uid') {
            s.targetUid = msg.text.trim();
            s.step = 'b_amount';
            return bot.sendMessage(msg.chat.id, "Введите сумму изменения (например: 1.5 или -0.2):");
        }

        if (s.step === 'b_amount') {
            const delta = parseFloat(msg.text);
            if (!Number.isFinite(delta)) return bot.sendMessage(msg.chat.id, "❌ Неверная сумма");
            const user = await User.findOne({ uid: s.targetUid });
            if (!user) return bot.sendMessage(msg.chat.id, "❌ Пользователь не найден");
            user.balance = Math.max(0, user.balance + delta);
            await user.save();
            bot.sendMessage(msg.chat.id, `✅ Баланс пользователя ${user.uid}: ${user.balance.toFixed(2)} TON`);
            delete adminSession[msg.from.id];
        }
    });
}

// СКАНЕР ОПЛАТ
setInterval(async () => {
    try {
        const r = await axios.get(`https://toncenter.com/api/v2/getTransactions?address=${CONFIG.WALLET}&limit=10&api_key=${CONFIG.TON_KEY}`);
        if (r.data.ok) {
            for (let tx of r.data.result) {
                const comment = tx.in_msg?.message?.trim();
                const lt = tx.transaction_id.lt;
                const val = parseInt(tx.in_msg?.value || 0) / 1e9;
                const u = await User.findOne({ uid: comment });
                if (u && BigInt(lt) > BigInt(u.last_lt)) { u.balance += val; u.last_lt = lt.toString(); await u.save(); }
            }
        }
    } catch (e) {}
}, 30000);
app.post('/api/sync', async (req, res) => {
    const u = await User.findOne({ uid: req.body.uid?.toString() });
    res.json(u || { balance: 0, spins: 0, wins: 0 });
});

app.post('/api/spin', async (req, res) => {
    const { uid, bet } = req.body; const b = parseFloat(bet);
    if (!Number.isFinite(b) || b < CONFIG.MIN_BET) return res.json({ err: `Мин. ставка ${CONFIG.MIN_BET} TON` });
    const u = await User.findOne({ uid: uid.toString() });
    if (!u || u.balance < b) return res.json({ err: "Мало TON" });
    u.balance -= b;
    const items = ['🍒','🔔','💎','7️⃣','🍋'];
    let resArr = [items[Math.floor(Math.random()*5)], items[Math.floor(Math.random()*5)], items[Math.floor(Math.random()*5)]];
    if (Math.random() < CONFIG.WIN_CHANCE) resArr = ['7️⃣','7️⃣','7️⃣'];
    const isWin = resArr[0] === resArr[1] && resArr[1] === resArr[2];
    if(isWin) u.balance += b * CONFIG.WIN_MULTIPLIER;
    u.spins++; if(isWin) u.wins++; await u.save();
    res.json({ result: resArr, winSum: isWin ? b * CONFIG.WIN_MULTIPLIER : 0, balance: u.balance });
});

app.get('/api/config', (req, res) => {
    res.json({
        minBet: CONFIG.MIN_BET,
        bgmUrl: CONFIG.BGM_URL
    });
});

app.post('/api/promo', async (req, res) => {
    const { uid, code } = req.body;
    const p = await Promo.findOne({ code: code.toUpperCase() });
    const u = await User.findOne({ uid: uid.toString() });
    if (!p || p.count >= p.limit || u.used_promos.includes(p.code)) return res.json({ err: "Ошибка" });
    u.balance += p.sum; u.used_promos.push(p.code); p.count++;
    await u.save(); await p.save();
    res.json({ msg: "Бонус!", balance: u.balance });
});

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
    body { margin:0; padding:0; font-family:Arial,sans-serif; text-align:center; height:100vh; color:#fff; background:#000 url('${CONFIG.BG_IMAGE}') no-repeat center center fixed; background-size:cover; overflow:hidden; }
    body::before { content:""; position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:-1; }
    .nav { display:flex; background:rgba(0,0,0,0.8); border-bottom:2px solid #ff00ff; position:sticky; top:0; z-index:2; }
    .tab { flex:1; padding:14px 8px; font-weight:bold; opacity:0.6; font-size:11px; cursor:pointer; }
    .tab.active { opacity:1; color:#00ffff; border-bottom:2px solid #00ffff; }
    .page { display:none; padding:20px; height:85vh; overflow-y:auto; box-sizing:border-box; }
    .page.active { display:block; }
    .card { background:rgba(255,255,255,0.1); border:1px solid #ff00ff; padding:15px; margin-bottom:15px; border-radius:12px; backdrop-filter:blur(5px); }
    .bal-val { font-size:35px; color:#ffff00; font-weight:bold; }
    .copy-box { background:#000; border:1px dashed #00ffff; padding:12px; margin:10px 0; font-family:monospace; font-size:11px; color:#00ffff; cursor:pointer; border-radius:8px; word-break:break-all; }
    .reel-cont { display:flex; justify-content:center; gap:8px; margin:20px 0; }
    .reel { width:80px; height:100px; background:#000; border:2px solid #fff; overflow:hidden; position:relative; border-radius:10px; }
    .strip { width:100%; position:absolute; top:0; left:0; }
    .sym { height:100px; display:flex; align-items:center; justify-content:center; font-size:50px; }
    .btn-main { width:100%; padding:16px; background:#ffff00; color:#000; border:none; font-size:18px; font-weight:bold; border-radius:12px; cursor:pointer; }
    .btn-main:disabled { opacity:0.6; cursor:not-allowed; }
    input, select { width:90%; padding:12px; margin:10px 0; background:#000; border:1px solid #fff; color:#fff; text-align:center; border-radius:8px; }
    .setting-row { display:flex; justify-content:space-between; align-items:center; margin:12px 0; gap:8px; text-align:left; }
    .toggle { width:22px; height:22px; }
    .hint { font-size:12px; opacity:0.8; }
</style></head>
<body>
    <div class="nav">
        <div class="tab active" onclick="sh(1)" id="t1">ИГРА</div>
        <div class="tab" onclick="sh(2)" id="t2">СТАТЫ</div>
        <div class="tab" onclick="sh(3)" id="t3">КАССА</div>
        <div class="tab" onclick="sh(4)" id="t4">НАСТРОЙКИ</div>
    </div>
    <div id="p1" class="page active">
        <div class="card"><div>БАЛАНС</div><div id="bal" class="bal-val">0.00</div></div>
        <div class="reel-cont"><div class="reel"><div class="strip" id="s1"></div></div><div class="reel"><div class="strip" id="s2"></div></div><div class="reel"><div class="strip" id="s3"></div></div></div>
        <input type="number" id="bet" value="${CONFIG.MIN_BET}" step="0.01" min="${CONFIG.MIN_BET}">
        <button class="btn-main" onclick="spin()" id="sBtn">ИГРАТЬ</button>
        <div class="card" style="margin-top:20px"><input id="p-in" placeholder="ПРОМОКОД"><br><button onclick="applyP()" style="color:#00ffff; background:none; border:none; font-weight:bold;">АКТИВИРОВАТЬ</button></div>
    </div>
    <div id="p2" class="page"><div class="card"><h3>СТАТИСТИКА</h3><p>Спинов: <span id="st-s">0</span></p><p>Побед: <span id="st-w">0</span></p></div></div>
    <div id="p3" class="page">
        <div class="card"><h3>ПОПОЛНЕНИЕ</h3><p style="font-size:10px">Нажми на адрес:</p><div class="copy-box" onclick="copyText('${CONFIG.WALLET}')">${CONFIG.WALLET}</div>
        <p style="margin-top:20px">ТВОЙ ID (В КОММЕНТАРИЙ):</p><div class="copy-box" style="font-size:20px" id="u-id-box" onclick="copyText(window.uid)">...</div></div>
    </div>
    <div id="p4" class="page">
        <div class="card">
            <h3>НАСТРОЙКИ</h3>
            <div class="setting-row"><span>Музыка в игре</span><input id="music-enabled" class="toggle" type="checkbox" checked></div>
            <div class="setting-row"><span>Громкость</span><input id="volume" type="range" min="0" max="100" value="35"></div>
            <div class="setting-row"><span>Вибро-отклик</span><input id="vibe-enabled" class="toggle" type="checkbox" checked></div>
            <div class="hint">Музыка стартует после первого нажатия в Telegram WebApp.</div>
        </div>
    </div>
    <script>
        const tg = window.Telegram.WebApp; window.uid = tg.initDataUnsafe?.user?.id?.toString() || "12345";
        const items = ['🍒','🔔','💎','7️⃣','🍋'];
        const audio = new Audio();
        audio.loop = true;
        let cfg = { minBet: ${CONFIG.MIN_BET}, bgmUrl: "${CONFIG.BGM_URL}" };
        const defaults = { musicEnabled: true, volume: 35, vibeEnabled: true };
        const settings = {
            musicEnabled: localStorage.getItem('musicEnabled') !== null ? localStorage.getItem('musicEnabled') === 'true' : defaults.musicEnabled,
            volume: parseInt(localStorage.getItem('volume') || defaults.volume, 10),
            vibeEnabled: localStorage.getItem('vibeEnabled') !== null ? localStorage.getItem('vibeEnabled') === 'true' : defaults.vibeEnabled
        };
        function maybeVibe(type='success'){ if(settings.vibeEnabled) tg.HapticFeedback.notificationOccurred(type); }
        function saveSettings(){ localStorage.setItem('musicEnabled', settings.musicEnabled); localStorage.setItem('volume', settings.volume); localStorage.setItem('vibeEnabled', settings.vibeEnabled); }
        function applyAudioSettings(){ audio.volume = Math.max(0, Math.min(1, settings.volume/100)); if(!settings.musicEnabled){audio.pause();} else {audio.play().catch(()=>{});} }
        async function initConfig(){ try { const r = await fetch('/api/config'); cfg = await r.json(); } catch(e){} audio.src = cfg.bgmUrl; document.getElementById('bet').min = cfg.minBet; if(parseFloat(document.getElementById('bet').value) < cfg.minBet) document.getElementById('bet').value = cfg.minBet; }
        function copyText(t){const e=document.createElement('textarea');e.value=t;document.body.appendChild(e);e.select();document.execCommand('copy');document.body.removeChild(e);maybeVibe('success');tg.showAlert("Скопировано!");}
        function sh(n){document.querySelectorAll('.page').forEach((p,i)=>p.classList.toggle('active',i+1===n));document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active',i+1===n));sync();}
        async function sync(){
            const r=await fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid:window.uid})});
            const d=await r.json();document.getElementById('bal').innerText=d.balance.toFixed(2);
            document.getElementById('u-id-box').innerText=window.uid;document.getElementById('st-s').innerText=d.spins;document.getElementById('st-w').innerText=d.wins;
        }
        function build(){[1,2,3].forEach(i=>{const s=document.getElementById('s'+i);s.innerHTML='';for(let j=0;j<41;j++)s.innerHTML+='<div class="sym">'+items[Math.floor(Math.random()*5)]+'</div>';});}
        async function spin(){
            const b=parseFloat(document.getElementById('bet').value);
            if (!Number.isFinite(b) || b < cfg.minBet) return tg.showAlert("Мин. ставка: " + cfg.minBet + " TON");
            const r=await fetch('/api/spin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid:window.uid,bet:b})});
            const d=await r.json();if(d.err)return tg.showAlert(d.err);
            document.getElementById('sBtn').disabled=true;
            [1,2,3].forEach(i=>{const s=document.getElementById('s'+i);s.lastElementChild.innerText=d.result[i-1];s.style.transition='none';s.style.transform='translateY(0)';setTimeout(()=>{s.style.transition='transform '+(2+i*0.5)+'s cubic-bezier(0.1,0.9,0.1,1)';s.style.transform='translateY(-4000px)';},50);});
            maybeVibe('success');
            setTimeout(()=>{sync();document.getElementById('sBtn').disabled=false;if(d.winSum>0){maybeVibe('success');tg.showAlert("ПОБЕДА! +"+d.winSum);}},4000);
        }
        async function applyP(){ const code=document.getElementById('p-in').value; const r=await fetch('/api/promo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid:window.uid,code})}); const d=await r.json(); tg.showAlert(d.err||d.msg); sync(); }
        document.getElementById('music-enabled').checked = settings.musicEnabled;
        document.getElementById('vibe-enabled').checked = settings.vibeEnabled;
        document.getElementById('volume').value = settings.volume;
        document.getElementById('music-enabled').addEventListener('change', (e)=>{settings.musicEnabled=e.target.checked; saveSettings(); applyAudioSettings();});
        document.getElementById('vibe-enabled').addEventListener('change', (e)=>{settings.vibeEnabled=e.target.checked; saveSettings();});
        document.getElementById('volume').addEventListener('input', (e)=>{settings.volume=parseInt(e.target.value,10); saveSettings(); applyAudioSettings();});
        document.body.addEventListener('click', ()=>{ if(settings.musicEnabled) audio.play().catch(()=>{}); }, { once:true });
        initConfig().then(()=>applyAudioSettings());
        build();sync();tg.expand();
    </script>
</body></html>`);
});
app.listen(PORT,()=>console.log("SERVER START"));
