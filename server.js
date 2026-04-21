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

// ================= SAFETY =================
process.on("uncaughtException", e => console.log("CRASH:", e));
process.on("unhandledRejection", e => console.log("PROMISE ERROR:", e));

// ================= ENV CHECK =================
if(!process.env.MONGO_URI || !process.env.BOT_TOKEN || !process.env.TON_API_KEY){
    console.log("❌ Missing ENV variables");
    process.exit(1);
}

// ================= DB =================
mongoose.connect(process.env.MONGO_URI)
.then(()=>console.log("✅ DB connected"))
.catch(e=>{
    console.log("DB ERROR:", e.message);
    process.exit(1);
});

const User = mongoose.model('User', new mongoose.Schema({
    uid: String,
    balance: { type: Number, default: CONFIG.START_BALANCE },
    spins: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    last_lt: { type: String, default: "0" },
    used_promos: [String]
}));

const Promo = mongoose.model('Promo', new mongoose.Schema({
    code: String,
    sum: Number,
    limit: Number,
    count: { type: Number, default: 0 }
}));

// ================= BOT =================
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
console.log("🤖 BOT STARTED");

// ================= ADMIN SESSION =================
const adminSession = {};

// ================= START COMMAND =================
bot.onText(/\/start/, async (msg)=>{
    const uid = msg.from.id.toString();

    await User.findOneAndUpdate({ uid }, { uid }, { upsert:true });

    const kb = [
        [{ text:"🎰 PLAY", web_app:{ url: process.env.APP_URL } }]
    ];

    if(msg.from.id === CONFIG.ADMIN_ID){
        kb.push([{ text:"🛠 ADMIN", callback_data:"admin" }]);
    }

    bot.sendMessage(msg.chat.id, `🎰 CASINO\nID: ${uid}`, {
        reply_markup:{ inline_keyboard: kb }
    });
});

// ================= ADMIN MENU =================
bot.on('callback_query', async (q)=>{
    if(q.from.id !== CONFIG.ADMIN_ID) return;

    if(q.data === "admin"){
        bot.sendMessage(q.message.chat.id, "🛠 MENU", {
            reply_markup:{
                inline_keyboard:[
                    [{ text:"📢 MAIL", callback_data:"mail" }],
                    [{ text:"🎁 PROMO", callback_data:"promo" }],
                    [{ text:"💰 BALANCE", callback_data:"balance" }]
                ]
            }
        });
    }

    if(q.data === "mail"){
        adminSession[q.from.id] = { step:"mail" };
        bot.sendMessage(q.message.chat.id,"Send message:");
    }

    if(q.data === "promo"){
        adminSession[q.from.id] = { step:"p_code" };
        bot.sendMessage(q.message.chat.id,"Promo code:");
    }

    if(q.data === "balance"){
        adminSession[q.from.id] = { step:"b_uid" };
        bot.sendMessage(q.message.chat.id,"User ID:");
    }
});

// ================= ADMIN INPUT =================
bot.on('message', async (msg)=>{
    const s = adminSession[msg.from.id];
    if(!s || msg.text.startsWith("/")) return;

    if(msg.text.toLowerCase()==="cancel"){
        delete adminSession[msg.from.id];
        return bot.sendMessage(msg.chat.id,"Cancelled");
    }

    // MAIL
    if(s.step==="mail"){
        const users = await User.find();
        for(const u of users){
            try{ await bot.sendMessage(u.uid, msg.text); }catch(e){}
        }
        delete adminSession[msg.from.id];
        return;
    }

    // PROMO
    if(s.step==="p_code"){
        s.code = msg.text.toUpperCase();
        s.step = "p_sum";
        return bot.sendMessage(msg.chat.id,"Amount:");
    }

    if(s.step==="p_sum"){
        s.sum = parseFloat(msg.text);
        s.step = "p_lim";
        return bot.sendMessage(msg.chat.id,"Limit:");
    }

    if(s.step==="p_lim"){
        const limit = parseInt(msg.text);

        await Promo.findOneAndUpdate(
            { code:s.code },
            { code:s.code, sum:s.sum, limit, count:0 },
            { upsert:true }
        );

        delete adminSession[msg.from.id];
        return bot.sendMessage(msg.chat.id,"Promo saved");
    }

    // BALANCE
    if(s.step==="b_uid"){
        s.uid = msg.text;
        s.step = "b_amount";
        return bot.sendMessage(msg.chat.id,"Amount:");
    }

    if(s.step==="b_amount"){
        const delta = parseFloat(msg.text);

        const u = await User.findOne({ uid:s.uid });
        if(!u) return bot.sendMessage(msg.chat.id,"User not found");

        u.balance += delta;
        await u.save();

        delete adminSession[msg.from.id];
        return bot.sendMessage(msg.chat.id,"Updated");
    }
});

// ================= TON DEPOSITS =================
setInterval(async ()=>{
    try{
        const r = await axios.get(
            `https://toncenter.com/api/v2/getTransactions?address=${CONFIG.WALLET}&limit=10&api_key=${process.env.TON_API_KEY}`
        );

        if(!r.data?.ok) return;

        for(const tx of r.data.result || []){

            const uid = tx.in_msg?.message?.trim();
            const lt = tx.transaction_id?.lt;
            const val = (tx.in_msg?.value || 0)/1e9;

            if(!uid || !lt) continue;

            const u = await User.findOne({ uid });
            if(!u) continue;

            const last = u.last_lt || "0";

            if(BigInt(lt) > BigInt(last)){
                u.balance += val;
                u.last_lt = lt.toString();
                await u.save();
            }
        }

    }catch(e){
        console.log("TON ERROR:", e.message);
    }
},30000);

// ================= API =================
app.post('/api/sync', async (req,res)=>{
    const u = await User.findOne({ uid:req.body.uid });
    res.json(u || { balance:0, spins:0, wins:0 });
});

app.post('/api/spin', async (req,res)=>{
    const { uid, bet } = req.body;
    const b = parseFloat(bet);

    if(!Number.isFinite(b) || b < CONFIG.MIN_BET)
        return res.json({ err:"min bet" });

    const u = await User.findOne({ uid });
    if(!u || u.balance < b)
        return res.json({ err:"no balance" });

    u.balance -= b;

    const items = ['🍒','🔔','💎','7️⃣','🍋'];
    let r = [items[0],items[1],items[2]];

    if(Math.random() < CONFIG.WIN_CHANCE)
        r = ['7️⃣','7️⃣','7️⃣'];

    const win = r[0]===r[1] && r[1]===r[2];

    if(win) u.balance += b * CONFIG.WIN_MULTIPLIER;

    u.spins++;
    if(win) u.wins++;

    await u.save();

    res.json({ result:r, balance:u.balance, win });
});

// ================= START =================
app.listen(PORT, ()=>{
    console.log("🚀 RUNNING ON", PORT);
});
