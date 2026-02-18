import express from "express";
import TelegramBot from "node-telegram-bot-api";
import Database from "better-sqlite3";
import axios from "axios";
import crypto from "crypto";

// =====================
// ENV
// =====================
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const TON_WALLET = process.env.TON_WALLET;
const TON_API_KEY = process.env.TON_API_KEY;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN || !ADMIN_ID || !TON_WALLET || !TON_API_KEY) {
  console.error("❌ Missing ENV variables");
  process.exit(1);
}

// =====================
// INIT
// =====================
const app = express();
app.use(express.json());

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const db = new Database("casino.db");

// =====================
// DATABASE
// =====================
db.prepare(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  balance REAL DEFAULT 0,
  last_spin INTEGER DEFAULT 0
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  amount REAL,
  result REAL,
  created_at INTEGER
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  tx_hash TEXT UNIQUE,
  amount REAL,
  created_at INTEGER
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS promos (
  code TEXT PRIMARY KEY,
  amount REAL,
  uses INTEGER DEFAULT 0,
  max_uses INTEGER
)
`).run();

// =====================
// HELPER FUNCTIONS
// =====================
function getUser(userId) {
  let user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) {
    db.prepare("INSERT INTO users (id, balance) VALUES (?, 0)").run(userId);
    user = { id: userId, balance: 0, last_spin: 0 };
  }
  return user;
}

function updateBalance(userId, amount) {
  db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?")
    .run(amount, userId);
}

function setLastSpin(userId) {
  db.prepare("UPDATE users SET last_spin = ? WHERE id = ?")
    .run(Date.now(), userId);
}

// =====================
// TELEGRAM START
// =====================
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  getUser(userId);

  bot.sendMessage(chatId, "💎 VIP TON CASINO", {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "🎰 Открыть казино",
            web_app: { url: process.env.WEB_URL || "https://example.com" }
          }
        ]
      ]
    }
  });
});

// =====================
// ANTI CRASH
// =====================
process.on("uncaughtException", (err) => {
  console.error("Uncaught:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled:", err);
});

// =====================
// START SERVER
// =====================
app.listen(PORT, () => {
  console.log("🔥 VIP CASINO STARTED ON PORT", PORT);
});

// =====================
// GAME LOGIC
// =====================

const SPIN_COOLDOWN = 2000; // 2 сек антиспам
const MIN_BET = 0.1;
const MAX_BET = 100;

function spinSlots() {
  const symbols = ["💎", "👑", "💰", "🔥", "⭐"];
  const r1 = symbols[Math.floor(Math.random() * symbols.length)];
  const r2 = symbols[Math.floor(Math.random() * symbols.length)];
  const r3 = symbols[Math.floor(Math.random() * symbols.length)];

  let multiplier = 0;

  if (r1 === r2 && r2 === r3) {
    if (r1 === "💎") multiplier = 5;
    else if (r1 === "👑") multiplier = 4;
    else multiplier = 3;
  } else if (r1 === r2 || r2 === r3 || r1 === r3) {
    multiplier = 1.5;
  }

  return {
    reels: [r1, r2, r3],
    multiplier
  };
}

// =====================
// SPIN API
// =====================
app.post("/spin", (req, res) => {
  try {
    const { userId, bet } = req.body;

    if (!userId || !bet) return res.status(400).json({ error: "Invalid" });

    const user = getUser(userId);

    if (Date.now() - user.last_spin < SPIN_COOLDOWN) {
      return res.status(429).json({ error: "Too fast" });
    }

    if (bet < MIN_BET || bet > MAX_BET) {
      return res.status(400).json({ error: "Invalid bet" });
    }

    if (user.balance < bet) {
      return res.status(400).json({ error: "No balance" });
    }

    const result = spinSlots();

    updateBalance(userId, -bet);

    let win = 0;
    if (result.multiplier > 0) {
      win = bet * result.multiplier;
      updateBalance(userId, win);
    }

    setLastSpin(userId);

    db.prepare(`
      INSERT INTO bets (user_id, amount, result, created_at)
      VALUES (?, ?, ?, ?)
    `).run(userId, bet, win, Date.now());

    res.json({
      reels: result.reels,
      win,
      balance: getUser(userId).balance
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// =====================
// HISTORY API
// =====================
app.get("/history/:userId", (req, res) => {
  const { userId } = req.params;

  const rows = db.prepare(`
    SELECT amount, result, created_at
    FROM bets
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 20
  `).all(userId);

  res.json(rows);
});

// =====================
// PROMO API
// =====================
app.post("/promo", (req, res) => {
  const { userId, code } = req.body;

  const promo = db.prepare("SELECT * FROM promos WHERE code = ?").get(code);
  if (!promo) return res.status(400).json({ error: "Invalid code" });

  if (promo.uses >= promo.max_uses) {
    return res.status(400).json({ error: "Expired" });
  }

  updateBalance(userId, promo.amount);

  db.prepare("UPDATE promos SET uses = uses + 1 WHERE code = ?")
    .run(code);

  res.json({ success: true, amount: promo.amount });
});

// =====================
// ADMIN CREATE PROMO
// =====================
bot.onText(/\/promo (.+) (.+) (.+)/, (msg, match) => {
  if (msg.from.id.toString() !== ADMIN_ID) return;

  const code = match[1];
  const amount = parseFloat(match[2]);
  const maxUses = parseInt(match[3]);

  db.prepare(`
    INSERT INTO promos (code, amount, max_uses)
    VALUES (?, ?, ?)
  `).run(code, amount, maxUses);

  bot.sendMessage(msg.chat.id, `✅ Promo ${code} created`);
});

// =====================
// TON CHECK FUNCTION
// =====================
async function checkDeposits() {
  try {
    const url = `https://toncenter.com/api/v2/getTransactions?address=${TON_WALLET}&limit=20&api_key=${TON_API_KEY}`;
    const { data } = await axios.get(url);

    if (!data.result) return;

    for (const tx of data.result) {
      const hash = tx.transaction_id.hash;
      const amount = tx.in_msg?.value
        ? Number(tx.in_msg.value) / 1e9
        : 0;
      const comment = tx.in_msg?.message;

      if (!comment || !comment.startsWith("user_")) continue;

      const userId = comment.replace("user_", "");

      const exists = db.prepare(
        "SELECT * FROM deposits WHERE tx_hash = ?"
      ).get(hash);

      if (exists) continue;

      if (amount <= 0) continue;

      updateBalance(userId, amount);

      db.prepare(`
        INSERT INTO deposits (user_id, tx_hash, amount, created_at)
        VALUES (?, ?, ?, ?)
      `).run(userId, hash, amount, Date.now());

      console.log("💰 Deposit added:", amount);
    }

  } catch (err) {
    console.error("TON error:", err.message);
  }
}

// Проверка каждые 15 секунд
setInterval(checkDeposits, 15000);

// =====================
// VIP WEB INTERFACE
// =====================

app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<title>VIP TON Casino</title>
<style>
body {
  margin:0;
  font-family: Arial, sans-serif;
  background: linear-gradient(135deg,#0f0f0f,#1c1c1c);
  color: gold;
  text-align:center;
}
.header {
  padding:20px;
  font-size:22px;
  font-weight:bold;
}
.balance {
  margin:10px;
  padding:10px;
  border:1px solid gold;
  border-radius:12px;
}
.slots {
  font-size:50px;
  margin:20px;
}
button {
  padding:12px 20px;
  margin:10px;
  border:none;
  border-radius:10px;
  background:gold;
  color:black;
  font-weight:bold;
}
input {
  padding:10px;
  border-radius:8px;
  border:none;
  margin:5px;
}
.settings {
  position:fixed;
  top:10px;
  right:10px;
}
.modal {
  display:none;
  position:fixed;
  top:50%;
  left:50%;
  transform:translate(-50%,-50%);
  background:#111;
  padding:20px;
  border:1px solid gold;
  border-radius:12px;
}
</style>
</head>
<body>

<div class="settings">
  <button onclick="openSettings()">⚙</button>
</div>

<div class="header">💎 VIP TON CASINO</div>

<div class="balance">
  Баланс: <span id="balance">0</span> TON
</div>

<div class="slots" id="slots">🎰 🎰 🎰</div>

<input type="number" id="bet" placeholder="Ставка" step="0.1"/><br>
<button onclick="spin()">🎰 Крутить</button>

<br>

<button onclick="showDeposit()">💰 Пополнить</button>
<button onclick="showHistory()">📊 История</button>

<div id="depositBox" style="display:none;">
<p>Отправь TON на:</p>
<p><b>${TON_WALLET}</b></p>
<p>Комментарий: <b id="memo"></b></p>
</div>

<div class="modal" id="settingsModal">
<h3>Настройки</h3>
<label>
<input type="checkbox" id="musicToggle"/> Музыка
</label><br><br>
<button onclick="closeSettings()">Закрыть</button>
</div>

<audio id="bgMusic" loop>
<source src="https://files.catbox.moe/78surr.mp3" type="audio/mpeg">
</audio>

<script>
const tg = window.Telegram.WebApp;
tg.expand();

const userId = tg.initDataUnsafe.user?.id;

document.getElementById("memo").innerText = "user_" + userId;

async function loadBalance() {
  const res = await fetch("/history/" + userId);
  const data = await res.json();
  await updateBalance();
}

async function updateBalance() {
  const res = await fetch("/spin", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({userId:userId,bet:0})
  }).catch(()=>{});
}

async function spin() {
  const bet = parseFloat(document.getElementById("bet").value);
  const res = await fetch("/spin", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({userId:userId,bet:bet})
  });
  const data = await res.json();
  if(data.reels){
    document.getElementById("slots").innerText =
      data.reels.join(" ");
    document.getElementById("balance").innerText =
      data.balance.toFixed(2);
  } else {
    alert(data.error);
  }
}

function showDeposit(){
  document.getElementById("depositBox").style.display="block";
}

function showHistory(){
  fetch("/history/" + userId)
    .then(r=>r.json())
    .then(data=>{
      alert(data.map(x=>"Ставка:"+x.amount+" Выигрыш:"+x.result).join("\\n"));
    });
}

function openSettings(){
  document.getElementById("settingsModal").style.display="block";
}

function closeSettings(){
  document.getElementById("settingsModal").style.display="none";
}

const music = document.getElementById("bgMusic");
const toggle = document.getElementById("musicToggle");

toggle.addEventListener("change", ()=>{
  if(toggle.checked){
    music.play();
  } else {
    music.pause();
  }
});
</script>

</body>
</html>
`);
});
