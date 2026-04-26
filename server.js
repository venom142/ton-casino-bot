require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

// ==========================================
// 🛠 НАСТРОЙКИ КАЗИНО (МЕНЯЙ ПОД СЕБЯ)
// ==========================================
const CONFIG = {
    ADMIN_ID: 8475323865, // Твой ID
    WALLET: "UQDoTj0hCwJbI-9fziRCyUZzO2XHmtcDzuiAiGjxG21G3dIX", // Твой кошелек для приема TON
    TON_KEY: "fe9429836fd2dfdb009421c6dc389840c9cdadca238477b4e2910250e11fa6d3", // API ключ от Toncenter
    START_BALANCE: 0.10, // Халява на старте
    BG_IMAGE: "https://files.catbox.moe/ep8e91.png", // Фон игры
    BGM_URL: "https://files.catbox.moe/ef3c37.mp3" // Та самая музыка
};

// Настройки слота
let SETTINGS = { 
    winChance: 0.15, // Шанс победы (15%)
    multiplier: 10,  // Икс при победе (х10)
    minBet: 0.01     // Минимальная ставка
};

// ==========================================
// 🗄 БАЗА ДАННЫХ
// ==========================================
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("💎 База данных подключена!"));

const User = mongoose.model('User', { 
    uid: String, 
    balance: { type: Number, default: CONFIG.START_BALANCE },
    spins: { type: Number, default: 0 }, 
    wins: { type: Number, default: 0 },
    last_lt: { type: String, default: "0" }
});

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const adminState = {};

// ==========================================
// 🤖 ТЕЛЕГРАМ БОТ И АДМИНКА
// ==========================================
bot.onText(/\/start/, async (msg) => {
    const uid = msg.from.id.toString();
    await User.findOneAndUpdate({ uid }, { uid }, { upsert: true, setDefaultsOnInsert: true });
    
    let kb = [[{ text: "🎰 ВОЙТИ В VIP ЗАЛ", web_app: { url: process.env.APP_URL } }]];
    if (msg.from.id === CONFIG.ADMIN_ID) kb.push([{ text: "🛠 АДМИН ПАНЕЛЬ", callback_data: "admin_menu" }]);

    bot.sendMessage(msg.chat.id, `💎 **Добро пожаловать в VIP TON ХОТ ТАП**\n\nТвой бонус **${CONFIG.START_BALANCE} TON** уже на балансе.\nТвой ID: \`${uid}\``, 
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
});

bot.on('callback_query', async (q) => {
    if (q.from.id !== CONFIG.ADMIN_ID) return;
    if (q.data === "admin_menu") {
        bot.sendMessage(q.message.chat.id, "👑 **Панель Владельца**", {
            reply_markup: { inline_keyboard: [
                [{ text: "📢 Сделать рассылку", callback_data: "adm_msg" }],
                [{ text: "💰 Выдать баланс игроку", callback_data: "adm_bal" }],
                [{ text: "📊 Статистика казино", callback_data: "adm_stat" }]
            ]}
        });
    }
    if (q.data === "adm_stat") {
        const users = await User.countDocuments();
        bot.sendMessage(q.message.chat.id, `📊 Всего игроков в базе: **${users}**`, { parse_mode: 'Markdown' });
    }
    if (q.data === "adm_msg") { adminState[q.from.id] = 'msg'; bot.sendMessage(q.message.chat.id, "Отправь текст рассылки:"); }
    if (q.data === "adm_bal") { adminState[q.from.id] = 'bal_id'; bot.sendMessage(q.message.chat.id, "Введи ID игрока:"); }
});

bot.on('message', async (msg) => {
    const state = adminState[msg.from.id];
    if (!state || msg.text?.startsWith('/')) return;

    if (state === 'msg') {
        const users = await User.find();
        let sent = 0;
        for (let u of users) {
            try { await bot.sendMessage(u.uid, msg.text); sent++; } catch(e) {}
        }
        bot.sendMessage(msg.chat.id, `✅ Рассылка завершена! Доставлено: ${sent}`);
        delete adminState[msg.from.id];
    } else if (state === 'bal_id') {
        adminState[msg.from.id] = `bal_val_${msg.text}`;
        bot.sendMessage(msg.chat.id, "Какую сумму начислить? (Например: 5.5)");
    } else if (state.startsWith('bal_val_')) {
        const uid = state.split('_')[2];
        const user = await User.findOne({ uid });
        if (user) {
            user.balance += parseFloat(msg.text); await user.save();
            bot.sendMessage(msg.chat.id, `✅ Баланс игрока ${uid} успешно пополнен!`);
            bot.sendMessage(uid, `🎁 **Администратор начислил вам бонус:** +${msg.text} TON`, { parse_mode: 'Markdown' }).catch(()=>{});
        } else {
            bot.sendMessage(msg.chat.id, "❌ Игрок не найден.");
        }
        delete adminState[msg.from.id];
    }
});

// ==========================================
// 💸 СКАНЕР ДОНАТОВ (УЛУЧШЕННЫЙ)
// ==========================================
setInterval(async () => {
    try {
        const res = await axios.get(`https://toncenter.com/api/v2/getTransactions?address=${CONFIG.WALLET}&limit=10&api_key=${CONFIG.TON_KEY}`);
        if (!res.data?.ok) return;
        
        for (let tx of res.data.result) {
            const comment = tx.in_msg?.message?.trim();
            const lt = tx.transaction_id.lt;
            const val = parseInt(tx.in_msg?.value || 0) / 1e9;
            
            if (!comment || isNaN(comment) || val <= 0) continue;
            
            const user = await User.findOne({ uid: comment });
            if (user && BigInt(lt) > BigInt(user.last_lt || "0")) { 
                user.balance = parseFloat((user.balance + val).toFixed(2)); 
                user.last_lt = lt.toString(); 
                await user.save();
                bot.sendMessage(user.uid, `💎 **ДЕПОЗИТ ЗАЧИСЛЕН!**\nСумма: +${val} TON\nУдачной игры!`, { parse_mode: 'Markdown' }).catch(()=>{});
                bot.sendMessage(CONFIG.ADMIN_ID, `💰 **НОВЫЙ ДОНАТ!**\nИгрок: \`${user.uid}\`\nСумма: **${val} TON**`, { parse_mode: 'Markdown' }).catch(()=>{});
            }
        }
    } catch (err) { /* Игнорируем ошибки сети */ }
}, 15000); // Проверяет каждые 15 секунд

// ==========================================
// 🌐 API ИГРЫ
// ==========================================
app.use(express.json());

app.post('/api/sync', async (req, res) => {
    const user = await User.findOne({ uid: req.body.uid?.toString() });
    res.json(user || { balance: 0, spins: 0, wins: 0 });
});

app.post('/api/spin', async (req, res) => {
    const { uid, bet } = req.body; 
    const user = await User.findOne({ uid: uid.toString() });
    
    if (!user || user.balance < bet || bet < SETTINGS.minBet) {
        return res.json({ err: "Недостаточно баланса или ставка ниже минимальной!" });
    }
    
    user.balance -= bet;
    const items = ['🍒','🔔','💎','7️⃣','🍋'];
    let result = [items[Math.floor(Math.random()*5)], items[Math.floor(Math.random()*5)], items[Math.floor(Math.random()*5)]];
    
    // Подкрутка шанса
    if (Math.random() < SETTINGS.winChance) result = ['7️⃣','7️⃣','7️⃣'];
    
    const isWin = result[0] === result[1] && result[1] === result[2];
    const winSum = isWin ? bet * SETTINGS.multiplier : 0;
    
    user.balance += winSum; 
    user.spins++; 
    if(isWin) user.wins++; 
    await user.save();
    
    res.json({ result, winSum, balance: parseFloat(user.balance.toFixed(2)) });
});

app.post('/api/withdraw', async (req, res) => {
    const { uid, amount, address } = req.body;
    const user = await User.findOne({ uid: uid.toString() });
    
    if (!user || user.balance < amount || amount < 0.1) return res.json({ err: "Ошибка: минимум 0.1 TON" });
    
    user.balance -= amount; 
    await user.save();
    bot.sendMessage(CONFIG.ADMIN_ID, `🚨 **ЗАЯВКА НА ВЫВОД!**\nЮзер: \`${uid}\`\nСумма: **${amount} TON**\nКошелек: \`${address}\``, { parse_mode: 'Markdown' });
    res.json({ msg: "Заявка отправлена администратору!" });
});

// ==========================================
// 🎨 ФРОНТЕНД (WEB APP) PREMUIM ДИЗАЙН
// ==========================================
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        :root { --gold: #FFD700; --neon-purple: #8A2BE2; --dark: #0f0f13; }
        body { margin:0; font-family:'Segoe UI', Roboto, sans-serif; text-align:center; color:#fff; background:var(--dark) url('${CONFIG.BG_IMAGE}') no-repeat center center fixed; background-size:cover; overflow:hidden; user-select:none; }
        body::before { content:""; position:absolute; inset:0; background:radial-gradient(circle, rgba(15,15,19,0.8) 0%, rgba(0,0,0,0.95) 100%); z-index:-1; }
        
        .nav { display:flex; background:rgba(0,0,0,0.8); border-bottom:2px solid var(--gold); box-shadow: 0 0 15px rgba(255,215,0,0.3); }
        .tab { flex:1; padding:15px 5px; font-size:12px; font-weight:800; color:#888; text-transform:uppercase; letter-spacing:1px; transition:0.3s; cursor:pointer; }
        .tab.active { color:var(--gold); text-shadow: 0 0 8px var(--gold); border-bottom:3px solid var(--gold); }
        
        .page { display:none; padding:20px; height:85vh; overflow-y:auto; box-sizing:border-box; animation: fadeIn 0.3s ease; }
        .page.active { display:block; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        
        .card { background:rgba(20,20,25,0.7); border:1px solid rgba(255,215,0,0.2); padding:20px; margin-bottom:20px; border-radius:20px; box-shadow:inset 0 0 20px rgba(0,0,0,0.5); backdrop-filter:blur(10px); }
        .bal-title { font-size:14px; color:#aaa; margin-bottom:5px; text-transform:uppercase; }
        .bal-val { font-size:42px; color:var(--gold); font-weight:900; text-shadow:0 0 20px rgba(255,215,0,0.4); }
        
        .reel-cont { display:flex; justify-content:center; gap:12px; margin:30px 0; }
        .reel { width:85px; height:110px; background:linear-gradient(180deg, #111 0%, #222 50%, #111 100%); border:3px solid var(--gold); border-radius:15px; box-shadow: 0 0 15px rgba(255,215,0,0.3), inset 0 5px 15px rgba(0,0,0,0.8); overflow:hidden; position:relative; }
        .strip { width:100%; position:absolute; top:0; left:0; will-change: transform; }
        .sym { height:110px; display:flex; align-items:center; justify-content:center; font-size:55px; filter: drop-shadow(0 2px 5px rgba(0,0,0,0.5)); }
        
        .inputs { display:flex; justify-content:center; gap:10px; margin-bottom:20px; }
        .bet-btn { background:#333; color:#fff; border:1px solid #555; border-radius:10px; padding:10px 15px; font-weight:bold; width:45px; }
        input[type="number"] { width:100px; padding:10px; background:#000; border:2px solid var(--gold); color:var(--gold); font-size:20px; font-weight:bold; text-align:center; border-radius:10px; }
        
        .btn-main { width:100%; padding:18px; background:linear-gradient(45deg, #FFD700, #FFA500); color:#000; border:none; font-size:22px; font-weight:900; border-radius:15px; text-transform:uppercase; box-shadow:0 5px 20px rgba(255,215,0,0.5); transition:0.1s; }
        .btn-main:active { transform:scale(0.95); box-shadow:0 2px 10px rgba(255,215,0,0.5); }
        .btn-main:disabled { background:#555; color:#888; box-shadow:none; transform:none; }
        
        .copy-box { background:#000; border:1px dashed var(--gold); padding:15px; border-radius:10px; font-family:monospace; font-size:12px; color:var(--gold); word-break:break-all; margin-top:10px; }
    </style>
</head>
<body>
    <audio id="bgm" loop src="${CONFIG.BGM_URL}"></audio>
    
    <div class="nav">
        <div class="tab active" onclick="sh(1)">🎰 VIP ЗАЛ</div>
        <div class="tab" onclick="sh(3)">💎 БАНК</div>
        <div class="tab" onclick="sh(2)">📈 ИНФО</div>
        <div class="tab" onclick="sh(4)">⚙️</div>
    </div>
    
    <div id="pg1" class="page active">
        <div class="card">
            <div class="bal-title">Ваш баланс (TON)</div>
            <div id="bal" class="bal-val">0.00</div>
        </div>
        
        <div class="reel-cont">
            <div class="reel"><div class="strip" id="s1"></div></div>
            <div class="reel"><div class="strip" id="s2"></div></div>
            <div class="reel"><div class="strip" id="s3"></div></div>
        </div>
        
        <div class="inputs">
            <button class="bet-btn" onclick="chBet(-0.1)">-</button>
            <input type="number" id="bet" value="0.1" step="0.1" readonly>
            <button class="bet-btn" onclick="chBet(0.1)">+</button>
        </div>
        
        <button class="btn-main" onclick="spin()" id="sBtn">КРУТИТЬ</button>
    </div>
    
    <div id="pg2" class="page">
        <div class="card">
            <h2 style="color:var(--gold)">СТАТИСТИКА</h2>
            <p style="font-size:18px">Всего спинов: <b id="st-s" style="color:#fff">0</b></p>
            <p style="font-size:18px">Удачных игр: <b id="st-w" style="color:var(--gold)">0</b></p>
        </div>
    </div>
    
    <div id="pg3" class="page">
        <div class="card">
            <h3 style="color:var(--gold); margin-top:0;">ДЕПОЗИТ TON</h3>
            <p style="font-size:14px; color:#aaa;">Отправьте TON на кошелек проекта. Баланс пополнится автоматически.</p>
            <div class="copy-box" onclick="cp('${CONFIG.WALLET}')">${CONFIG.WALLET}</div>
            <p style="color:#fff; font-weight:bold; margin-top:20px;">ОБЯЗАТЕЛЬНО УКАЖИТЕ ЭТОТ ID В КОММЕНТАРИИ К ПЕРЕВОДУ:</p>
            <div class="copy-box" style="font-size:24px; text-align:center;" id="myid" onclick="cp(window.uid)">...</div>
        </div>
        
        <div class="card">
            <h3 style="color:var(--gold); margin-top:0;">ВЫВОД СРЕДСТВ</h3>
            <input type="text" id="wa" placeholder="Ваш TON кошелек" style="width:100%; box-sizing:border-box; margin-bottom:10px;">
            <input type="number" id="wm" placeholder="Сумма вывода" style="width:100%; box-sizing:border-box; margin-bottom:15px;">
            <button class="btn-main" style="font-size:16px; padding:15px;" onclick="wd()">ЗАКАЗАТЬ ВЫВОД</button>
        </div>
    </div>
    
    <div id="pg4" class="page">
        <div class="card">
            <button class="btn-main" style="background:#222; color:#fff; font-size:16px;" onclick="tm()" id="mBtn">🔇 Включить музыку</button>
        </div>
    </div>

    <script>
        const tg = window.Telegram.WebApp; 
        tg.expand();
        tg.setHeaderColor('#0f0f13');
        tg.setBackgroundColor('#0f0f13');
        
        window.uid = tg.initDataUnsafe?.user?.id?.toString() || "TEST_ID";
        const items = ['🍒','🔔','💎','7️⃣','🍋']; 
        const bgm = document.getElementById('bgm');
        
        function chBet(val) {
            let el = document.getElementById('bet');
            let n = parseFloat(el.value) + val;
            if(n >= 0.01) el.value = n.toFixed(2);
        }

        function cp(t) {
            const e = document.createElement('textarea'); e.value = t; document.body.appendChild(e);
            e.select(); document.execCommand('copy'); document.body.removeChild(e);
            tg.HapticFeedback.notificationOccurred('success');
            tg.showAlert("✅ Скопировано!");
        }

        function tm() { 
            if(bgm.paused) { bgm.play(); document.getElementById('mBtn').innerText='🔊 Выключить музыку'; } 
            else { bgm.pause(); document.getElementById('mBtn').innerText='🔇 Включить музыку'; }
        }

        function sh(n) {
            document.querySelectorAll('.page').forEach((p,i) => p.classList.toggle('active', i+1===n));
            document.querySelectorAll('.tab').forEach((t,i) => t.classList.toggle('active', i+1===n));
            sync();
        }

        async function sync() {
            try {
                const r = await fetch('/api/sync', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid:window.uid})});
                const d = await r.json(); 
                document.getElementById('bal').innerText = d.balance.toFixed(2);
                document.getElementById('myid').innerText = window.uid; 
                document.getElementById('st-s').innerText = d.spins || 0; 
                document.getElementById('st-w').innerText = d.wins || 0;
            } catch(e) {}
        }

        function build() {
            [1,2,3].forEach(i => {
                const s = document.getElementById('s'+i); s.innerHTML = '';
                for(let j=0; j<60; j++) s.innerHTML += '<div class="sym">' + items[Math.floor(Math.random()*5)] + '</div>';
            });
        }

        async function spin() {
            const bet = parseFloat(document.getElementById('bet').value);
            const btn = document.getElementById('sBtn');
            
            const r = await fetch('/api/spin', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid:window.uid, bet})});
            const data = await r.json(); 
            
            if(data.err) {
                tg.HapticFeedback.notificationOccurred('error');
                return tg.showAlert(data.err);
            }
            
            btn.disabled = true; 
            tg.HapticFeedback.impactOccurred('heavy');
            
            // Запускаем красивую анимацию
            [1,2,3].forEach((i) => {
                const s = document.getElementById('s'+i);
                s.style.transition = 'none'; 
                s.style.transform = 'translateY(0)';
                
                setTimeout(() => {
                    s.lastElementChild.innerText = data.result[i-1];
                    s.style.transition = 'transform ' + (2 + i*0.5) + 's cubic-bezier(0.15, 0.85, 0.1, 1)';
                    s.style.transform = 'translateY(-6490px)'; // Крутит 59 символов вниз
                }, 50);
            });
            
            setTimeout(() => { 
                sync(); 
                btn.disabled = false; 
                if(data.winSum > 0) {
                    tg.HapticFeedback.notificationOccurred('success');
                    tg.showAlert("🎉 МЕГА ВЫИГРЫШ: +" + data.winSum.toFixed(2) + " TON!"); 
                }
            }, 3500);
        }

        async function wd() {
            const a = document.getElementById('wa').value, m = parseFloat(document.getElementById('wm').value);
            if(!a || !m) return tg.showAlert("Заполните все поля!");
            const r = await fetch('/api/withdraw', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid:window.uid, amount:m, address:a})});
            const d = await r.json(); 
            tg.showAlert(d.err || d.msg); 
            sync();
            document.getElementById('wa').value = '';
            document.getElementById('wm').value = '';
        }

        build(); sync();
    </script>
</body>
</html>`);
});

app.listen(PORT, () => console.log("🚀 VIP TON CASINO РАБОТАЕТ НА ПОРТУ " + PORT));
        
