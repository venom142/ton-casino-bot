const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

// === CONFIG (Вставь свой кошелек!) ===
const WALLET = "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn"; 
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;

// === DATABASE ===
mongoose.connect(MONGO_URI).then(()=>console.log("DB:OK")).catch(e=>console.log("DB:ERR"));

const User = mongoose.model('User', { uid: String, balance: { type: Number, default: 0.10 }, s: { type: Number, default: 0 }, w: { type: Number, default: 0 } });
const Tx = mongoose.model('Tx', { hash: String });

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
app.use(express.json());

// === TON SCANNER ===
async function scan() {
    try {
        const res = await axios.get(`https://toncenter.com/api/v2/getTransactions?address=${WALLET}&limit=10`);
        for (let tx of res.data.result) {
            const h = tx.transaction_id.hash;
            const m = tx.in_msg?.message;
            if (m && m.startsWith("ID_")) {
                if (await Tx.findOne({ hash: h })) continue;
                const uid = m.split("_")[1];
                const u = await User.findOne({ uid });
                if (u) {
                    u.balance += tx.in_msg.value / 1e9;
                    await u.save(); await new Tx({ hash: h }).save();
                    bot.sendMessage(uid, "💎 **БАЛАНС ПОПОЛНЕН!**\nУдачи в игре!");
                }
            }
        }
    } catch (e) {}
}
setInterval(scan, 60000);

// === BOT ===
bot.onText(/\/start/, async (m) => {
    const uid = m.chat.id.toString();
    if (!await User.findOne({ uid })) await new User({ uid }).save();
    bot.sendMessage(uid, "🎰 **VIP TON CASINO**", {
        reply_markup: { inline_keyboard: [[{ text: "🚀 ВОЙТИ В VIP ЗАЛ", web_app: { url: "https://ton-casino-bot.onrender.com" } }]] }
    });
});

// === API ===
app.post('/api/init', async (req, res) => {
    const u = await User.findOne({ uid: req.body.uid.toString() }) || await new User({ uid: req.body.uid.toString() }).save();
    res.json(u);
});

app.post('/api/spin', async (req, res) => {
    const u = await User.findOne({ uid: req.body.uid.toString() });
    if (!u || u.balance < 0.05) return res.json({ err: "МАЛО TON" });
    u.balance = Number((u.balance - 0.05).toFixed(2)); u.s += 1;
    const sym = ['💎', '💰', '7️⃣', '🍒', '⭐', '🍋'];
    const r = [sym[Math.floor(Math.random()*6)], sym[Math.floor(Math.random()*6)], sym[Math.floor(Math.random()*6)]];
    let win = 0; if (r[0] === r[1] && r[1] === r[2]) { win = 0.5; u.balance += win; u.w += 1; }
    await u.save(); res.json({ r, win, b: u.balance, s: u.s, w: u.w });
});

// === PREMIUM INTERFACE ===
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        :root { --accent: #ffd700; --blue: #00d4ff; --bg: #03060f; --card: #0c111d; --card-b: #1c2539; --text: #f0f0f0; --btn-start: #0077ff; --btn-end: #00d4ff; }
        * { box-sizing: border-box; }
        body { background: var(--bg); color: var(--text); font-family: -apple-system, sans-serif; margin: 0; padding: 20px; text-align: center; }
        
        /* Главные блоки */
        .card { background: var(--card); padding: 25px; border-radius: 30px; border: 1px solid var(--card-b); box-shadow: 0 10px 40px rgba(0,212,255,0.05); margin-bottom: 20px; }
        .bal-lbl { font-size: 11px; color: #a0a0a0; text-transform: uppercase; letter-spacing: 2px; }
        .bal { font-size: 52px; color: var(--blue); font-weight: 900; line-height: 1; margin: 10px 0; }
        .ton-small { font-size: 14px; font-weight: 600; vertical-align: middle; margin-left: -5px; color: #70b0ff; }

        /* Барабаны */
        .reels { display: flex; justify-content: center; gap: 12px; margin: 40px 0; }
        .reel { width: 90px; height: 115px; background: #000; border-radius: 20px; font-size: 50px; display: flex; align-items: center; justify-content: center; border: 2px solid var(--card-b); position: relative; overflow: hidden; }
        .reel::after { content:''; position:absolute; top:0; left:0; width:100%; height:100%; background:linear-gradient(to bottom, rgba(0,0,0,0.5), transparent 20%, transparent 80%, rgba(0,0,0,0.5)); }

        /* Кнопки */
        .btn { background: linear-gradient(135deg, var(--btn-start), var(--btn-end)); color: #fff; border: none; padding: 20px; width: 100%; border-radius: 40px; font-size: 20px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; box-shadow: 0 8px 30px rgba(0,119,255,0.25); transition: 0.2s; -webkit-tap-highlight-color: transparent; }
        .btn:active { transform: scale(0.97); box-shadow: 0 4px 15px rgba(0,119,255,0.1); }
        .btn-dep { background: linear-gradient(135deg, #18a34a, #15803d); box-shadow: 0 8px 30px rgba(24,163,74,0.15); margin-top: 15px; }
        .btn-dep:active { box-shadow: 0 4px 15px rgba(24,163,74,0.05); }

        /* Таб-бар */
        .nav { display: flex; background: var(--card); border-radius: 40px; margin-top: 30px; padding: 6px; border: 1px solid var(--card-b); }
        .tab { flex: 1; padding: 12px; font-size: 13px; opacity: 0.4; transition: 0.3s; color: var(--text); -webkit-tap-highlight-color: transparent; }
        .tab.active { opacity: 1; color: var(--blue); font-weight: 700; background: rgba(0,212,255,0.05); border-radius: 35px; }

        /* Настройки */
        .p-cnt { text-align: left; }
        .s-head { margin: 0 0 25px 0; font-size: 22px; color: var(--text); border-bottom: 1px solid var(--card-b); padding-bottom: 10px; }
        .s-row { display: flex; justify-content: space-between; align-items: center; padding: 15px 0; border-bottom: 1px solid #1a2335; }
        .st-card-gr { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .st-card { background: rgba(255,255,255,0.02); padding: 20px; border-radius: 20px; text-align: center; border: 1px solid var(--card-b); }
        .st-val { font-size: 30px; font-weight: 800; color: var(--blue); margin-top: 5px; }
        .st-win { color: #1db954; }

        /* Модалка */
        .modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.96); display: none; align-items: center; justify-content: center; z-index: 100; backdrop-filter: blur(5px); }
        .m-cnt { background: var(--card); width: 88%; padding: 35px; border-radius: 40px; border: 2px solid var(--blue); box-shadow: 0 20px 60px rgba(0,212,255,0.1); }
        .m-cnt h3 { margin-top: 0; color: #fff; font-size: 24px; }
        .copy { background: #000; padding: 15px; border-radius: 15px; font-size: 12px; margin: 15px 0; color: var(--blue); word-break: break-all; border: 1px solid var(--card-b); cursor: pointer; position: relative; }
        .copy::after { content: 'TAP TO COPY'; position: absolute; bottom: 2px; right: 8px; font-size: 8px; color: rgba(0,212,255,0.4); }
        .m-btn-z { background: var(--card-b); border: none; color: #fff; padding: 15px; width: 100%; border-radius: 20px; font-size: 16px; margin-top: 20px; -webkit-tap-highlight-color: transparent; }

        .hidden { display: none !important; }
    </style>
</head>
<body>
    <audio id="mus" loop src="https://files.catbox.moe/78surr.mp3"></audio>

    <div id="p-game">
        <div class="card">
            <div class="bal-lbl">VIP TON BALANCE</div>
            <div class="bal" id="v-bal">0.00 <span class="ton-small">TON</span></div>
        </div>
        <div class="reels">
            <div class="reel" id="r1">🎱</div><div class="reel" id="r2">🎱</div><div class="reel" id="r3">🎱</div>
        </div>
        <button class="btn" onclick="spin()">SPIN (0.05 TON)</button>
        <button class="btn btn-dep" onclick="shMod(1)">+ ПОПОЛНИТЬ</button>
    </div>

    <div id="p-settings" class="hidden p-cnt">
        <div class="card">
            <h3 class="s-head">⚙️ НАСТРОЙКИ</h3>
            <div class="s-row">
                <span>Sound & Atmosphere</span>
                <button onclick="tglM()" id="m-btn" style="background:var(--card-b); border:none; color:#fff; padding:8px 18px; border-radius:12px; font-size:12px;">OFF</button>
            </div>
            <div class="s-row">
                <span>VIP Support</span>
                <a href="https://t.me/venom142" style="color:var(--blue); text-decoration:none;">@venom142</a>
            </div>
        </div>
        <div class="card">
            <h3 class="s-head">📊 СТАТИСТИКА</h3>
            <div class="st-card-gr">
                <div class="st-card">
                    <div class="bal-lbl">TOTAL SPINS</div>
                    <div class="st-val" id="v-s">0</div>
                </div>
                <div class="st-card">
                    <div class="bal-lbl">TOTAL WINS</div>
                    <div class="st-val st-win" id="v-w">0</div>
                </div>
            </div>
        </div>
    </div>

    <div class="nav">
        <div class="tab active" id="t1" onclick="sw(1)">🎰 VIP HALL</div>
        <div class="tab" id="t2" onclick="sw(2)">⚙️ OPTIONS</div>
    </div>

    <div class="modal" id="mod">
        <div class="m-cnt">
            <h3>DEPOSIT TON</h3>
            <div class="copy" onclick="cp('${WALLET}')">${WALLET}</div>
            <p style="color:#ef4444; font-size:13px; font-weight:700; margin: 25px 0 5px 0;">COMMENT (REQUIRED):</p>
            <div class="copy" id="v-cid" style="font-size:20px; color:#fff; font-weight:900;" onclick="cp(this.innerText)">ID_...</div>
            <button class="m-btn-z" onclick="shMod(0)">[ CLOSE WINDOW ]</button>
        </div>
    </div>

    <script>
        const tg = window.Telegram.WebApp; tg.expand();
        const uid = tg.initDataUnsafe?.user?.id || "USER";
        const mu = document.getElementById('mus'); let mOn = false;

        async function init() {
            const r = await fetch('/api/init', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({uid}) });
            const d = await r.json(); upd(d);
        }

        function upd(d) {
            document.getElementById('v-bal').innerText = d.balance.toFixed(2) + ' TON';
            document.getElementById('v-s').innerText = d.s || 0;
            document.getElementById('v-w').innerText = d.w || 0;
            document.getElementById('v-cid').innerText = 'ID_' + uid;
        }

        async function spin() {
            tg.HapticFeedback.impactOccurred('medium');
            const r = await fetch('/api/spin', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({uid}) });
            const d = await r.json(); if(d.err) return tg.showAlert(d.err);
            
            let c = 0; const reels = [document.getElementById('r1'),document.getElementById('r2'),document.getElementById('r3')];
            const a = setInterval(() => {
                const s = ['🍒','7️⃣','💎','💰','⭐','🍋'];
                reels.forEach(re => re.innerText = s[Math.floor(Math.random()*6)]);
                if(c++ > 15) {
                    clearInterval(a);
                    reels[0].innerText = d.r[0]; reels[1].innerText = d.r[1]; reels[2].innerText = d.r[2];
                    upd(d); if(d.win > 0) { tg.HapticFeedback.notificationOccurred('success'); tg.showAlert("🔥 VIP WIN! +0.50 TON"); }
                }
            }, 60);
        }

        function sw(n) {
            document.getElementById('p-game').classList.toggle('hidden', n !== 1);
            document.getElementById('p-settings').classList.toggle('hidden', n !== 2);
            document.getElementById('t1').classList.toggle('active', n === 1);
            document.getElementById('t2').classList.toggle('active', n === 2);
            tg.HapticFeedback.impactOccurred('light');
        }
        function shMod(s) { document.getElementById('mod').style.display = s ? 'flex' : 'none'; tg.HapticFeedback.impactOccurred('light'); }
        function cp(t) { navigator.clipboard.writeText(t); tg.showAlert("Скопировано!"); tg.HapticFeedback.notificationOccurred('success'); }
        function tglM() {
            if(mOn) { mu.pause(); document.getElementById('m-btn').innerText="OFF"; }
            else { mu.play(); document.getElementById('m-btn').innerText="ON"; }
            mOn = !mOn; tg.HapticFeedback.impactOccurred('light');
        }
        init();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log("SERVER:READY"));
