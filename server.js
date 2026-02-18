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
  res.send("VIP TON CASINO IS RUNNING 💎");
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
