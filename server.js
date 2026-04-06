const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

const MY_WALLET = "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn";
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI; 
const URL_APP = "https://ton-casino-bot.onrender.com";

// Подключение к твоей новой базе
mongoose.connect(MONGO_URI).then(() => console.log("БАЗА ПОДКЛЮЧЕНА")).catch(e => console.log("ОШИБКА БАЗЫ"));

const User = mongoose.model('User', { uid: String, b: { type: Number, default: 0.10 }, s: { type: Number, default: 0 }, w: { type: Number, default: 0 } });
const Tx = mongoose.model('Tx', { hash: String });

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
app.use(express.json());

// Авто-зачисление TON
async function scan() {
    try {
        const res = await axios.get(`https://toncenter.com/api/v2/getTransactions?address=${MY_WALLET}&limit=10`);
        for (let tx of res.data.result) {
            const hash = tx.transaction_id.hash;
            if (await Tx.findOne({ hash })) continue;
            const msg = tx.in_msg?.message;
            if (msg && msg.startsWith("ID_")) {
                const uid = msg.split("_")[1];
                const amount = tx.in_msg.value / 1e9;
                let u = await User.findOne({ uid });
                if (u) {
                    u.b += amount; await u.save(); await new Tx({ hash }).save();
                    bot.sendMessage(uid, `✅ +${amount} TON зачислено на ваш вечный баланс!`);
                }
            }
        }
    } catch (e) {}
}
setInterval(scan, 45000);

bot.onText(/\/start/, (m) => {
    bot.sendMessage(m.chat.id, "💎 **VIP TON ХОТ ТАП (MONGO)**", {
        reply_markup: { inline_keyboard: [[{ text: "🎰 ИГРАТЬ", web_app: { url: URL_APP } }]] }
    });
});

app.post('/api/init', async (req, res) => {
    let u = await User.findOne({ uid: req.body.uid.toString() });
    if (!u) { u = new User({ uid: req.body.uid.toString() }); await u.save(); }
    res.json(u);
});

app.post('/api/spin', async (req, res) => {
    let u = await User.findOne({ uid: req.body.uid.toString() });
    if (!u || u.b < 0.05) return res.json({ err: "Мало TON" });
    u.b -= 0.05; u.s++;
    let win = 0; const s = ['💎','💰','7️⃣','🍒','⭐'];
    let r = [s[0], s[1], s[2]].sort(()=>Math.random()-0.5);
    if (Math.random() < 0.12) { const ws = s[Math.floor(Math.random()*5)]; r=[ws,ws,ws]; win=0.5; u.b+=win; u.w++; }
    await u.save();
    res.json({ reels: r, win, b: u.b.toFixed(2), s: u.s, w: u.w });
});

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"><script src="https://telegram.org/js/telegram-web-app.js"></script><style>body{background:#040816;color:#fff;font-family:sans-serif;margin:0;padding:15px}.nav{display:flex;justify-content:space-around;background:#0a1125;padding:12px;border-radius:20px;margin-bottom:20px}.card{background:#0a1125;padding:25px;border-radius:30px;border:1px solid #00d4ff4d}.bal{font-size:50px;color:#00d4ff;font-weight:700}.slots{display:flex;justify-content:center;gap:8px;margin:20px 0}.reel{width:75px;height:90px;background:#000;border-radius:20px;font-size:35px;display:flex;align-items:center;justify-content:center;border:1px solid #1a2c4d}.btn-spin{background:linear-gradient(135deg,#00d4ff,#0088cc);color:#fff;border:none;padding:18px;width:100%;border-radius:40px;font-size:22px;font-weight:800}.btn-dep{background:#1db954;border:none;color:#fff;padding:15px;width:100%;border-radius:20px;margin-top:15px}.modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.95);display:flex;align-items:center;justify-content:center;z-index:1000}.hidden{display:none!important}.m-card{background:#0a1125;width:85%;padding:25px;border-radius:30px;border:2px solid #00d4ff}.copy-box{background:#000;padding:12px;border-radius:15px;font-size:11px;margin:10px 0;word-break:break-all;color:#00d4ff}</style></head><body>
<audio id="bg" loop src="https://files.catbox.moe/78surr.mp3"></audio>
<div class="nav"><span onclick="tab(1)">🎰 ИГРА</span><span onclick="tab(2)">👤 ПРОФИЛЬ</span></div>
<div id="p1" class="card">
    <div style="font-size:10px;opacity:.5">TON BALANCE</div>
    <div class="bal" id="bDisp">...</div>
    <div class="slots"><div id="r1" class="reel">💎</div><div id="r2" class="reel">💎</div><div id="r3" class="reel">💎</div></div>
    <button class="btn-spin" onclick="spin()">SPIN (0.05)</button>
    <button class="btn-dep" onclick="toggleD(true)">+ ПОПОЛНИТЬ</button>
    <button onclick="toggleM()" style="background:none;border:1px solid #00d4ff;color:#00d4ff;padding:5px;border-radius:10px;margin-top:10px">🎵 МУЗЫКА</button>
</div>
<div id="p2" class="card hidden"><h2>ПРОФИЛЬ</h2><p>Игр: <b id="uS">0</b></p><p>Побед: <b id="uW">0</b></p></div>
<div id="depModal" class="modal hidden">
    <div class="m-card">
        <h3>ПОПОЛНЕНИЕ</h3>
        <p style="font-size:10px">АДРЕС:</p><div class="copy-box" onclick="copy('${MY_WALLET}')">${MY_WALLET}</div>
        <p style="color:#ff4d4d">КОММЕНТАРИЙ:</p><div class="copy-box" id="copyId" onclick="copy(this.innerText)">ID_...</div>
        <button onclick="toggleD(false)" style="background:#333;color:#fff;border:none;padding:10px;width:100%;border-radius:15px;margin-top:10px">ЗАКРЫТЬ</button>
    </div>
</div>
<script>
    const tg=window.Telegram.WebApp;const uid=tg.initDataUnsafe?.user?.id||"USER";const bg=document.getElementById('bg');let mOn=false;
    async function load(){const r=await fetch('/api/init',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid})});const d=await r.json();document.getElementById('bDisp').innerText=d.b;document.getElementById('uS').innerText=d.s;document.getElementById('uW').innerText=d.w;document.getElementById('copyId').innerText="ID_"+uid}
    async function spin(){const r=await fetch('/api/spin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid})});const d=await r.json();if(d.err)return tg.showAlert(d.err);document.getElementById('r1').innerText=d.reels[0];document.getElementById('r2').innerText=d.reels[1];document.getElementById('r3').innerText=d.reels[2];load();if(d.win>0)tg.showAlert("WIN!")}
    function toggleD(s){document.getElementById('depModal').classList.toggle('hidden',!s)}
    function copy(t){navigator.clipboard.writeText(t);tg.showAlert("Скопировано!")}
    function toggleM(){if(mOn)bg.pause();else bg.play();mOn=!mOn}
    function tab(n){document.getElementById('p1').classList.toggle('hidden',n!==1);document.getElementById('p2').classList.toggle('hidden',n!==2)}
    load();
</script></body></html>
`);
});

app.listen(PORT, () => console.log("SERVER OK"));
