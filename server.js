require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

// ==========================================
// 🛠 НАСТРОЙКИ КАЗИНО (ТВОИ ДАННЫЕ)
// ==========================================
const CONFIG = {
    ADMIN_ID: 8475323865, 
    WALLET: "UQDoTj0hCwJbI-9fziRCyUZzO2XHmtcDzuiAiGjxG21G3dIX", 
    TON_KEY: "fe9429836fd2dfdb009421c6dc389840c9cdadca238477b4e2910250e11fa6d3", 
    START_BALANCE: 0.10, 
    BG_IMAGE: "https://files.catbox.moe/ep8e91.png", 
    BGM_URL: "https://files.catbox.moe/ef3c37.mp3"
};

let SETTINGS = { 
    winChance: 0.15, 
    multiplier: 10, 
    minBet: 0.01 
};

// ==========================================
// 🗄 БАЗА ДАННЫХ
// ==========================================
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("💎 БАЗА ДАННЫХ ПОДКЛЮЧЕНА"));

const User = mongoose.model('User', { 
    uid: String, 
    balance: { type: Number, default: CONFIG.START_BALANCE },
    spins: { type: Number, default: 0 }, 
    wins: { type: Number, default: 0 },
    last_lt: { type: String, default: "0" },
    used_promos: [String] 
});

const Promo = mongoose.model('Promo', {
    code: String,
    value: Number,
    limit: Number,
    usedCount: { type: Number, default: 0 }
});

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const adminState = {};

// ==========================================
// 🤖 ТЕЛЕГРАМ БОТ И АДМИНКА
// ==========================================
bot.onText(/\/start/, async (msg) => {
    const uid = msg.from.id.toString();
    
    await User.findOneAndUpdate(
        { uid }, 
        { uid }, 
        { upsert: true, setDefaultsOnInsert: true }
    );
    
    let kb = [
        [{ text: "🎰 ВОЙТИ В VIP ЗАЛ", web_app: { url: process.env.APP_URL } }]
    ];
    
    // Кнопка админки видна ТОЛЬКО тебе
    if (msg.from.id === CONFIG.ADMIN_ID) {
        kb.push([{ text: "👑 ПАНЕЛЬ ВЛАДЕЛЬЦА", callback_data: "admin_menu" }]);
    }
    
    bot.sendMessage(msg.chat.id, `💎 **VIP TON ХОТ ТАП**\n\nБонус за старт: **${CONFIG.START_BALANCE} TON**\nТвой ID: \`${uid}\``, { 
        parse_mode: 'Markdown', 
        reply_markup: { inline_keyboard: kb } 
    });
});

bot.on('callback_query', async (q) => {
    if (q.from.id !== CONFIG.ADMIN_ID) return;
    
    if (q.data === "admin_menu") {
        bot.sendMessage(q.message.chat.id, "👑 **Админка**", {
            reply_markup: { inline_keyboard: [
                [{ text: "📢 Рассылка", callback_data: "adm_msg" }, { text: "💰 Выдать баланс", callback_data: "adm_bal" }],
                [{ text: "🎁 Создать ПРОМО", callback_data: "adm_promo_add" }, { text: "🗑 Удалить ПРОМО", callback_data: "adm_promo_del" }],
                [{ text: "📊 Статистика", callback_data: "adm_stat" }]
            ]}
        });
    }
    
    if (q.data === "adm_stat") {
        const users = await User.countDocuments();
        const promos = await Promo.countDocuments();
        bot.sendMessage(q.message.chat.id, `📊 Игроков: **${users}**\n🎁 Активных промо: **${promos}**`, { parse_mode: 'Markdown' });
    }
    
    if (q.data === "adm_msg") { 
        adminState[q.from.id] = 'msg'; 
        bot.sendMessage(q.message.chat.id, "Текст рассылки:"); 
    }
    
    if (q.data === "adm_bal") { 
        adminState[q.from.id] = 'bal_id'; 
        bot.sendMessage(q.message.chat.id, "ID игрока:"); 
    }
    
    if (q.data === "adm_promo_add") { 
        adminState[q.from.id] = 'p_code'; 
        bot.sendMessage(q.message.chat.id, "Название промокода:"); 
    }
    
    if (q.data === "adm_promo_del") { 
        adminState[q.from.id] = 'p_del'; 
        bot.sendMessage(q.message.chat.id, "Название для удаления:"); 
    }
});

bot.on('message', async (msg) => {
    const s = adminState[msg.from.id]; 
    if (!s || msg.text?.startsWith('/')) return;
    
    if (s === 'msg') {
        const users = await User.find(); 
        for (let u of users) { 
            try { await bot.sendMessage(u.uid, msg.text); } catch(e) {} 
        }
        bot.sendMessage(msg.chat.id, "✅ Рассылка готова!"); 
        delete adminState[msg.from.id];
    } 
    else if (s === 'bal_id') { 
        adminState[msg.from.id] = `bal_v_${msg.text}`; 
        bot.sendMessage(msg.chat.id, "Сумма:"); 
    }
    else if (s.startsWith('bal_v_')) {
        const uid = s.split('_')[2]; 
        const user = await User.findOne({ uid });
        if (user) { 
            user.balance += parseFloat(msg.text); 
            await user.save(); 
            bot.sendMessage(msg.chat.id, `✅ Готово!`); 
            bot.sendMessage(uid, `🎁 Начислен бонус: +${msg.text} TON`).catch(()=>{}); 
        }
        delete adminState[msg.from.id];
    }
    else if (s === 'p_code') {
        const code = msg.text.trim().toUpperCase();
        adminState[msg.from.id] = `p_val_${code}`;
        bot.sendMessage(msg.chat.id, `Код: **${code}**\nТеперь введите СУММУ (TON):`, {parse_mode:'Markdown'});
    }
    else if (s.startsWith('p_val_')) {
        const code = s.split('_')[2];
        const val = parseFloat(msg.text);
        adminState[msg.from.id] = `p_lim_${code}_${val}`;
        bot.sendMessage(msg.chat.id, `Код: **${code}**, Сумма: **${val}**\nВведите ЛИМИТ активаций (сколько человек могут его заюзать):`, {parse_mode:'Markdown'});
    }
    else if (s.startsWith('p_lim_')) {
        const parts = s.split('_');
        const code = parts[2];
        const val = parseFloat(parts[3]);
        const lim = parseInt(msg.text);
        
        await Promo.findOneAndUpdate({ code }, { code, value: val, limit: lim, usedCount: 0 }, { upsert: true });
        bot.sendMessage(msg.chat.id, `✅ **Промокод создан!**\n🏷 Код: \`${code}\`\n💰 Сумма: **${val} TON**\n👥 Лимит: **${lim} человек**`, {parse_mode:'Markdown'});
        delete adminState[msg.from.id];
    }
    else if (s === 'p_del') {
        await Promo.deleteOne({ code: msg.text.trim().toUpperCase() });
        bot.sendMessage(msg.chat.id, "🗑 Удалено."); 
        delete adminState[msg.from.id];
    }
});

// ==========================================
// 💸 СКАНЕР ДОНАТОВ
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
                bot.sendMessage(user.uid, `💎 **ДЕПОЗИТ ЗАЧИСЛЕН!**\n+${val} TON`).catch(()=>{});
            }
        }
    } catch (err) {}
}, 15000);

// ==========================================
// 🌐 API ИГРЫ
// ==========================================
app.use(express.json());

app.post('/api/sync', async (req, res) => {
    const user = await User.findOne({ uid: req.body.uid?.toString() });
    res.json(user || { balance: 0 });
});

app.post('/api/promo', async (req, res) => {
    const { uid, promo } = req.body; 
    const p = promo?.toUpperCase();
    const user = await User.findOne({ uid: uid.toString() });
    
    if (!user) return res.json({ err: "Ошибка профиля" });
    
    const pr = await Promo.findOne({ code: p });
    if (!pr) return res.json({ err: "❌ Неверный промокод!" });
    if (user.used_promos.includes(p)) return res.json({ err: "⚠️ Вы уже использовали этот код!" });
    if (pr.usedCount >= pr.limit) return res.json({ err: "🚫 Лимит активаций этого кода исчерпан!" });
    
    user.balance += pr.value; 
    user.used_promos.push(p); 
    await user.save();
    
    pr.usedCount += 1; 
    await pr.save(); 
    
    res.json({ msg: `🎁 Начислено +${pr.value} TON. (Осталось активаций: ${pr.limit - pr.usedCount})` });
});

app.post('/api/spin', async (req, res) => {
    const { uid, bet } = req.body; 
    const user = await User.findOne({ uid: uid.toString() });
    
    if (!user || user.balance < bet || bet < SETTINGS.minBet) return res.json({ err: "Мало TON!" });
    
    user.balance -= bet;
    const items = ['🍒','🔔','💎','7️⃣','🍋'];
    let result = [
        items[Math.floor(Math.random() * 5)], 
        items[Math.floor(Math.random() * 5)], 
        items[Math.floor(Math.random() * 5)]
    ];
    
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
    
    if (!user || user.balance < amount || amount < 0.1) return res.json({ err: "Мин. вывод 0.1 TON" });
    
    user.balance -= amount; 
    await user.save();
    
    bot.sendMessage(CONFIG.ADMIN_ID, `🚨 **ВЫВОД**\nЮзер: \`${uid}\`\nСумма: **${amount} TON**\nКошель: \`${address}\``, { parse_mode: 'Markdown' });
    res.json({ msg: "Заявка принята!" });
});

// ==========================================
// 🎨 ФРОНТЕНД (ПОЛНОСТЬЮ РАЗВЕРНУТЫЙ HTML И CSS)
// ==========================================
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        :root { 
            --gold: #FFD700; 
            --dark: #0f0f13; 
        } 
        
        body { 
            margin: 0; 
            font-family: sans-serif; 
            text-align: center; 
            color: #fff; 
            background: var(--dark) url('${CONFIG.BG_IMAGE}') no-repeat center fixed; 
            background-size: cover; 
            overflow: hidden; 
            user-select: none; 
        } 
        
        body::before { 
            content: ""; 
            position: absolute; 
            inset: 0; 
            background: radial-gradient(circle, rgba(15,15,19,0.8) 0%, rgba(0,0,0,0.95) 100%); 
            z-index: -1; 
        } 
        
        .nav { 
            display: flex; 
            background: rgba(0,0,0,0.8); 
            border-bottom: 2px solid var(--gold); 
        } 
        
        .tab { 
            flex: 1; 
            padding: 15px 5px; 
            font-size: 12px; 
            font-weight: 800; 
            color: #888; 
            cursor: pointer; 
            transition: 0.3s;
        } 
        
        .tab.active { 
            color: var(--gold); 
            border-bottom: 3px solid var(--gold); 
        } 
        
        .page { 
            display: none; 
            padding: 20px; 
            height: 85vh; 
            overflow-y: auto; 
            box-sizing: border-box; 
            animation: fadeIn 0.3s ease; 
        } 
        
        .page.active { 
            display: block; 
        } 
        
        @keyframes fadeIn { 
            from { opacity: 0; transform: translateY(10px); } 
            to { opacity: 1; transform: translateY(0); } 
        } 
        
        .card { 
            background: rgba(20,20,25,0.7); 
            border: 1px solid rgba(255,215,0,0.2); 
            padding: 20px; 
            margin-bottom: 20px; 
            border-radius: 20px; 
            backdrop-filter: blur(10px); 
        } 
        
        .bal-val { 
            font-size: 42px; 
            color: var(--gold); 
            font-weight: 900; 
        } 
        
        .reel-cont { 
            display: flex; 
            justify-content: center; 
            gap: 12px; 
            margin: 30px 0; 
        } 
        
        .reel { 
            width: 85px; 
            height: 110px; 
            background: #111; 
            border: 3px solid var(--gold); 
            border-radius: 15px; 
            overflow: hidden; 
            position: relative; 
        } 
        
        .strip { 
            width: 100%; 
            position: absolute; 
            top: 0; 
            left: 0; 
            will-change: transform; 
        } 
        
        .sym { 
            height: 110px; 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            font-size: 55px; 
        } 
        
        .inputs { 
            display: flex; 
            justify-content: center; 
            gap: 10px; 
            margin-bottom: 20px; 
        } 
        
        .bet-btn { 
            background: #333; 
            color: #fff; 
            border: 1px solid #555; 
            border-radius: 10px; 
            padding: 10px 15px; 
            width: 45px; 
            font-size: 20px;
            cursor: pointer;
        } 
        
        input[type="number"], input[type="text"] { 
            width: 100%; 
            padding: 10px; 
            background: #000; 
            border: 2px solid var(--gold); 
            color: var(--gold); 
            font-size: 18px; 
            font-weight: bold; 
            text-align: center; 
            border-radius: 10px; 
            box-sizing: border-box; 
        } 
        
        .btn-main { 
            width: 100%; 
            padding: 18px; 
            background: linear-gradient(45deg, #FFD700, #FFA500); 
            color: #000; 
            border: none; 
            font-size: 20px; 
            font-weight: 900; 
            border-radius: 15px; 
            box-shadow: 0 5px 20px rgba(255,215,0,0.5); 
            cursor: pointer;
        } 
        
        .btn-main:active {
            transform: scale(0.95);
        }

        .copy-box { 
            background: #000; 
            border: 1px dashed var(--gold); 
            padding: 15px; 
            border-radius: 10px; 
            font-size: 12px; 
            color: var(--gold); 
            word-break: break-all; 
            margin-top: 10px; 
        }
    </style>
</head>
<body>
    <audio id="bgm" loop src="${CONFIG.BGM_URL}"></audio>
    
    <div class="nav">
        <div class="tab active" onclick="sh(1)">🎰 ИГРА</div>
        <div class="tab" onclick="sh(2)">📈 ИНФО</div>
        <div class="tab" onclick="sh(3)">💎 БАНК</div>
        <div class="tab" onclick="sh(4)">⚙️</div>
    </div>
    
    <div id="pg1" class="page active">
        <div class="card">
            <div style="color:#aaa">Баланс (TON)</div>
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
            <p style="font-size: 18px;">Спинов: <b id="st-s">0</b></p>
            <p style="font-size: 18px;">Побед: <b id="st-w" style="color:var(--gold)">0</b></p>
        </div>
    </div>
    
    <div id="pg3" class="page">
        <div class="card">
            <h3 style="color:var(--gold); margin-top:0;">🎁 ПРОМОКОД</h3>
            <p style="color:#aaa; font-size:14px; margin-bottom:15px;">Введите подарочный код для получения TON</p>
            <input type="text" id="promo" placeholder="Введите код...">
            <button class="btn-main" style="font-size:16px; padding:15px; margin-top:15px;" onclick="usePromo()">АКТИВИРОВАТЬ</button>
        </div>
        
        <div class="card">
            <h3 style="color:var(--gold); margin-top:0;">ДЕПОЗИТ TON</h3>
            <div class="copy-box" onclick="cp('${CONFIG.WALLET}')">${CONFIG.WALLET}</div>
            <p style="font-weight:bold; margin-top:20px;">ОБЯЗАТЕЛЬНЫЙ КОММЕНТАРИЙ:</p>
            <div class="copy-box" style="font-size:24px; text-align:center;" id="myid" onclick="cp(window.uid)">...</div>
        </div>
        
        <div class="card">
            <h3 style="color:var(--gold); margin-top:0;">ВЫВОД СРЕДСТВ</h3>
            <input type="text" id="wa" placeholder="Адрес кошелька (UQ...)">
            <input type="number" id="wm" placeholder="Сумма" style="margin-top:10px;">
            <button class="btn-main" style="font-size:16px; padding:15px; margin-top:15px;" onclick="wd()">ВЫВЕСТИ</button>
        </div>
    </div>
    
    <div id="pg4" class="page">
        <div class="card">
            <h2 style="color:var(--gold); margin-top:0;">⚙️ НАСТРОЙКИ ИГРЫ</h2>
            <p style="color:#aaa; font-size: 14px; margin-bottom: 20px;">
                Управление звуком и музыкальным сопровождением. Нажмите кнопку ниже, чтобы включить клубную атмосферу.
            </p>
            <button class="btn-main" style="background:#222; color:#fff; font-size:18px; padding:20px;" onclick="tm()" id="mBtn">
                🔇 Включить музыку
            </button>
        </div>
        
        <div class="card" style="margin-top: 20px;">
            <p style="color:#555; font-size: 12px;">Версия клиента: v2.0 (VIP Edition)</p>
            <p style="color:#555; font-size: 12px;">Соединение: Защищено</p>
        </div>
    </div>
    
    <script>
        const tg = window.Telegram.WebApp; 
        tg.expand(); 
        tg.setHeaderColor('#0f0f13');
        tg.setBackgroundColor('#0f0f13');
        
        window.uid = tg.initDataUnsafe?.user?.id?.toString() || "12345";
        
        const items = ['🍒','🔔','💎','7️⃣','🍋']; 
        const bgm = document.getElementById('bgm');
        
        // Управление ставкой
        function chBet(v) {
            let e = document.getElementById('bet');
            let n = parseFloat(e.value) + v;
            if (n >= 0.01) {
                e.value = n.toFixed(2);
            }
        }
        
        // Копирование текста
        function cp(textToCopy) {
            let e = document.createElement('textarea');
            e.value = textToCopy;
            document.body.appendChild(e);
            e.select();
            document.execCommand('copy');
            document.body.removeChild(e);
            
            tg.HapticFeedback.notificationOccurred('success');
            tg.showAlert("✅ Скопировано в буфер обмена!");
        }
        
        // Управление музыкой
        function tm() {
            if (bgm.paused) {
                bgm.play();
                document.getElementById('mBtn').innerText = '🔊 Выключить музыку';
                document.getElementById('mBtn').style.border = '1px solid var(--gold)';
            } else {
                bgm.pause();
                document.getElementById('mBtn').innerText = '🔇 Включить музыку';
                document.getElementById('mBtn').style.border = 'none';
            }
        }
        
        // 
