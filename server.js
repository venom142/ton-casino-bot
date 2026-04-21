require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

const CONFIG = {
    ADMIN_ID: 8475323865, 
    WALLET: "UQDoTj0hCwJbI-9fziRCyUZzO2XHmtcDzuiAiGjxG21G3dIX",
    TON_KEY: "fe9429836fd2dfdb009421c6dc389840c9cdadca238477b4e2910250e11fa6d3",
    WIN_CHANCE: 0.12, 
    WIN_MULTIPLIER: 10,
    START_BALANCE: 0.10,
    BG_IMAGE: "https://files.catbox.moe/ep8e91.png",
    BGM_URL: "https://files.catbox.moe/ef3c37.mp3",
    MIN_BET: 0.01
};
const GAME_SETTINGS = {
    winChance: CONFIG.WIN_CHANCE,
    winMultiplier: CONFIG.WIN_MULTIPLIER,
    minBet: CONFIG.MIN_BET
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
async function processBalanceStep(step, msg, session, bot) {
    if (step === 'b_uid') {
        session.targetUid = msg.text.trim();
        session.step = 'b_amount';
        await bot.sendMessage(msg.chat.id, "Введите сумму изменения (например: 1.5 или -0.2):");
        return true;
    }

    if (step === 'b_amount') {
        const delta = parseFloat(msg.text);
        if (!Number.isFinite(delta)) {
            await bot.sendMessage(msg.chat.id, "❌ Неверная сумма");
            return true;
        }
        const user = await User.findOne({ uid: session.targetUid });
        if (!user) {
            await bot.sendMessage(msg.chat.id, "❌ Пользователь не найден");
            return true;
        }
        user.balance = Math.max(0, user.balance + delta);
        await user.save();
        await bot.sendMessage(msg.chat.id, `✅ Баланс пользователя ${user.uid}: ${user.balance.toFixed(2)} TON`);
        delete adminSession[msg.from.id];
        return true;
    }
    return false;
}
async function processPromoStep(step, msg, session, bot) {
    if (step === 'p_code') {
        session.code = msg.text.toUpperCase().trim();
        session.step = 'p_sum';
        await bot.sendMessage(msg.chat.id, "Сумма:");
        return true;
    }

    if (step === 'p_sum') {
        const sum = parseFloat(msg.text);
        if (!Number.isFinite(sum) || sum <= 0) {
            await bot.sendMessage(msg.chat.id, "❌ Неверная сумма");
            return true;
        }
        session.sum = sum;
        session.step = 'p_lim';
        await bot.sendMessage(msg.chat.id, "Лимит:");
        return true;
    }

    if (step === 'p_lim') {
        const limit = parseInt(msg.text, 10);
        if (!Number.isFinite(limit) || limit <= 0) {
            await bot.sendMessage(msg.chat.id, "❌ Неверный лимит");
            return true;
        }
        await Promo.findOneAndUpdate(
            { code: session.code },
            { code: session.code, sum: session.sum, limit, count: 0 },
            { upsert: true, new: true }
        );
        await bot.sendMessage(msg.chat.id, "✅ Промо создан/обновлён");
        delete adminSession[msg.from.id];
        return true;
    }
    return false;
}
async function processMailStep(step, msg, bot) {
    if (step !== 'mail') return false;
    const users = await User.find().lean();
    let ok = 0;
    for (const u of users) {
        try { await bot.sendMessage(u.uid, msg.text); ok++; } catch (e) {}
    }
    await bot.sendMessage(msg.chat.id, `✅ Готово. Отправлено: ${ok}/${users.length}`);
    delete adminSession[msg.from.id];
    return true;
}

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
                        [{ text: "💰 ИЗМЕНИТЬ БАЛАНС", callback_data: "adm_balance" }],
                        [{ text: "🎛 НАСТРОЙКИ ИГРЫ", callback_data: "adm_game" }]
                        [{ text: "💰 ИЗМЕНИТЬ БАЛАНС", callback_data: "adm_balance" }]
                    ]
                }
            });
        }
        if (q.data === "adm_mail") { adminSession[q.from.id] = { step: 'mail' }; bot.sendMessage(q.message.chat.id, "Текст рассылки:"); }
        if (q.data === "adm_promo") { adminSession[q.from.id] = { step: 'p_code' }; bot.sendMessage(q.message.chat.id, "Код:"); }
        if (q.data === "adm_balance") { adminSession[q.from.id] = { step: 'b_uid' }; bot.sendMessage(q.message.chat.id, "ID пользователя:"); }
        if (q.data === "adm_game") {
            bot.sendMessage(q.message.chat.id, `🎛 *ИГРОВЫЕ НАСТРОЙКИ*\n\nШанс победы: *${(GAME_SETTINGS.winChance * 100).toFixed(1)}%*\nМножитель: *x${GAME_SETTINGS.winMultiplier}*\nМин. ставка: *${GAME_SETTINGS.minBet} TON*`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🎯 Изменить шанс", callback_data: "adm_set_chance" }],
                        [{ text: "💸 Изменить множитель", callback_data: "adm_set_mult" }],
                        [{ text: "🪙 Изменить мин. ставку", callback_data: "adm_set_minbet" }]
                    ]
                }
            });
        }
        if (q.data === "adm_set_chance") { adminSession[q.from.id] = { step: 'g_chance' }; bot.sendMessage(q.message.chat.id, "Новый шанс в % (например 12):"); }
        if (q.data === "adm_set_mult") { adminSession[q.from.id] = { step: 'g_multi' }; bot.sendMessage(q.message.chat.id, "Новый множитель (например 10):"); }
        if (q.data === "adm_set_minbet") { adminSession[q.from.id] = { step: 'g_minbet' }; bot.sendMessage(q.message.chat.id, "Новая мин. ставка TON (например 0.05):"); }
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
            return;
        }

        if (s.step === 'g_chance') {
            const chance = parseFloat(msg.text);
            if (!Number.isFinite(chance) || chance <= 0 || chance > 100) return bot.sendMessage(msg.chat.id, "❌ Введите число от 0.1 до 100");
            GAME_SETTINGS.winChance = chance / 100;
            delete adminSession[msg.from.id];
            return bot.sendMessage(msg.chat.id, `✅ Шанс обновлен: ${chance}%`);
        }

        if (s.step === 'g_multi') {
            const multi = parseFloat(msg.text);
            if (!Number.isFinite(multi) || multi < 1) return bot.sendMessage(msg.chat.id, "❌ Множитель должен быть >= 1");
            GAME_SETTINGS.winMultiplier = multi;
            delete adminSession[msg.from.id];
            return bot.sendMessage(msg.chat.id, `✅ Множитель обновлен: x${multi}`);
        }

        if (s.step === 'g_minbet') {
            const minBet = parseFloat(msg.text);
            if (!Number.isFinite(minBet) || minBet <= 0) return bot.sendMessage(msg.chat.id, "❌ Неверная ставка");
            GAME_SETTINGS.minBet = minBet;
            delete adminSession[msg.from.id];
            return bot.sendMessage(msg.chat.id, `✅ Мин. ставка обновлена: ${minBet} TON`);
        }

        if (await processMailStep(s.step, msg, bot)) return;
        if (await processPromoStep(s.step, msg, s, bot)) return;
        if (await processBalanceStep(s.step, msg, s, bot)) return;
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
    if (!Number.isFinite(b) || b < GAME_SETTINGS.minBet) return res.json({ err: `Мин. ставка ${GAME_SETTINGS.minBet} TON` });
    if (!Number.isFinite(b) || b < CONFIG.MIN_BET) return res.json({ err: `Мин. ставка ${CONFIG.MIN_BET} TON` });
    const u = await User.findOne({ uid: uid.toString() });
    if (!u || u.balance < b) return res.json({ err: "Мало TON" });
    u.balance -= b;
    const items = ['🍒','🔔','💎','7️⃣','🍋'];
    let resArr = [items[Math.floor(Math.random()*5)], items[Math.floor(Math.random()*5)], items[Math.floor(Math.random()*5)]];
    if (Math.random() < GAME_SETTINGS.winChance) resArr = ['7️⃣','7️⃣','7️⃣'];
    const isWin = resArr[0] === resArr[1] && resArr[1] === resArr[2];
    if(isWin) u.balance += b * GAME_SETTINGS.winMultiplier;
    u.spins++; if(isWin) u.wins++; await u.save();
    res.json({ result: resArr, winSum: isWin ? b * GAME_SETTINGS.winMultiplier : 0, balance: u.balance });
});

app.get('/api/config', (req, res) => {
    res.json({
        minBet: GAME_SETTINGS.minBet,
        bgmUrl: CONFIG.BGM_URL
    });
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
    body::before { content:""; position:absolute; inset:0; background:radial-gradient(circle at top, rgba(255,0,230,0.28), rgba(8,10,33,0.86)); z-index:-1; }
    .nav { display:flex; background:linear-gradient(90deg, rgba(255,0,212,0.42), rgba(0,238,255,0.36)); border-bottom:1px solid rgba(255,255,255,0.4); position:sticky; top:0; z-index:2; box-shadow:0 8px 20px rgba(0,0,0,0.35); }
    .tab { flex:1; padding:14px 8px; font-weight:bold; opacity:0.75; font-size:11px; cursor:pointer; text-shadow:0 0 8px rgba(255,255,255,0.45); }
    .tab.active { opacity:1; color:#fff; border-bottom:2px solid #fff; background:rgba(255,255,255,0.12); }
    body::before { content:""; position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:-1; }
    .nav { display:flex; background:rgba(0,0,0,0.8); border-bottom:2px solid #ff00ff; position:sticky; top:0; z-index:2; }
    .tab { flex:1; padding:14px 8px; font-weight:bold; opacity:0.6; font-size:11px; cursor:pointer; }
    .tab.active { opacity:1; color:#00ffff; border-bottom:2px solid #00ffff; }
    .page { display:none; padding:20px; height:85vh; overflow-y:auto; box-sizing:border-box; }
    .page.active { display:block; }
    .card { background:linear-gradient(145deg, rgba(14,17,50,0.82), rgba(50,12,67,0.72)); border:1px solid rgba(0,255,247,0.55); padding:15px; margin-bottom:15px; border-radius:14px; backdrop-filter:blur(6px); box-shadow:0 0 18px rgba(255,0,229,0.35), inset 0 0 16px rgba(0,217,255,0.14); }
    .bal-val { font-size:36px; color:#fffb00; font-weight:bold; text-shadow:0 0 16px rgba(255,242,0,0.7); }
    .copy-box { background:rgba(0,0,0,0.4); border:1px dashed #00ffff; padding:12px; margin:10px 0; font-family:monospace; font-size:11px; color:#75f9ff; cursor:pointer; border-radius:8px; word-break:break-all; }
    .reel-cont { display:flex; justify-content:center; gap:8px; margin:20px 0; }
    .reel { width:80px; height:100px; background:linear-gradient(180deg,#02030e,#161638); border:2px solid #fff; overflow:hidden; position:relative; border-radius:10px; box-shadow:0 0 16px rgba(0,255,255,0.5); }
    .strip { width:100%; position:absolute; top:0; left:0; }
    .sym { height:100px; display:flex; align-items:center; justify-content:center; font-size:50px; }
    .btn-main { width:100%; padding:16px; background:linear-gradient(90deg,#ffe600,#ff8c00); color:#120019; border:none; font-size:18px; font-weight:bold; border-radius:12px; cursor:pointer; box-shadow:0 8px 18px rgba(255,179,0,0.5); }
    .btn-main:disabled { opacity:0.6; cursor:not-allowed; }
    input, select { width:90%; padding:12px; margin:10px 0; background:rgba(0,0,0,0.45); border:1px solid rgba(255,255,255,0.7); color:#fff; text-align:center; border-radius:8px; }
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
        <div class="card"><div>БАЛАНС</div><div id="bal" class="
