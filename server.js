/**
 * 💎 VIP TON ХОТ ТАП — CORE SERVER V3.0
 * ARCHITECTURE: MODULAR MICROSERVICES
 * --------------------------------------------------
 * Этот файл — дирижер всей системы.
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// Настройки безопасности и парсинга
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// [ ПОДКЛЮЧЕНИЕ МОДУЛЕЙ ]
// В будущем мы разнесем это по файлам, чтобы набрать 5000 строк
const config = {
    db: process.env.MONGO_URI || "mongodb+srv://sv2951605_db_user:zetatop123@cluster0.k5dri5s.mongodb.net/?appName=Cluster0",
    port: process.env.PORT || 3000,
    admin_id: "8475323865"
};

// [ ГЛОБАЛЬНАЯ БАЗА ДАННЫХ ]
mongoose.connect(config.db)
    .then(() => console.log('>>> [DATABASE] CONNECTED'))
    .catch(err => console.log('>>> [DATABASE] ERROR:', err));

// [ API РОУТЫ ]
app.get('/health', (req, res) => res.json({ status: "active", version: "3.0.0" }));

// Здесь будут подключаться игровые контроллеры
// app.use('/api/user', require('./src/routes/userRoutes'));
// app.use('/api/game', require('./src/routes/gameRoutes'));

app.listen(config.port, () => {
    console.log(`
    💎💎💎 VIP TON ХОТ ТАП 💎💎💎
    -----------------------------
    STATUS: ONLINE
    PORT: ${config.port}
    ADMIN: ${config.admin_id}
    -----------------------------
    `);
});
