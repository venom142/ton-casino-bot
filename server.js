<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>VIP TON CASINO</title>

<style>

/* ===== GLOBAL ===== */

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  background: radial-gradient(circle at top, #001f3f, #000814 70%);
  font-family: 'Segoe UI', sans-serif;
  color: white;
  overflow-x: hidden;
}

/* ===== BACKGROUND GLOW ===== */

body::before {
  content: "";
  position: fixed;
  top: -200px;
  left: 50%;
  transform: translateX(-50%);
  width: 600px;
  height: 600px;
  background: radial-gradient(circle, #00bfff55, transparent 70%);
  filter: blur(120px);
  z-index: -1;
}

/* ===== HEADER ===== */

.header {
  padding: 25px 15px;
  text-align: center;
}

.logo {
  font-size: 30px;
  font-weight: bold;
  color: #00bfff;
  text-shadow: 0 0 25px #00bfff;
}

/* ===== HUD ===== */

.hud {
  width: 90%;
  margin: 20px auto;
  background: rgba(0, 0, 0, 0.6);
  border: 2px solid #00bfff;
  border-radius: 20px;
  padding: 20px;
  box-shadow: 0 0 25px #00bfff55;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.balance {
  font-size: 20px;
}

.balance span {
  color: #00ffcc;
  font-weight: bold;
}

.level {
  font-size: 14px;
  opacity: 0.8;
}

/* ===== SLOT MACHINE ===== */

.slot-container {
  margin: 40px auto;
  width: 90%;
  padding: 30px;
  background: rgba(0, 0, 0, 0.7);
  border-radius: 25px;
  border: 2px solid #00bfff;
  box-shadow: 0 0 35px #00bfff55;
  text-align: center;
}

.reels {
  font-size: 55px;
  margin: 25px 0;
  letter-spacing: 15px;
  min-height: 80px;
}

.spin-animation {
  animation: spinAnim 0.6s linear infinite;
}

@keyframes spinAnim {
  0% { transform: translateY(0px); }
  50% { transform: translateY(-8px); }
  100% { transform: translateY(0px); }
}

/* ===== BUTTONS ===== */

.buttons {
  width: 90%;
  margin: 20px auto;
}

.btn {
  width: 100%;
  padding: 18px;
  margin-bottom: 15px;
  border-radius: 20px;
  border: none;
  font-size: 18px;
  font-weight: bold;
  cursor: pointer;
  transition: 0.3s;
}

.spin-btn {
  background: linear-gradient(90deg, #00bfff, #0077ff);
  color: white;
  box-shadow: 0 0 20px #00bfff;
}

.spin-btn:hover {
  transform: scale(1.05);
  box-shadow: 0 0 40px #00bfff;
}

.deposit-btn {
  background: linear-gradient(90deg, #00ff99, #00cc66);
}

.withdraw-btn {
  background: linear-gradient(90deg, #ff0066, #cc0033);
}

/* ===== MODAL ===== */

.modal {
  position: fixed;
  bottom: -100%;
  left: 0;
  width: 100%;
  background: #001f3f;
  border-top-left-radius: 25px;
  border-top-right-radius: 25px;
  padding: 25px;
  transition: 0.4s;
  box-shadow: 0 -10px 40px #000;
}

.modal.active {
  bottom: 0;
}

.modal h2 {
  margin-bottom: 15px;
}

.modal button {
  margin-top: 15px;
}

/* ===== FOOTER ===== */

.footer {
  text-align: center;
  margin: 40px 0;
  font-size: 12px;
  opacity: 0.6;
}

</style>
</head>

<body>

<div class="header">
  <div class="logo">💎 VIP TON CASINO</div>
</div>

<div class="hud">
  <div class="balance">
    Баланс: <span id="balance">0</span> TON
  </div>
  <div class="level">
    LEVEL 1
  </div>
</div>

<div class="slot-container">
  <div class="reels" id="reels">
    🎰 🎰 🎰
  </div>
</div>

<div class="buttons">
  <button class="btn spin-btn" onclick="spin()">🎰 КРУТИТЬ</button>
  <button class="btn deposit-btn" onclick="openDeposit()">💰 ДЕПОЗИТ</button>
  <button class="btn withdraw-btn" onclick="openWithdraw()">💸 ВЫВОД</button>
</div>

<div class="modal" id="depositModal">
  <h2>Пополнение TON</h2>
  <p>Отправь TON на адрес:</p>
  <p><b>UQxxxxxxxxxxxxxxxx</b></p>
  <button class="btn spin-btn" onclick="closeDeposit()">Закрыть</button>
</div>

<div class="modal" id="withdrawModal">
  <h2>Вывод TON</h2>
  <p>Функция скоро будет активна 💎</p>
  <button class="btn spin-btn" onclick="closeWithdraw()">Закрыть</button>
</div>

<div class="footer">
  Powered by TON Blockchain
</div>

<script>

let balance = 10;
let spinning = false;

const symbols = ["🍒","🍋","💎","7️⃣","🔥","⭐"];

function spin() {

  if (spinning) return;

  if (balance <= 0) {
    alert("Недостаточно TON");
    return;
  }

  spinning = true;
  balance -= 1;
  updateBalance();

  const reels = document.getElementById("reels");
  reels.classList.add("spin-animation");

  setTimeout(() => {

    reels.classList.remove("spin-animation");

    let s1 = randomSymbol();
    let s2 = randomSymbol();
    let s3 = randomSymbol();

    reels.innerText = s1 + "  " + s2 + "  " + s3;

    if (s1 === s2 && s2 === s3) {
      balance += 7;
      alert("JACKPOT 💎 +7 TON");
    }

    updateBalance();
    spinning = false;

  }, 1500);
}

function randomSymbol() {
  return symbols[Math.floor(Math.random() * symbols.length)];
}

function updateBalance() {
  document.getElementById("balance").innerText = balance;
}

function openDeposit() {
  document.getElementById("depositModal").classList.add("active");
}

function closeDeposit() {
  document.getElementById("depositModal").classList.remove("active");
}

function openWithdraw() {
  document.getElementById("withdrawModal").classList.add("active");
}

function closeWithdraw() {
  document.getElementById("withdrawModal").classList.remove("active");
}

</script>

</body>
</html>

"better-sqlite3": "^8.4.0"

