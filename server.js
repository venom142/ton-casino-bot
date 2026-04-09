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

// === БОТ ===
bot.onText(/\/start/, async (m) => {
    let u = await User.findOne({ uid: m.from.id.toString() }) || await new User({ uid: m.from.id.toString() }).save();
    bot.sendMessage(m.chat.id, `💎 VIP TON ХОТ ТАП 💎\n\n💰 Ваш баланс: ${u.balance.toFixed(2)} TON`, {
        reply_markup: { inline_keyboard: [[{ text: "🎰 ИГРАТЬ СЕЙЧАС", web_app: { url: "https://ton-casino-bot.onrender.com" } }]] }
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
                        bot.sendMessage(u.uid, `💎 Пополнение: +${val} TON!`);
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
    const bV = parseFloat(bet);
    if (![0.01, 0.1, 0.5, 1.0].includes(bV)) return res.json({ err: "ВЫБЕРИТЕ СТАВКУ" });
    const u = await User.findOne({ uid: uid.toString() });
    if (!u || u.balance < bV) return res.json({ err: "НЕДОСТАТОЧНО TON" });

    u.balance = Number((u.balance - bV).toFixed(2)); u.s += 1;
    const syms = ['🍒','7️⃣','💎','💰','⭐','🎱'];
    const r = [syms[Math.floor(Math.random()*6)], syms[Math.floor(Math.random()*6)], syms[Math.floor(Math.random()*6)]];
    let win = (r[0] === r[1] && r[1] === r[2]) ? Number((bV * 10).toFixed(2)) : 0;
    if(win > 0) { u.balance += win; u.w += 1; }
    await u.save(); res.json({ r, win, balance: u.balance, s: u.s, w: u.w });
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
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; margin: 0; padding: 0; }
        body { height: 100vh; width: 100vw; overflow: hidden; background: radial-gradient(circle at center, #2e0052 0%, #03001c 100%); color: #fff; font-family: sans-serif; display: flex; flex-direction: column; position: relative; }
        
        .bg-grid { position: absolute; top: -50%; left: -50%; right: -50%; bottom: -50%; background-image: linear-gradient(rgba(110, 0, 255, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(110, 0, 255, 0.1) 1px, transparent 1px); background-size: 50px 50px; background-position: center; z-index: -1; transform: perspective(300px) rotateX(60deg); animation: grid-move 4s linear infinite; }
        @keyframes grid-move { from { transform: perspective(300px) rotateX(60deg) translateY(0); } to { transform: perspective(300px) rotateX(60deg) translateY(50px); } }

        .nav { display: flex; gap: 6px; padding: 12px; z-index: 10; }
        .tab { flex: 1; padding: 12px; background: rgba(0,0,0,0.7); border: 1px solid #333; border-radius: 14px; font-size: 10px; font-weight: 800; color: #777; text-align: center; transition: 0.3s; }
        .tab.active { border-color: #f0f; color: #fff; background: rgba(255,0,255,0.15); box-shadow: 0 0 10px rgba(255,0,255,0.2); }
        
        .main { flex: 1; display: flex; flex-direction: column; justify-content: space-around; padding: 0 20px 30px; z-index: 5; align-items: center; }
        .card { width: 100%; max-width: 380px; background: rgba(0,0,0,0.85); border: 1px solid #0ff; padding: 20px; border-radius: 24px; text-align: center; box-shadow: 0 0 20px rgba(0,255,255,0.15); }
        .bal-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; opacity: 0.6; margin-bottom: 5px; }
        .bal-val { font-size: 44px; font-weight: 900; color: #fff; text-shadow: 0 0 15px #0ff; }
        
        .bets { display: flex; justify-content: space-between; gap: 8px; margin: 15px 0; width: 100%; max-width: 380px; }
        .b-btn { flex: 1; padding: 12px; background: #111; border: 1px solid #444; border-radius: 12px; color: #888; font-size: 13px; font-weight: 800; transition: 0.2s; }
        .b-btn.active { border-color: #0ff; color: #0ff; background: rgba(0,255,255,0.1); }
        
        .reels { display: flex; justify-content: center; gap: 10px; margin: 15px 0; width: 100%; max-width: 380px; }
        .r-win { width: 30%; height: 90px; background: #000; border: 2.5px solid #f0f; border-radius: 18px; overflow: hidden; position: relative; box-shadow: inset 0 0 15px rgba(255,0,255,0.4); }
        .r-strip { position: absolute; width: 100%; top: 0; display: flex; flex-direction: column; align-items: center; }
        .sym { height: 90px; display: flex; align-items: center; justify-content: center; font-size: 45px; }
        .blur { filter: blur(5px); }
        
        .btn-spin { width: 100%; max-width: 380px; padding: 22px; border-radius: 20px; border: none; background: linear-gradient(135deg, #ff00ff, #7000ff); color: #fff; font-size: 22px; font-weight: 900; text-transform: uppercase; box-shadow: 0 8px 20px rgba(255, 0, 255, 0.3); transition: 0.2s; }
        .btn-spin:active { transform: translateY(2px); box-shadow: 0 4px 10px rgba(255, 0, 255, 0.3); }
        .btn-spin:disabled { opacity: 0.5; filter: grayscale(1); }
        
        .hidden { display: none !important; }
        .copy-card { background: #111; padding: 15px; border-radius: 14px; border: 1px solid #333; margin-top: 10px; cursor: pointer; }
        .copy-val { font-family: monospace; font-size: 12px; color: #0ff; word-break: break-all; }
        .stat-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #222; }
    </style>
</head>
<body>
    <div class="bg-grid"></div>
    <audio id="mus" loop src="https://files.catbox.moe/78surr.mp3"></audio>
    
    <div class="nav">
        <div class="tab active" onclick="sw(1)" id="t1">ИГРА</div>
        <div class="tab" onclick="sw(4)" id="t4">ПОПОЛНИТЬ</div>
        <div class="tab" onclick="sw(2)" id="t2">ИНФО</div>
        <div class="tab" onclick="sw(3)" id="t3">ОПЦИИ</div>
    </div>

    <div class="main">
        <div id="p-game" style="width:100%; display:flex; flex-direction:column; align-items:center;">
            <div class="card">
                <div class="bal-label">ВАШ БАЛАНС TON</div>
                <div class="bal-val" id="v-bal">0.00</div>
            </div>
            
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
            
            <button id="spin-btn" class="btn-spin" onclick="spin()">ИСПЫТАТЬ УДАЧУ</button>
        </div>

        <div id="p-dep" class="hidden" style="width:100%; max-width:380px;">
            <div class="card" style="text-align: left;">
                <h3 style="color:#0ff; margin-bottom:15px;">ПОПОЛНЕНИЕ</h3>
                <p style="font-size:12px; opacity:0.6;">Адрес кошелька (нажми для копирования):</p>
                <div class="copy-card" onclick="cp('${WALLET}')">
                    <div class="copy-val">${WALLET}</div>
                </div>
                <p style="font-size:12px; opacity:0.6; margin-top:15px;">Ваш ID (ОБЯЗАТЕЛЬНО в комментарий):</p>
                <div class="copy-card" id="v-cid" onclick="cp(this.innerText)">ID_...</div>
            </div>
        </div>

        <div id="p-stat" class="hidden" style="width:100%; max-width:380px;">
            <div class="card">
                <h3 style="margin-bottom:15px;">СТАТИСТИКА</h3>
                <div class="stat-row"><span>Всего игр:</span><span id="v-s">0</span></div>
                <div class="stat-row"><span>Побед:</span><span id="v-w" style="color:#0f0;">0</span></div>
            </div>
        </div>

        <div id="p-set" class="hidden" style="width:100%; max-width:380px;">
            <div class="card">
                <button class="btn-spin" style="margin-bottom:15px; background: rgba(255,255,255,0.05); border: 1px solid #444;" onclick="tM()" id="m-btn">МУЗЫКА: ВЫКЛ</button>
                <button class="btn-spin" style="background:#0ff; color:#000;" onclick="aP()">ВВЕСТИ ПРОМОКОД</button>
            </div>
        </div>
    </div>

    <script>
        const tg = window.Telegram.WebApp; tg.expand();
        const uid = tg.initDataUnsafe?.user?.id || "12345";
        let cB = 0.01, mO = false;
        const syms = ['🍒','7️⃣','💎','💰','⭐','🎱'];

        function sB(v,e){ cB=v; document.querySelectorAll('.b-btn').forEach(b=>b.classList.remove('active')); e.classList.add('active'); tg.HapticFeedback.impactOccurred('light'); }
        
        function init(){ 
            [1,2,3].forEach(id=>{ 
                const s=document.getElementById('rs'+id); s.innerHTML=''; 
                for(let i=0;i<30;i++){ 
                    const d=document.createElement('div'); d.className='sym'; 
                    d.innerText=syms[Math.floor(Math.random()*6)]; s.appendChild(d); 
                } 
            }); 
        }
        init();

        async function sync(){
            const r = await fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid})});
            const d = await r.json();
            document.getElementById('v-bal').innerText = d.balance.toFixed(2);
            document.getElementById('v-s').innerText = d.s; document.getElementById('v-w').innerText = d.w;
            document.getElementById('v-cid').innerText = 'ID_'+uid;
        }

        async function spin(){
            const btn = document.getElementById('spin-btn'); btn.disabled = true; tg.HapticFeedback.impactOccurred('heavy');
            try {
                const r = await fetch('/api/spin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid,bet:cB})});
                const d = await r.json();
                if(d.err){ btn.disabled=false; return tg.showAlert(d.err); }
                [1,2,3].forEach((id,i)=>{
                    const s = document.getElementById('rs'+id); s.classList.add('blur');
                    s.lastElementChild.innerText = d.r[i];
                    s.style.transition = 'none'; s.style.transform = 'translateY(0)';
                    setTimeout(()=>{ 
                        s.style.transition = 'transform '+(1.5+i*0.5)+'s cubic-bezier(.45,.05,.55,.95)'; 
                        s.style.transform = 'translateY(-2610px)'; /* 29 sym * 90px */
                    },50);
                    setTimeout(()=>{ 
                        s.classList.remove('blur'); 
                        if(i===2){ sync(); btn.disabled=false; if(d.win>0){ tg.HapticFeedback.notificationOccurred('success'); tg.showConfirm("🎉 ПОБЕДА! Вы выиграли "+d.win+" TON!"); } } 
                    },2000+i*500);
                });
            } catch(e){ btn.disabled=false; }
        }

        function sw(n){ 
            document.getElementById('p-game').classList.toggle('hidden',n!==1); 
            document.getElementById('p-dep').classList.toggle('hidden',n!==4); 
            document.getElementById('p-stat').classList.toggle('hidden',n!==2); 
            document.getElementById('p-set').classList.toggle('hidden',n!==3); 
            [1,2,3,4].forEach(i=>document.getElementById('t'+i).classList.toggle('active',n===i)); 
            tg.HapticFeedback.impactOccurred('medium'); 
        }

        function tM(){ const m=document.getElementById('mus'); if(mO)m.pause();else m.play(); mO=!mO; document.getElementById('m-btn').innerText=mO?"МУЗЫКА: ВКЛ":"МУЗЫКА: ВЫКЛ"; }
        function cp(t){ navigator.clipboard.writeText(t); tg.showAlert("Скопировано!"); }
        async function aP(){ const c=prompt("Введите промокод:"); if(!c)return; const r=await fetch('/api/promo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid,code:c})}); const d=await r.json(); if(d.err)tg.showAlert(d.err); else{ tg.showAlert("✅ Бонус начислен!"); sync(); } }
        
        setInterval(sync, 5000); sync();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log("SERVER LIVE"));
