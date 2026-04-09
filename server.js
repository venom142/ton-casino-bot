const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

const WALLET = "UQCy28DFTxwwmULQWw_53PvzuwZqj0spCe1vrUgYQtAvGfvn"; 
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = "mongodb+srv://sv2951605_db_user:zetatop123@cluster0.k5dri5s.mongodb.net/?appName=Cluster0";

mongoose.connect(MONGO_URI).then(() => console.log("БАЗА: ОК")).catch(() => console.log("БАЗА: ОШИБКА"));

const User = mongoose.model('User', { 
    uid: String, 
    balance: { type: Number, default: 0.10 }, 
    s: { type: Number, default: 0 }, 
    w: { type: Number, default: 0 }
});

const Tx = mongoose.model('Tx', { hash: String });
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
app.use(express.json());

bot.onText(/\/start/, async (m) => {
    let u = await User.findOne({ uid: m.from.id.toString() }) || await new User({ uid: m.from.id.toString() }).save();
    bot.sendMessage(m.chat.id, `💎 VIP TON ХОТ ТАП 💎\n\n💰 Твой баланс: ${u.balance.toFixed(2)} TON`, {
        reply_markup: { inline_keyboard: [[{ text: "🎰 ИГРАТЬ", web_app: { url: "https://ton-casino-bot.onrender.com" } }]] }
    });
});

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
                        bot.sendMessage(u.uid, `💎 Зачислено: +${val} TON!`);
                    }
                }
            }
        }
    } catch (e) {}
}, 15000);

app.post('/api/sync', async (req, res) => {
    const u = await User.findOne({ uid: req.body.uid.toString() }) || await new User({ uid: req.body.uid.toString() }).save();
    res.json(u);
});

app.post('/api/spin', async (req, res) => {
    const { uid, bet } = req.body;
    const bV = parseFloat(bet);
    const u = await User.findOne({ uid: uid.toString() });
    if (!u || u.balance < bV) return res.json({ err: "МАЛО TON" });
    u.balance = Number((u.balance - bV).toFixed(2)); u.s += 1;
    const syms = ['🍒','7️⃣','💎','💰','⭐','🎱'];
    const r = [syms[Math.floor(Math.random()*6)], syms[Math.floor(Math.random()*6)], syms[Math.floor(Math.random()*6)]];
    let win = (r[0] === r[1] && r[1] === r[2]) ? Number((bV * 10).toFixed(2)) : 0;
    if(win > 0) { u.balance += win; u.w += 1; }
    await u.save(); res.json({ r, win, balance: u.balance, s: u.s, w: u.w });
});

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; margin: 0; padding: 0; }
        body { 
            height: 100vh; width: 100vw; overflow: hidden; 
            background: radial-gradient(circle at center, #2e0052 0%, #03001c 100%); 
            color: #fff; font-family: sans-serif; display: flex; flex-direction: column; align-items: center;
        }
        .bg-grid { 
            position: absolute; top: -50%; left: -50%; right: -50%; bottom: -50%; 
            background-image: linear-gradient(rgba(110, 0, 255, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(110, 0, 255, 0.1) 1px, transparent 1px);
            background-size: 50px 50px; background-position: center; z-index: -1; 
            transform: perspective(300px) rotateX(60deg); animation: move 4s linear infinite;
        }
        @keyframes move { from { transform: perspective(300px) rotateX(60deg) translateY(0); } to { transform: perspective(300px) rotateX(60deg) translateY(50px); } }
        
        .nav { display: flex; gap: 8px; padding: 15px; width: 100%; max-width: 400px; z-index: 10; }
        .tab { flex: 1; padding: 12px; background: rgba(0,0,0,0.7); border: 1px solid #333; border-radius: 15px; font-size: 11px; font-weight: 800; color: #777; text-align: center; }
        .tab.active { border-color: #f0f; color: #fff; background: rgba(255,0,255,0.15); box-shadow: 0 0 10px rgba(255,0,255,0.2); }
        
        .main { flex: 1; display: flex; flex-direction: column; justify-content: space-around; align-items: center; width: 100%; padding: 0 20px 30px; z-index: 5; }
        .card { width: 100%; max-width: 360px; background: rgba(0,0,0,0.85); border: 1px solid #0ff; padding: 20px; border-radius: 25px; text-align: center; box-shadow: 0 0 20px rgba(0,255,255,0.2); }
        .bal-val { font-size: 48px; font-weight: 900; text-shadow: 0 0 15px #0ff; }
        
        .bets { display: flex; justify-content: center; gap: 8px; margin: 15px 0; width: 100%; }
        .b-btn { flex: 1; max-width: 80px; padding: 12px; background: #111; border: 1px solid #444; border-radius: 12px; color: #888; font-weight: 800; font-size: 13px; }
        .b-btn.active { border-color: #0ff; color: #0ff; background: rgba(0,255,255,0.1); }
        
        .reels { display: flex; gap: 10px; margin: 10px 0; }
        .r-win { width: 95px; height: 95px; background: #000; border: 3px solid #f0f; border-radius: 20px; overflow: hidden; position: relative; box-shadow: inset 0 0 15px rgba(255,0,255,0.4); }
        .r-strip { position: absolute; width: 100%; top: 0; }
        .sym { height: 95px; display: flex; align-items: center; justify-content: center; font-size: 50px; }
        .blur { filter: blur(5px); }
        
        .btn-spin { width: 100%; max-width: 360px; padding: 22px; border-radius: 22px; border: none; background: linear-gradient(135deg, #f0f, #70f); color: #fff; font-size: 24px; font-weight: 900; box-shadow: 0 8px 20px rgba(255,0,255,0.3); transition: 0.2s; }
        .btn-spin:active { transform: translateY(3px); }
        .btn-spin:disabled { opacity: 0.5; filter: grayscale(1); }
        
        .hidden { display: none !important; }
        .copy-box { background: #111; padding: 15px; border-radius: 15px; border: 1px solid #333; margin-top: 10px; cursor: pointer; text-align: left; }
        .copy-val { font-family: monospace; font-size: 12px; color: #0ff; word-break: break-all; }
    </style>
</head>
<body>
    <div class="bg-grid"></div>
    <div class="nav">
        <div class="tab active" onclick="sw(1)" id="t1">ИГРА</div>
        <div class="tab" onclick="sw(2)" id="t2">ПОПОЛНИТЬ</div>
        <div class="tab" onclick="sw(3)" id="t3">ИНФО</div>
    </div>
    <div class="main">
        <div id="p1" style="width:100%; display:flex; flex-direction:column; align-items:center;">
            <div class="card"><p style="font-size:11px; opacity:0.6; text-transform:uppercase;">Твой баланс TON</p><div class="bal-val" id="v-bal">0.00</div></div>
            <div class="bets">
                <button class="b-btn active" onclick="sB(0.01,this)">0.01</button>
                <button class="b-btn" onclick="sB(0.1,this)">0.10</button>
                <button class="b-btn" onclick="sB(0.5,this)">0.50</button>
                <button class="b-btn" onclick="sB(1.0,this)">1.00</button>
            </div>
            <div class="reels">
                <div class="r-win"><div class="r-strip" id="rs1"></div></div>
                <div class="r-win"><div class="r-strip" id="rs2"></div></div>
                <div class="r-win"><div class="r-strip" id="rs3"></div></div>
            </div>
            <button id="s-btn" class="btn-spin" onclick="spin()">ЖМИ ТАП!</button>
        </div>
        <div id="p2" class="hidden" style="width:100%; max-width:360px;">
            <div class="card" style="text-align:left;">
                <h3 style="color:#0ff; margin-bottom:15px;">ПОПОЛНЕНИЕ</h3>
                <p style="font-size:12px; opacity:0.7;">Адрес кошелька (нажми):</p>
                <div class="copy-box" onclick="cp('${WALLET}')"><div class="copy-val">${WALLET}</div></div>
                <p style="font-size:12px; opacity:0.7; margin-top:15px;">Комментарий к переводу (ID):</p>
                <div class="copy-box" id="v-cid" onclick="cp(this.innerText)"><div class="copy-val">ID_...</div></div>
            </div>
        </div>
        <div id="p3" class="hidden" style="width:100%; max-width:360px;">
            <div class="card"><h3>СТАТИСТИКА</h3><p style="margin-top:15px;">Сделано тапов: <span id="v-s">0</span></p><p>Всего побед: <span id="v-w" style="color:#0f0;">0</span></p></div>
        </div>
    </div>
    <script>
        const tg = window.Telegram.WebApp; tg.expand();
        const uid = tg.initDataUnsafe?.user?.id || "123";
        let cBet = 0.01;
        const syms = ['🍒','7️⃣','💎','💰','⭐','🎱'];
        function sB(v,e){ cBet=v; document.querySelectorAll('.b-btn').forEach(b=>b.classList.remove('active')); e.classList.add('active'); tg.HapticFeedback.impactOccurred('light'); }
        function init(){ [1,2,3].forEach(id=>{ const s=document.getElementById('rs'+id); s.innerHTML=''; for(let i=0;i<30;i++){ const d=document.createElement('div'); d.className='sym'; d.innerText=syms[Math.floor(Math.random()*6)]; s.appendChild(d); } }); }
        init();
        async function sync(){
            try {
                const r = await fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid})});
                const d = await r.json();
                document.getElementById('v-bal').innerText = d.balance.toFixed(2);
                document.getElementById('v-s').innerText = d.s; document.getElementById('v-w').innerText = d.w;
                document.getElementById('v-cid').innerHTML = '<div class="copy-val">ID_'+uid+'</div>';
            } catch(e){}
        }
        async function spin(){
            const btn = document.getElementById('s-btn'); btn.disabled = true; tg.HapticFeedback.impactOccurred('heavy');
            try {
                const r = await fetch('/api/spin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid,bet:cBet})});
                const d = await r.json();
                if(d.err){ btn.disabled=false; return tg.showAlert(d.err); }
                [1,2,3].forEach((id,i)=>{
                    const s = document.getElementById('rs'+id); s.classList.add('blur');
                    s.lastElementChild.innerText = d.r[i];
                    s.style.transition = 'none'; s.style.transform = 'translateY(0)';
                    setTimeout(()=>{ s.style.transition = 'transform '+(1.5+i*0.5)+'s cubic-bezier(.45,.05,.55,.95)'; s.style.transform = 'translateY(-2755px)'; },50);
                    setTimeout(()=>{ s.classList.remove('blur'); if(i===2){ sync(); btn.disabled=false; if(d.win>0){ tg.HapticFeedback.notificationOccurred('success'); tg.showAlert("ВИН: "+d.win+" TON!"); } } },2000+i*500);
                });
            } catch(e){ btn.disabled=false; }
        }
        function sw(n){ [1,2,3].forEach(i=>{ document.getElementById('p'+i).classList.toggle('hidden',i!==n); document.getElementById('t'+i).classList.toggle('active',i===n); }); tg.HapticFeedback.impactOccurred('medium'); }
        function cp(t){ navigator.clipboard.writeText(t); tg.showAlert("Скопировано!"); }
        setInterval(sync, 5000); sync();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log("СЕРВЕР ЗАПУЩЕН"));
