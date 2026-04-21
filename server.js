require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

// ================= CONFIG =================
const CONFIG = {
    ADMIN_ID: 8475323865,
    WALLET: "UQDoTj0hCwJbI-9fziRCyUZzO2XHmtcDzuiAiGjxG21G3dIX",
    WIN_CHANCE: 0.12,
    WIN_MULTIPLIER: 10,
    START_BALANCE: 0.1,
    MIN_BET: 0.01
};

// ================= CHECK ENV =================
if (!process.env.MONGO_URI || !process.env.BOT_TOKEN || !process.env.TON_API_KEY) {
    console.log("❌ Missing ENV variables");
    process.exit(1);
}

// ================= DB =================
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ DB connected"))
    .catch(err => {
        console.log("DB error:", err.message);
        process.exit(1);
    });

const User = mongoose.model('User', new mongoose.Schema({
    uid: String,
    balance: { type: Number, default: CONFIG.START_BALANCE },
    spins: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    last_lt: { type: String, default: "0" }
}));

const Promo = mongoose.model('Promo', new mongoose.Schema({
    code: String,
    sum: Number,
    limit: Number,
    count: { type: Number, default: 0 }
}));

// ================= BOT =================
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
console.log("🤖 Bot started");

// ================= ADMIN SESSION =================
const admin = {};

// ================= START =================
bot.onText(/\/start/, async (msg) => {
    const uid = msg.from.id.toString();

    await User.findOneAndUpdate({ uid }, { uid }, { upsert: true });

    const kb = [
        [{ text: "🎰 PLAY", web_app: { url: process.env.APP_URL } }]
    ];

    if (msg.from.id === CONFIG.ADMIN_ID) {
        kb.push([{ text: "🛠 ADMIN", callback_data: "admin" }]);
    }

    bot.sendMessage(msg.chat.id, `🎰 CASINO\nID: ${uid}`, {
        reply_markup: { inline_keyboard: kb }
    });
});

// ================= ADMIN MENU =================
bot.on('callback_query', async (q) => {
    if (q.from.id !== CONFIG.ADMIN_ID) return;

    if (q.data === "admin") {
        return bot.sendMessage(q.message.chat.id, "🛠 MENU", {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📢 MAIL", callback_data: "mail" }],
                    [{ text: "🎁 PROMO", callback_data: "promo" }],
                    [{ text: "💰 BALANCE", callback_data: "balance" }]
                ]
            }
        });
    }

    if (q.data === "mail") {
        admin[q.from.id] = { step: "mail" };
        return bot.sendMessage(q.message.chat.id, "Send message:");
    }

    if (q.data === "promo") {
        admin[q.from.id] = { step: "promo_code" };
        return bot.sendMessage(q.message.chat.id, "Promo code:");
    }

    if (q.data === "balance") {
        admin[q.from.id] = { step: "uid" };
        return bot.sendMessage(q.message.chat.id, "User ID:");
    }
});

// ================= ADMIN INPUT =================
bot.on('message', async (msg) => {
    const s = admin[msg.from.id];
    if (!s || msg.text.startsWith("/")) return;

    // MAIL
    if (s.step === "mail") {
        const users = await User.find();
        for (const u of users) {
            try { await bot.sendMessage(u.uid, msg.text); } catch {}
        }
        delete admin[msg.from.id];
        return;
    }

    // PROMO
    if (s.step === "promo_code") {
        s.code = msg.text.toUpperCase();
        s.step = "promo_sum";
        return bot.sendMessage(msg.chat.id, "Amount:");
    }

    if (s.step === "promo_sum") {
        s.sum = parseFloat(msg.text);
        s.step = "promo_limit";
        return bot.sendMessage(msg.chat.id, "Limit:");
    }

    if (s.step === "promo_limit") {
        await Promo.findOneAndUpdate(
            { code: s.code },
            { code: s.code, sum: s.sum, limit: parseInt(msg.text), count: 0 },
            { upsert: true }
        );

        delete admin[msg.from.id];
        return bot.sendMessage(msg.chat.id, "✅ Promo created");
    }

    // BALANCE
    if (s.step === "uid") {
        s.uid = msg.text;
        s.step = "amount";
        return bot.sendMessage(msg.chat.id, "Amount:");
    }

    if (s.step === "amount") {
        const u = await User.findOne({ uid: s.uid });
        if (!u) return bot.sendMessage(msg.chat.id, "User not found");

        u.balance += parseFloat(msg.text);
        await u.save();

        delete admin[msg.from.id];
        return bot.sendMessage(msg.chat.id, "✅ Updated");
    }
});

// ================= TON PAYMENTS =================
setInterval(async () => {
    try {
        const r = await axios.get(
            `https://toncenter.com/api/v2/getTransactions?address=${CONFIG.WALLET}&limit=10&api_key=${process.env.TON_API_KEY}`
        );

        if (!r.data?.ok) return;

        for (const tx of r.data.result) {
            const uid = tx.in_msg?.message?.trim();
            const lt = tx.transaction_id?.lt;
            const value = (tx.in_msg?.value || 0) / 1e9;

            if (!uid || !lt) continue;

            const user = await User.findOne({ uid });
            if (!user) continue;

            if (BigInt(lt) > BigInt(user.last_lt)) {
                user.balance += value;
                user.last_lt = lt.toString();
                await user.save();
            }
        }
    } catch (e) {}
}, 30000);

// ================= API =================
app.post('/api/sync', async (req, res) => {
    const u = await User.findOne({ uid: req.body.uid });
    res.json(u || { balance: 0, spins: 0, wins: 0 });
});

app.post('/api/spin', async (req, res) => {
    const { uid, bet } = req.body;
    const b = parseFloat(bet);

    if (!Number.isFinite(b) || b < CONFIG.MIN_BET)
        return res.json({ err: "min bet" });

    const u = await User.findOne({ uid });
    if (!u || u.balance < b)
        return res.json({ err: "no balance" });

    u.balance -= b;

    const items = ['🍒','🔔','💎','7️⃣','🍋'];
    let r = [items[0], items[1], items[2]];

    if (Math.random() < CONFIG.WIN_CHANCE)
        r = ['7️⃣','7️⃣','7️⃣'];

    const win = r[0] === r[1] && r[1] === r[2];

    if (win) u.balance += b * CONFIG.WIN_MULTIPLIER;

    u.spins++;
    if (win) u.wins++;

    await u.save();

    res.json({ result: r, balance: u.balance, win });
});

// ================= ROOT =================
app.get('/', (req, res) => {
    res.send("🎰 CASINO SERVER RUNNING");
});

// ================= START SERVER =================
app.listen(PORT, () => {
    console.log("🚀 Server running on port", PORT);
});
