const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

const WALLET = "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn"; 
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = "mongodb+srv://sv2951605_db_user:zetatop123@cluster0.k5dri5s.mongodb.net/?appName=Cluster0";
const ADMIN_ID = 8475323865; 

mongoose.connect(MONGO_URI).then(() => console.log("DB: OK")).catch(() => console.log("DB: ERR"));

const User = mongoose.model('User', { 
    uid: String, 
    balance: { type: Number, default: 0.10 }, 
    s: { type: Number, default: 0 }, 
    w: { type: Number, default: 0 },
    promo: { type: [String], default: [] } 
});

const Promo = mongoose.model('Promo', {
    code: { type: String, uppercase: true, unique: true },
    amount: Number,
    limit: { type: Number, default: 1 },
    used: { type: Number, default: 0 }
});

const Tx = mongoose.model('Tx', { hash: String });
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
app.use(express.json());

// === АДМИНКА ===
bot.onText(/\/addpromo (.+) (.+) (.+)/, async (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;
    const code = match[1].toUpperCase();
    const amount = parseFloat(match[2]);
    const limit = parseInt(match[3]);
    try {
        await new Promo({ code, amount, limit }).save();
        bot.sendMessage(msg.chat.id, `✅ Промо **${code}** создан на **${amount} TON**`);
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ Ошибка"); }
});

bot.onText(/\/start/, async (m) => {
    let u = await User.findOne({ uid: m.from.id.toString() }) || await new User({ uid: m.from.id.toString() }).save();
    bot.sendMessage(m.chat.id, `💎 VIP TON ХОТ ТАП 💎\n\n💰 Баланс: ${u.balance.toFixed(2)} TON`, {
        reply_markup: { inline_keyboard: [[{ text: "🚀 ИГРАТЬ", web_app: { url: "https://ton-casino-bot.onrender.com" } }]] }
    });
});

// === СКАНЕР ДЕПОЗИТОВ ===
setInterval(async () => {
    try {
        const res = await axios.get(`https://toncenter.com/api/v2/getTransactions?address=${WALLET}&limit=5`);
        for (let tx of res.data.result) {
            const h = tx.transaction_id.hash;
            const m = tx.in_msg?.message;
            const val = tx.in_msg.value / 1e9;
            if (m && m.startsWith("ID_")) {
                if (await Tx.findOne({ hash: h })) continue;
                if (val >= 0.01) {
                    const u = await User.findOne({ uid: m.split("_")[1] });
                    if (u) {
                        u.balance = Number((u.balance + val).toFixed(2));
                        await u.save(); await new Tx({ hash: h }).save();
                        bot.sendMessage(u.uid, `💎 +${val} TON на балансе!`);
                    }
                }
            }
        }
    } catch (e) {}
}, 15000);

// === API ===
app.post('/api/sync', async (req, res) => {
    const u = await User.findOne({ uid: req.body.uid.toString() }) || await new User({ uid: req.body.uid.toString() }).save();
    res.json(u);
});

app.post('/api/spin', async (req, res) => {
    const { uid, bet } = req.body;
    const betVal = parseFloat(bet);
    if (![0.01, 0.1, 0.5, 1.0].includes(betVal)) return res.json({ err: "НЕВЕРНАЯ СТАВКА" });

    const u = await User.findOne({ uid: uid.toString() });
    if (!u || u.balance < betVal) return res.json({ err: "МАЛО TON" });

    u.balance = Number((u.balance - betVal).toFixed(2)); u.s += 1;
    const syms = ['🍒','7️⃣','💎','💰','⭐','🎱'];
    const r = [syms[Math.floor(Math.random()*6)], syms[Math.floor(Math.random()*6)], syms[Math.floor(Math.random()*6)]];
    
    let win = 0; 
    if (r[0] === r[1] && r[1] === r[2]) { 
        win = Number((betVal * 10).toFixed(2)); // Выигрыш x10
        u.balance += win; u.w += 1; 
    }
    
    await u.save(); 
    res.json({ r, win, balance: u.balance, s: u.s, w: u.w });
});

app.post('/api/promo', async (req, res) => {
    const { uid, code } = req.body;
    const u = await User.findOne({ uid: uid.toString() });
    const pr = await Promo.findOne({ code: code.toUpperCase().trim() });
    if (!u || !pr || u.promo.includes(pr.code) || pr.used >= pr.limit) return res.json({ err: "ОШИБКА" });
    u.balance = Number((u.balance + pr.amount).toFixed(2));
    u.promo.push(pr.code); pr.used += 1;
    await u.save(); await pr.save();
    res.json({ ok: true, bonus: pr.amount, balance: u.balance });
});

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; margin: 0; padding: 0; }
        body { height: 100vh; overflow: hidden; background: radial-gradient(circle at center, #2e0052 0%, #03001c 100%); color: #fff; font-family: sans-serif; display: flex; flex-direction: column; }
        .bg-grid { position: absolute; top: -50%; left: -50%; right: -50%; bottom: -50%; background-image: linear-gradient(rgba(110, 0, 255, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(110, 0, 255, 0.1) 1px, transparent 1px); background-size: 50px 50px; z-index: -1; transform: perspective(500px) rotateX(60deg); animation: grid-move 3s linear infinite; }
        @keyframes grid-move { from { transform: perspective(500px) rotateX(60deg) translateY(0); } to { transform: perspective(500px) rotateX(60deg) translateY(50px); } }
        .nav-top { display: flex; gap: 5px; padding: 10px; z-index: 10; }
        .tab { flex: 1; padding: 12px; background: rgba(0,0,0,0.6); border: 1px solid #333; border-radius: 12px; font-size: 10px; font-weight: 800; color: #666; text-transform: uppercase; text-align: center; }
        .tab.active { border-color: #f0f; color: #fff; background: rgba(255,0,255,0.1); }
        .main-container { flex: 1; display: flex; flex-direction: column; justify-content: space-around; padding: 0 15px 25px; z-index: 5; }
        .card { background: rgba(0,0,0,0.85); border: 1px solid #0ff; padding: 15px; border-radius: 20px; text-align: center; }
        .bal { font-size: 40px; font-weight: 900; color: #fff; text-shadow: 0 0 10px #0ff; }
        
        /* СТАВКИ */
        .bet-selector { display: flex; justify-content: space-between; gap: 5px; margin: 10px 0; }
        .bet-btn { flex: 1; padding: 10px; background: #111; border: 1px solid #444; border-radius: 10px; color: #888; font-weight: bold; font-size: 12px; }
        .bet-btn.active { border-color: #0ff; color: #0ff; background: rgba(0,255,255,0.1); }

        /* РУЛЕТКА */
        .reels { display: flex; justify-content: center; gap: 8px; margin: 10px 0; }
        .reel-window { width: 30%; height: 80px; background: #000; border: 2px solid #f0f; border-radius: 15px; overflow: hidden; position: relative; box-shadow: inset 0 0 10px #f0f; }
        .reel-strip { position: absolute; width: 100%; display: flex; flex-direction: column; align-items: center; top: 0; }
        .symbol { height: 80px; display: flex; align-items: center; justify-content: center; font-size: 40px; }
        .blur { filter: blur(4px); }

        .btn-spin { width: 100%; padding: 20px; border-radius: 18px; border: none; background: linear-gradient(135deg, #ff00ff, #6e00ff); color: #fff; font-size: 20px; font-weight: 900; text-transform: uppercase; box-shadow: 0 0 15px rgba(255, 0, 255, 0.4); }
        .copy-box { background: #111; padding: 10px; border-radius: 10px; font-family: monospace; font-size: 11px; color: #0ff; border: 1px solid #333; margin-top: 5px; word-break: break-all; }
        .hidden { display: none !important; }
        .set-btn { width: 100%; padding: 15px; background: rgba(255,255,255,0.05); border: 1px solid #444; border-radius: 12px; color: #fff; margin-top: 10px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="bg-grid"></div>
    <audio id="bg-mus" loop src="https://files.catbox.moe/78surr.mp3"></audio>
    <div class="nav-top">
        <div class="tab active" id="t1" onclick="sw(1)">ИГРА</div>
        <div class="tab" id="t4" onclick="sw(4)">ДЕПОЗИТ</div>
        <div class="tab" id="t2" onclick="sw(2)">ИНФО</div>
        <div class="tab" id="t3" onclick="sw(3)">ОПЦИИ</div>
    </div>
    <div class="main-container">
        <div id="p-game">
            <div class="card"><p style="font-size:10px; opacity:0.5;">БАЛАНС TON</p><div class="bal" id="v-bal">0.00</div></div>
            
            <div class="bet-selector">
                <button class="bet-btn active" onclick="setBet(0.01, this)">0.01</button>
                <button class="bet-btn" onclick="setBet(0.1, this)">0.10</button>
                <button class="bet-btn" onclick="setBet(0.5, this)">0.50</button>
                <button class="bet-btn" onclick="setBet(1.0, this)">1.00</button>
            </div>

            <div class="reels">
                <div class="reel-window"><div class="reel-strip" id="rs1"></div></div>
                <div class="reel-window"><div class="reel-strip" id="rs2"></div></div>
                <div class="reel-window"><div class="reel-strip" id="rs3"></div></div>
            </div>
            <button id="spin-btn" class="btn-spin" onclick="spin()">ИГРАТЬ</button>
        </div>
        
        <div id="p-dep" class="hidden">
            <div class="card" style="text-align: left;">
                <h3 style="color:#0ff;">ДЕПОЗИТ</h3>
                <p style="font-size:10px; margin-bottom:5px;">Отправь TON на адрес с ID в комментарии:</p>
                <div class="copy-box" onclick="cp('${WALLET}')">${WALLET}</div>
                <div class="copy-box" id="v-cid" onclick="cp(this.innerText)">ID_...</div>
            </div>
        </div>
        <div id="p-stat" class="hidden"><div class="card" style="text-align: left;"><h3>СТАТЫ</h3><p>Игр: <span id="v-s">0</span></p><p>Побед: <span id="v-w">0</span></p></div></div>
        <div id="p-set" class="hidden"><div class="card"><button class="set-btn" onclick="tglM()" id="m-btn">🔊 МУЗЫКА: ВЫКЛ</button><button class="set-btn" style="background:#0ff; color:#000;" onclick="askPromo()">🎟 ПРОМОКОД</button></div></div>
    </div>

    <script>
        const tg = window.Telegram.WebApp; tg.expand();
        const uid = tg.initDataUnsafe?.user?.id || "12345";
        const mus = document.getElementById('bg-mus');
        let mOn = false; let currentBet = 0.01;
        const syms = ['🍒','7️⃣','💎','💰','⭐','🎱'];

        function setBet(v, el) {
            currentBet = v;
            document.querySelectorAll('.bet-btn').forEach(b => b.classList.remove('active'));
            el.classList.add('active');
            tg.HapticFeedback.impactOccurred('light');
        }

        function initReels() {
            [1,2,3].forEach(id => {
                const s = document.getElementById('rs'+id);
                s.innerHTML = '';
                for(let i=0; i<30; i++) {
                    const div = document.createElement('div');
                    div.className = 'symbol';
                    div.innerText = syms[Math.floor(Math.random()*6)];
                    s.appendChild(div);
                }
            });
        }
        initReels();

        async function sync() {
            const r = await fetch('/api/sync', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({uid}) });
            const d = await r.json();
            document.getElementById('v-bal').innerText = d.balance.toFixed(2);
            document.getElementById('v-s').innerText = d.s; document.getElementById('v-w').innerText = d.w;
            document.getElementById('v-cid').innerText = 'ID_' + uid;
        }

        async function spin() {
            const btn = document.getElementById('spin-btn');
            btn.disabled = true;
            tg.HapticFeedback.impactOccurred('heavy');

            try {
                const r = await fetch('/api/spin', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({uid, bet: currentBet}) });
                const d = await r.json();
                if(d.err) { btn.disabled = false; return tg.showAlert(d.err); }

                [1,2,3].forEach((id, i) => {
                    const strip = document.getElementById('rs'+id);
                    strip.classList.add('blur');
                    strip.lastElementChild.innerText = d.r[i];
                    strip.style.transition = 'none';
                    strip.style.transform = 'translateY(0)';
                    
                    setTimeout(() => {
                        strip.style.transition = 'transform ' + (1.0 + i*0.3) + 's cubic-bezier(0.45, 0.05, 0.55, 0.95)';
                        strip.style.transform = 'translateY(-2320px)'; // 29 символов * 80px
                    }, 50);

                    setTimeout(() => {
                        strip.classList.remove('blur');
                        if(i === 2) {
                            sync(); btn.disabled = false;
                            if(d.win > 0) { tg.HapticFeedback.notificationOccurred('success'); tg.showAlert("🔥 ВЫИГРЫШ: " + d.win + " TON!"); }
                        }
                    }, 1300 + i*300);
                });
            } catch (e) { btn.disabled = false; }
        }

        function sw(n) {
            document.getElementById('p-game').classList.toggle('hidden', n !== 1);
            document.getElementById('p-stat').classList.toggle('hidden', n !== 2);
            document.getElementById('p-set').classList.toggle('hidden', n !== 3);
            document.getElementById('p-dep').classList.toggle('hidden', n !== 4);
            [1,2,3,4].forEach(i => document.getElementById('t'+i).classList.toggle('active', n === i));
        }
        function tglM() { if(mOn) mus.pause(); else mus.play(); mOn = !mOn; document.getElementById('m-btn').innerText = mOn ? "🔊 МУЗЫКА: ВКЛ" : "🔊 МУЗЫКА: ВЫКЛ"; }
        function cp(t) { navigator.clipboard.writeText(t); tg.showAlert("Скопировано!"); }
        async function askPromo() {
            const code = prompt("Код:"); if (!code) return;
            const r = await fetch('/api/promo', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({uid, code}) });
            const d = await r.json();
            if (d.err) tg.showAlert(d.err); else { tg.showAlert("✅ Успешно!"); sync(); }
        }
        setInterval(sync, 5000); sync();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log("SERVER LIVE V0.2"));
