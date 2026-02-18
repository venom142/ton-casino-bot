import express from "express";
import TelegramBot from "node-telegram-bot-api";
import Database from "better-sqlite3";

// ================= ENV =================
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const WEB_URL = process.env.WEB_URL;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN || !WEB_URL) {
  console.error("Missing ENV variables");
  process.exit(1);
}

// ================= INIT =================
const app = express();
app.use(express.json());

const bot = new TelegramBot(BOT_TOKEN);
const db = new Database("database.sqlite");

// ================= DATABASE =================
db.prepare(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  balance REAL DEFAULT 0
)
`).run();

// ================= HELPERS =================
function getUser(userId) {
  let user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) {
    db.prepare("INSERT INTO users (id, balance) VALUES (?, 0)").run(userId);
    user = { id: userId, balance: 0 };
  }
  return user;
}

// ================= WEBHOOK =================
app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// ================= ROUTES =================
app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>VIP TON CASINO</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
body {
  margin: 0;
  font-family: Arial, sans-serif;
  background: linear-gradient(180deg, #0b1c2d, #000);
  color: white;
  text-align: center;
}

.container {
  padding: 20px;
}

.logo {
  font-size: 26px;
  font-weight: bold;
  margin-top: 20px;
  color: #00aaff;
  text-shadow: 0 0 15px #00aaff;
}

.balance {
  margin: 20px auto;
  padding: 15px;
  border: 2px solid #00aaff;
  border-radius: 15px;
  width: 80%;
  font-size: 20px;
  box-shadow: 0 0 20px rgba(0,170,255,0.5);
}

.button {
  margin-top: 20px;
  padding: 15px;
  width: 80%;
  background: #00aaff;
  border: none;
  border-radius: 15px;
  font-size: 18px;
  color: white;
  cursor: pointer;
  box-shadow: 0 0 20px rgba(0,170,255,0.6);
  transition: 0.2s;
}

.button:active {
  transform: scale(0.95);
}

.slot {
  font-size: 40px;
  margin: 20px 0;
}
</style>
</head>
<body>

<div class="container">
  <div class="logo">💎 VIP TON CASINO</div>
  <div class="balance">Баланс: <span id="balance">0</span> TON</div>

  <div class="slot" id="slot">🎰 🎰 🎰</div>

  <button class="button" onclick="spin()">🎰 Крутить</button>
</div>

<script>
let tg = window.Telegram.WebApp;
tg.expand();

let balance = 0;

function spin() {
  if (balance <= 0) {
    alert("Недостаточно TON");
    return;
  }

  balance -= 1;
  document.getElementById("balance").innerText = balance;

  const symbols = ["💎","7","👑","⚡"];
  let result = "";
  for (let i = 0; i < 3; i++) {
    result += symbols[Math.floor(Math.random()*symbols.length)] + " ";
  }

  document.getElementById("slot").innerText = result;

  if (result.includes("💎💎💎")) {
    balance += 5;
    alert("Выигрыш +5 TON");
  }
}
</script>

</body>
</html>
  `);
});

// ================= TELEGRAM =================
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
            web_app: { url: WEB_URL }
          }
        ]
      ]
    }
  });
});

// ================= START SERVER =================
app.listen(PORT, async () => {
  console.log("Server started on port", PORT);

  await bot.setWebHook(`${WEB_URL}/bot${BOT_TOKEN}`);
  console.log("Webhook set");
});
