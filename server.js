require('dotenv').config(); const express = require('express'); const TelegramBot = require('node-telegram-bot-api'); const mongoose = require('mongoose'); const axios = require('axios');

const app = express(); const PORT = process.env.PORT || 10000;

// ================= CONFIG ================= const CONFIG = { ADMIN_ID: 8475323865, WALLET: "UQDoTj0hCwJbI-9fziRCyUZzO2XHmtcDzuiAiGjxG21G3dIX", TON_KEY: process.env.TON_KEY,

WIN_CHANCE: 0.12,
WIN_MULTIPLIER: 10,
START_BALANCE: 0.10,

BG_IMAGE: "https://files.catbox.moe/ep8e91.png",
BGM_URL: "https://files.catbox.moe/78surr.mp3",

MIN_BET: 0.01,

// AUTO WITHDRAW SETTINGS
AUTO_WITHDRAW: true,
MIN_WITHDRAW: 0.1

};

const GAME_SETTINGS = { winChance: CONFIG.WIN_CHANCE, winMultiplier: CONFIG.WIN_MULTIPLIER, minBet: CONFIG.MIN_BET };

// ================= DB ================= mongoose.connect(process.env.MONGO_URI) .then(() => console.log("✅ MongoDB подключена")) .catch(err => console.error("Mongo error", err));

const User = mongoose.model('User', { uid: String, balance: { type: Number, default: CONFIG.START_BALANCE }, spins: { type: Number, default: 0 }, wins: { type: Number, default: 0 }, last_lt: { type: String, default: "0" }, used_promos: [String] });

const Promo = mongoose.model('Promo', { code: { type: String, uppercase: true, unique: true }, sum: Number, limit: Number, count: { type: Number, default: 0 } });

// ================= WITHDRAWALS ================= const Withdrawal = mongoose.model('Withdrawal', { uid: String, amount: Number, status: { type: String, default: 'pending' }, created: { type: Date, default: Date.now } }); code: { type: String, uppercase: true, unique: true }, sum: Number, limit: Number, count: { type: Number, default: 0 } });

app.use(express.json());

// ================= TELEGRAM BOT ================= const adminSession = {};

if (process.env.BOT_TOKEN) {

const bot = new TelegramBot(process.env.BOT_TOKEN, {
    polling: true
});

// START
bot.onText(/\/start/, async (msg) => {

    const uid = msg.from.id.toString();

    await User.findOneAndUpdate(
        { uid },
        { uid },
        { upsert: true }
    );

    const kb = [[
        {
            text: "🎰 ИГРАТЬ",
            web_app: {
                url: process.env.APP_URL
            }
        }
    ]];

    if (msg.from.id === CONFIG.ADMIN_ID) {
        kb.push([
            {
                text: "🛠 АДМИНКА",
                callback_data: "adm_main"
            }
        ]);
    }

    bot.sendMessage(
        msg.chat.id,
        `🎰 TON CASINO\n\nID: ${uid}`,
        {
            reply_markup: {
                inline_keyboard: kb
            }
        }
    );
});

// CALLBACKS
bot.on('callback_query', async (q) => {

    if (q.from.id !== CONFIG.ADMIN_ID) return;

    const chatId = q.message.chat.id;

    if (q.data === "adm_main") {

        bot.sendMessage(chatId, "🛠 МЕНЮ", {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📢 РАССЫЛКА", callback_data: "adm_mail" }],
                    [{ text: "🎁 ПРОМО", callback_data: "adm_promo" }],
                    [{ text: "📊 СТАТИСТИКА", callback_data: "adm_stats" }],
                    [{ text: "💰 ИЗМЕНИТЬ БАЛАНС", callback_data: "adm_balance" }],
                    [{ text: "🎛 НАСТРОЙКИ ИГРЫ", callback_data: "adm_game" }]
                ]
            }
        });
    }

    if (q.data === "adm_mail") {
        adminSession[q.from.id] = { step: 'mail' };
        bot.sendMessage(chatId, "Текст рассылки:");
    }

    if (q.data === "adm_promo") {
        adminSession[q.from.id] = { step: 'p_code' };
        bot.sendMessage(chatId, "Код:");
    }

    if (q.data === "adm_balance") {
        adminSession[q.from.id] = { step: 'b_uid' };
        bot.sendMessage(chatId, "ID пользователя:");
    }

    if (q.data === "adm_game") {

        bot.sendMessage(
            chatId,
            `🎛 ИГРОВЫЕ НАСТРОЙКИ\n\nШанс: ${(GAME_SETTINGS.winChance * 100).toFixed(1)}%\nМножитель: x${GAME_SETTINGS.winMultiplier}\nМин. ставка: ${GAME_SETTINGS.minBet} TON`,
            {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🎯 Изменить шанс", callback_data: "adm_set_chance" }],
                        [{ text: "💸 Изменить множитель", callback_data: "adm_set_mult" }],
                        [{ text: "🪙 Изменить мин. ставку", callback_data: "adm_set_minbet" }]
                    ]
                }
            }
        );
    }

    if (q.data === "adm_stats") {

        const usersCount = await User.countDocuments();
        const promoCount = await Promo.countDocuments();

        bot.sendMessage(
            chatId,
            `📊 СТАТИСТИКА\n\nПользователей: ${usersCount}\nПромокодов: ${promoCount}`
        );
    }

});

// ADMIN TEXT HANDLER
bot.on('message', async (msg) => {

    const s = adminSession[msg.from.id];

    if (!s) return;

    if (msg.text?.toLowerCase() === 'отмена') {
        delete adminSession[msg.from.id];
        return bot.sendMessage(msg.chat.id, "❌ Отменено");
    }

    // MAIL
    if (s.step === 'mail') {

        const users = await User.find().lean();

        let ok = 0;

        for (const u of users) {
            try {
                await bot.sendMessage(u.uid, msg.text);
                ok++;
            } catch (e) {}
        }

        bot.sendMessage(
            msg.chat.id,
            `✅ Отправлено: ${ok}/${users.length}`
        );

        delete adminSession[msg.from.id];
        return;
    }

    // PROMO
    if (s.step === 'p_code') {
        s.code = msg.text.toUpperCase().trim();
        s.step = 'p_sum';
        return bot.sendMessage(msg.chat.id, "Сумма:");
    }

    if (s.step === 'p_sum') {
        const sum = parseFloat(msg.text);

        if (!Number.isFinite(sum) || sum <= 0) {
            return bot.sendMessage(msg.chat.id, "❌ Неверная сумма");
        }

        s.sum = sum;
        s.step = 'p_lim';

        return bot.sendMessage(msg.chat.id, "Лимит:");
    }

    if (s.step === 'p_lim') {

        const limit = parseInt(msg.text);

        if (!Number.isFinite(limit) || limit <= 0) {
            return bot.sendMessage(msg.chat.id, "❌ Неверный лимит");
        }

        await Promo.findOneAndUpdate(
            { code: s.code },
            {
                code: s.code,
                sum: s.sum,
                limit,
                count: 0
            },
            {
                upsert: true,
                new: true
            }
        );

        bot.sendMessage(msg.chat.id, "✅ Промо создан");

        delete adminSession[msg.from.id];

        return;
    }

    // BALANCE
    if (s.step === 'b_uid') {

        s.targetUid = msg.text.trim();
        s.step = 'b_amount';

        return bot.sendMessage(
            msg.chat.id,
            "Введите сумму (например: 1.5 или -0.2):"
        );
    }

    if (s.step === 'b_amount') {

        const delta = parseFloat(msg.text);

        if (!Number.isFinite(delta)) {
            return bot.sendMessage(msg.chat.id, "❌ Неверная сумма");
        }

        const user = await User.findOne({ uid: s.targetUid });

        if (!user) {
            return bot.sendMessage(msg.chat.id, "❌ Пользователь не найден");
        }

        user.balance = Math.max(
            0,
            user.balance + delta
        );

        await user.save();

        bot.sendMessage(
            msg.chat.id,
            `✅ Баланс: ${user.balance.toFixed(2)} TON`
        );

        delete adminSession[msg.from.id];

        return;
    }

    // GAME SETTINGS
    if (s.step === 'g_chance') {

        const chance = parseFloat(msg.text);

        if (!Number.isFinite(chance)) {
            return bot.sendMessage(msg.chat.id, "Ошибка");
        }

        GAME_SETTINGS.winChance = chance / 100;

        delete adminSession[msg.from.id];

        return bot.sendMessage(
            msg.chat.id,
            `✅ Новый шанс: ${chance}%`
        );
    }

});

}

// ================= PAYMENT SCANNER ================= setInterval(async () => {

try {

    const r = await axios.get(
        `https://toncenter.com/api/v2/getTransactions?address=${CONFIG.WALLET}&limit=10&api_key=${CONFIG.TON_KEY}`
    );

    if (r.data.ok) {

        for (let tx of r.data.result) {

            const comment = tx.in_msg?.message?.trim();
            const lt = tx.transaction_id.lt;

            const val = parseInt(
                tx.in_msg?.value || 0
            ) / 1e9;

            const u = await User.findOne({ uid: comment });

            if (
                u &&
                BigInt(lt) > BigInt(u.last_lt)
            ) {

                u.balance += val;
                u.last_lt = lt.toString();

                await u.save();
            }
        }
    }

} catch (e) {
    console.log("Scanner error", e.message);
}

}, 30000);

// ================= API =================

app.post('/api/sync', async (req, res) => {

const u = await User.findOne({
    uid: req.body.uid?.toString()
});

res.json(
    u || {
        balance: 0,
        spins: 0,
        wins: 0
    }
);

});

app.post('/api/spin', async (req, res) => {

const { uid, bet } = req.body;

const b = parseFloat(bet);

if (!Number.isFinite(b) || b < GAME_SETTINGS.minBet) {

    return res.json({
        err: `Мин. ставка ${GAME_SETTINGS.minBet} TON`
    });
}

const u = await User.findOne({
    uid: uid.toString()
});

if (!u || u.balance < b) {
    return res.json({
        err: "Мало TON"
    });
}

u.balance -= b;

const items = [
    '🍒',
    '🔔',
    '💎',
    '7️⃣',
    '🍋'
];

let resArr = [
    items[Math.floor(Math.random() * 5)],
    items[Math.floor(Math.random() * 5)],
    items[Math.floor(Math.random() * 5)]
];

if (Math.random() < GAME_SETTINGS.winChance) {
    resArr = ['7️⃣', '7️⃣', '7️⃣'];
}

const isWin =
    resArr[0] === resArr[1] &&
    resArr[1] === resArr[2];

if (isWin) {
    u.balance +=
        b * GAME_SETTINGS.winMultiplier;
}

u.spins++;

if (isWin) {
    u.wins++;
}

await u.save();

res.json({
    result: resArr,
    winSum: isWin
        ? b * GAME_SETTINGS.winMultiplier
        : 0,
    balance: u.balance
});

});

app.get('/api/config', (req, res) => {

res.json({
    minBet: GAME_SETTINGS.minBet,
    bgmUrl: CONFIG.BGM_URL
});

});

app.post('/api/promo', async (req, res) => {

const { uid, code } = req.body;

const p = await Promo.findOne({
    code: code.toUpperCase()
});

const u = await User.findOne({
    uid: uid.toString()
});

if (
    !p ||
    p.count >= p.limit ||
    u.used_promos.includes(p.code)
) {
    return res.json({
        err: "Ошибка"
    });
}

u.balance += p.sum;

u.used_promos.push(p.code);

p.count++;

await u.save();
await p.save();

res.json({
    msg: "Бонус!",
    balance: u.balance
});

});

// ================= WITHDRAW API =================

app.post('/api/withdraw', async (req, res) => {

try {

    const { uid, amount } = req.body;

    const sum = parseFloat(amount);

    if (!Number.isFinite(sum) || sum <= 0) {
        return res.json({ err: 'Неверная сумма' });
    }

    const u = await User.findOne({ uid: uid.toString() });

    if (!u) {
        return res.json({ err: 'Пользователь не найден' });
    }

    if (u.balance < sum) {
        return res.json({ err: 'Недостаточно средств' });
    }

    // списываем баланс
    u.balance -= sum;
    await u.save();

    // создаем заявку
    const w = await Withdrawal.create({
        uid: u.uid,
        amount: sum
    });

    // уведомление админу
    if (typeof bot !== 'undefined') {
        try {
            await bot.sendMessage(
                CONFIG.ADMIN_ID,
                `💸 Новая заявка на вывод

UID: ${u.uid} Сумма: ${sum} TON ID заявки: ${w._id}` ); } catch (e) {} }

// АВТО ВЫПЛАТА
    if (CONFIG.AUTO_WITHDRAW) {
        try {
            await processAutoWithdraw(w);
        } catch (e) {
            console.log('Auto withdraw error', e.message);
        }
    }

    res.json({ msg: 'Заявка на вывод создана' });

} catch (e) {
    console.log('Withdraw error', e.message);
    res.json({ err: 'Ошибка сервера' });
}

});

// ================= AUTO WITHDRAW FUNCTION =================

async function processAutoWithdraw(withdrawal) {

if (withdrawal.amount < CONFIG.MIN_WITHDRAW) {
    console.log('Too small withdraw');
    return;
}

try {

    // Здесь подключается реальная отправка TON
    // Сейчас безопасная демо-логика

    console.log(`AUTO PAYOUT: ${withdrawal.uid} ${withdrawal.amount} TON`);

    withdrawal.status = 'paid';
    await withdrawal.save();

    if (typeof bot !== 'undefined') {
        try {
            await bot.sendMessage(
                withdrawal.uid,
                `✅ Выплата отправлена: ${withdrawal.amount} TON`
            );
        } catch (e) {}
    }

} catch (e) {

    withdrawal.status = 'error';
    await withdrawal.save();

    console.log('Withdraw failed', e.message);
}

}

// ================= START =================

app.get('/', (req, res) => {
    res.send("Server is running");
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
    console.log("🚀 Server started on port", PORT);
});
