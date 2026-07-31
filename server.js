require('dotenv').config();
const path = require('path');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const axios = require('axios');

const { CONFIG } = require('./config');
const state = require('./state');
const User = require('./models/User');
const Promo = require('./models/Promo');
const Transaction = require('./models/Transaction');
const AdminLog = require('./models/AdminLog');
const Ban = require('./models/Ban');
const Task = require('./models/Task');
const { addHistory, safeUid, formatNumber, timeAgo } = require('./utils/helpers');

process.on('uncaughtException', (err) => { console.error('💥 КРИТИЧЕСКАЯ ОШИБКА:', err.message); });
process.on('unhandledRejection', (reason) => { console.error('💥 СКРЫТАЯ ОШИБКА:', reason); });

console.log("🛠 Запуск сервера VIP ХОТ ТАП v2.0...");

if (!process.env.BOT_TOKEN || !process.env.MONGO_URI) {
    console.error("❌ ОШИБКА: Заполни BOT_TOKEN и MONGO_URI!");
    process.exit(1);
}

const app = express();
app.use(express.json());

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("💎 MongoDB подключена!"))
    .catch(err => console.error("❌ Ошибка БД:", err.message));

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const adminState = {};

function adminMenu(chatId) {
    bot.sendMessage(chatId, `👑 **АДМИН-ПАНЕЛЬ VIP ХОТ ТАП**`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
            [{ text: "📊 Статистика", callback_data: "adm_stat" }, { text: "👥 Пользователи", callback_data: "adm_users" }],
            [{ text: "💰 Финансы", callback_data: "adm_finance" }, { text: "📢 Рассылка", callback_data: "adm_broadcast" }],
            [{ text: "🎁 Промокоды", callback_data: "adm_promo" }, { text: "📋 Задания", callback_data: "adm_tasks" }],
            [{ text: "⚙️ Настройки", callback_data: "adm_settings" }],
            [{ text: "📝 Логи", callback_data: "adm_logs" }, { text: "💾 Бэкап", callback_data: "adm_backup" }],
            [{ text: "🛠 Техперерыв", callback_data: "adm_maintenance" }],
            [{ text: "💀 ОБНУЛИТЬ ВСЕХ", callback_data: "adm_wipe_all" }]
        ]}
    });
}

bot.onText(/\/start/, async (msg) => {
    const uid = msg.from.id.toString();
    const username = msg.from.username || '';
    const firstName = msg.from.first_name || '';
    await User.findOneAndUpdate(
        { uid },
        { uid, username, first_name: firstName },
        { upsert: true, setDefaultsOnInsert: true }
    );
    let kb = [[{ text: "🎰 ВОЙТИ В VIP ЗАЛ", web_app: { url: CONFIG.APP_URL } }]];
    if (msg.from.id === CONFIG.ADMIN_ID) kb.push([{ text: "👑 ПАНЕЛЬ ВЛАДЕЛЬЦА", callback_data: "admin_menu" }]);
    bot.sendMessage(msg.chat.id, `💎 **VIP ХОТ ТАП**\nБонус: **100 💎**\nID: \`${uid}\``, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
});

bot.on('callback_query', async (q) => {
    const uid = q.from.id;
    const chatId = q.message.chat.id;
    const msgId = q.message.message_id;

    if (q.data.startsWith('withdraw_ok_')) {
        const parts = q.data.split('_');
        const targetUid = parts[2];
        const amount = parseInt(parts[3]);
        const txId = parts[4];
        bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId });
        const user = await User.findOne({ uid: targetUid });
        if (!user) return bot.sendMessage(chatId, "❌ Игрок не найден.");
        if (user.balance >= amount) {
            user.balance -= amount;
            addHistory(user, `🏦 Вывод -${amount} 💎`, -amount);
            await user.save();
            if (txId) await Transaction.findByIdAndUpdate(txId, { status: 'completed' });
            await AdminLog.create({ action: 'withdraw_approve', target_uid: targetUid, amount, details: 'Через бот' });
            bot.sendMessage(targetUid, `✅ Заявка на вывод ${amount} 💎 одобрена!`).catch(()=>{});
            bot.sendMessage(chatId, `✅ Вывод одобрён.\nИгрок: ${targetUid}\nСумма: ${amount} 💎`);
        } else bot.sendMessage(chatId, "❌ Недостаточно средств у игрока.");
        return;
    }
    if (q.data.startsWith('withdraw_no_')) {
        const parts = q.data.split('_');
        const targetUid = parts[2];
        const amount = parseInt(parts[3]);
        const txId = parts[4];
        bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId });
        if (txId) await Transaction.findByIdAndUpdate(txId, { status: 'rejected' });
        await AdminLog.create({ action: 'withdraw_reject', target_uid: targetUid, amount });
        bot.sendMessage(targetUid, `❌ Заявка на вывод ${amount} 💎 отклонена.`).catch(()=>{});
        bot.sendMessage(chatId, "❌ Заявка отклонена.");
        return;
    }
    if (uid !== CONFIG.ADMIN_ID) return;

    if (q.data === "admin_menu") { adminMenu(chatId); return; }

    if (q.data === "adm_stat") {
        const totalUsers = await User.countDocuments();
        const newToday = await User.countDocuments({ created_at: { $gte: new Date(Date.now() - 86400000) } });
        const activeToday = await User.countDocuments({ last_active: { $gte: new Date(Date.now() - 86400000) } });
        const totalBalance = await User.aggregate([{ $group: { _id: null, sum: { $sum: "$balance" } } }]);
        const pendingW = await Transaction.countDocuments({ type: 'withdraw', status: 'pending' });
        const uptime = Math.floor((Date.now() - state.SERVER_START_TIME) / 1000);
        bot.sendMessage(chatId, `📊 **СТАТИСТИКА**\n\n👥 Всего: **${totalUsers}**\n🆕 Сегодня: **${newToday}**\n🔥 Активных: **${activeToday}**\n💎 Баланс: **${formatNumber(totalBalance[0]?.sum || 0)}**\n⏳ Выводов: **${pendingW}**\n🕒 Аптайм: **${Math.floor(uptime/3600)}ч ${Math.floor((uptime%3600)/60)}м**`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: "🔙 Назад", callback_data: "admin_menu" }]] } });
        return;
    }

    if (q.data === "adm_users") {
        bot.sendMessage(chatId, "👥 **ПОЛЬЗОВАТЕЛИ**", { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
            [{ text: "🔍 Поиск", callback_data: "adm_search" }],
            [{ text: "💵 Баланс", callback_data: "adm_give_bal" }],
            [{ text: "🚫 Бан", callback_data: "adm_ban" }, { text: "✅ Разбан", callback_data: "adm_unban" }],
            [{ text: "⭐ VIP", callback_data: "adm_vip" }],
            [{ text: "🔙 Назад", callback_data: "admin_menu" }]
        ]}});
        return;
    }
    if (q.data === "adm_search") { adminState[uid] = 'search_id'; bot.sendMessage(chatId, "Введите ID или @username:"); return; }
    if (q.data === "adm_give_bal") { adminState[uid] = 'give_bal_id'; bot.sendMessage(chatId, "Введите ID игрока:"); return; }
    if (q.data === "adm_ban") { adminState[uid] = 'ban_id'; bot.sendMessage(chatId, "Введите ID для бана:"); return; }
    if (q.data === "adm_unban") { adminState[uid] = 'unban_id'; bot.sendMessage(chatId, "Введите ID для разбана:"); return; }
    if (q.data === "adm_vip") { adminState[uid] = 'vip_id'; bot.sendMessage(chatId, "Введите ID:"); return; }

    if (q.data === "adm_finance") {
        const pending = await Transaction.find({ type: 'withdraw', status: 'pending' }).sort({ created_at: -1 }).limit(10);
        let text = `💰 **ФИНАНСЫ**\n\n⏳ Ожидают (${pending.length}):\n`;
        if (pending.length === 0) text += "Нет заявок.\n";
        else for (const tx of pending) text += `\n🆔 ${tx.uid} 💎 ${tx.amount} \n📅 ${timeAgo(tx.created_at)}\n`;
        bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: "🔙 Назад", callback_data: "admin_menu" }]] } });
        return;
    }

    if (q.data === "adm_broadcast") {
        bot.sendMessage(chatId, "📢 **РАССЫЛКА**", { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
            [{ text: "📝 Текст", callback_data: "bc_text" }],
            [{ text: "🖼 Фото", callback_data: "bc_photo" }],
            [{ text: "🔘 Кнопка", callback_data: "bc_btn" }],
            [{ text: "⏰ Отложенная", callback_data: "bc_sched" }],
            [{ text: "🔙 Назад", callback_data: "admin_menu" }]
        ]}});
        return;
    }
    if (q.data === "bc_text") { adminState[uid] = 'bc_text'; bot.sendMessage(chatId, "Введите текст:"); return; }
    if (q.data === "bc_photo") { adminState[uid] = 'bc_photo_url'; bot.sendMessage(chatId, "URL фото:"); return; }
    if (q.data === "bc_btn") { adminState[uid] = 'bc_btn_text'; bot.sendMessage(chatId, "Текст сообщения:"); return; }
    if (q.data === "bc_sched") { adminState[uid] = 'bc_sched_text'; bot.sendMessage(chatId, "Текст отложенной рассылки:"); return; }

    if (q.data === "adm_promo") {
        bot.sendMessage(chatId, "🎁 **ПРОМОКОДЫ**", { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
            [{ text: "➕ Создать", callback_data: "adm_promo_add" }, { text: "🗑 Удалить", callback_data: "adm_promo_del" }],
            [{ text: "📋 Список", callback_data: "adm_promo_list" }],
            [{ text: "🔙 Назад", callback_data: "admin_menu" }]
        ]}});
        return;
    }
    if (q.data === "adm_promo_add") { adminState[uid] = 'p_code'; bot.sendMessage(chatId, "Название промокода:"); return; }
    if (q.data === "adm_promo_del") { adminState[uid] = 'p_del'; bot.sendMessage(chatId, "Название для удаления:"); return; }
    if (q.data === "adm_promo_list") {
        const promos = await Promo.find().sort({ created_at: -1 }).limit(20);
        let text = "📋 **Промокоды:**\n\n";
        for (const p of promos) text += `\n\`${p.code}\` — ${p.value} 💎 (${p.usedCount}/${p.limit})\n`;
        bot.sendMessage(chatId, text || "Нет промокодов.", { parse_mode: 'Markdown' });
        return;
    }

    // ===== ЗАДАНИЯ =====
    if (q.data === "adm_tasks") {
        const tasks = await Task.find().sort({ created_at: -1 });
        let text = "📋 **ЗАДАНИЯ**\n\n";
        if (tasks.length === 0) text += "Нет заданий.";
        else for (const t of tasks) text += `\n${t.is_active ? "✅" : "❌"} \`${t.code}\` — ${t.title}\n💎 ${t.reward} | Тип: ${t.type}\n`;
        bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
            [{ text: "➕ Создать задание", callback_data: "adm_task_add" }],
            [{ text: "🗑 Удалить задание", callback_data: "adm_task_del" }],
            [{ text: "🔙 Назад", callback_data: "admin_menu" }]
        ]}});
        return;
    }
    if (q.data === "adm_task_add") { adminState[uid] = 'task_code'; bot.sendMessage(chatId, "Код задания (например: sub_channel, play_10):"); return; }
    if (q.data === "adm_task_del") { adminState[uid] = 'task_del'; bot.sendMessage(chatId, "Код задания для удаления:"); return; }

    if (q.data.startsWith("task_type_")) {
        const type = q.data.replace("task_type_", "");
        const s = adminState[uid];
        if (!s || !s.startsWith("task_type_")) return;
        const parts = s.split("_");
        const code = parts[2];
        const title = parts[3];
        const desc = parts[4];
        const reward = parseInt(parts[5]);
        adminState[uid] = `task_target_${code}_${title}_${desc}_${reward}_${type}`;
        bot.sendMessage(chatId, "Цель задания:\n📢 channel_sub → @канал\n🎰 play_games → количество\n👥 referral → мин. рефералов\n📝 custom → любой текст");
        return;
    }

    if (q.data === "adm_settings") {
        bot.sendMessage(chatId, `⚙️ **НАСТРОЙКИ**\n\nШанс: **${Math.round(state.SETTINGS.winChance * 100)}%**\nИкс: **x${state.SETTINGS.multiplier}**\nМин. ставка: **${state.SETTINGS.minBet} 💎**`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
            [{ text: "⚙️ Шанс", callback_data: "adm_set_chance" }, { text: "✖️ Икс", callback_data: "adm_set_mult" }],
            [{ text: "📉 Мин.ставка", callback_data: "adm_set_minbet" }],
            [{ text: "🔙 Назад", callback_data: "admin_menu" }]
        ]}});
        return;
    }
    if (q.data === "adm_set_chance") { adminState[uid] = 'set_chance'; bot.sendMessage(chatId, "Шанс (0.01 - 1.00):"); return; }
    if (q.data === "adm_set_mult") { adminState[uid] = 'set_mult'; bot.sendMessage(chatId, "Множитель (от 1):"); return; }
    if (q.data === "adm_set_minbet") { adminState[uid] = 'set_minbet'; bot.sendMessage(chatId, "Мин. ставка:"); return; }

    if (q.data === "adm_logs") {
        const logs = await AdminLog.find().sort({ created_at: -1 }).limit(20);
        let text = "📝 **ЛОГИ:**\n\n";
        for (const l of logs) text += `\n${timeAgo(l.created_at)} | ${l.action} | ${l.target_uid || '-'}\n`;
        bot.sendMessage(chatId, text || "Пусто.", { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: "🗑 Очистить", callback_data: "adm_logs_clear" }, { text: "🔙 Назад", callback_data: "admin_menu" }]] } });
        return;
    }
    if (q.data === "adm_logs_clear") { await AdminLog.deleteMany({}); bot.sendMessage(chatId, "🗑 Очищено."); return; }

    if (q.data === "adm_backup") {
        const users = await User.countDocuments();
        const promos = await Promo.countDocuments();
        const txs = await Transaction.countDocuments();
        bot.sendMessage(chatId, `💾 **БЭКАП**\n\n👥 ${users}\n🎁 ${promos}\n💳 ${txs}\n\nMongoDB Atlas делает автобэкапы.`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: "🔙 Назад", callback_data: "admin_menu" }]] } });
        return;
    }

    if (q.data === "adm_maintenance") {
        state.MAINTENANCE_MODE = !state.MAINTENANCE_MODE;
        bot.sendMessage(chatId, state.MAINTENANCE_MODE ? "🛠 Техперерыв ВКЛ." : "✅ Техперерыв ВЫКЛ.");
        return;
    }

    if (q.data === "adm_wipe_all") {
        bot.sendMessage(chatId, "⚠️ **СБРОСИТЬ ВСЕХ?**", { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: "✅ ДА", callback_data: "adm_wipe_confirm" }, { text: "❌ ОТМЕНА", callback_data: "admin_menu" }]] } });
        return;
    }
    if (q.data === "adm_wipe_confirm") {
        await User.updateMany({}, { balance: CONFIG.START_BALANCE, spins: 0, wins: 0, used_promos: [], is_banned: false, ban_reason: null, is_vip: false, tasks_completed: [] });
        await Transaction.deleteMany({});
        await AdminLog.create({ action: 'wipe_all', details: 'Полный сброс' });
        bot.sendMessage(chatId, "✅ БАЗА ОБНУЛЕНА!");
        return;
    }
});

bot.on('message', async (msg) => {
    const s = adminState[msg.from.id];
    if (!s || msg.text?.startsWith('/')) return;
    const uid = msg.from.id;
    const chatId = msg.chat.id;

    try {
        if (s === 'set_chance') { state.SETTINGS.winChance = parseFloat(msg.text); bot.sendMessage(chatId, `✅ Шанс: ${msg.text}`); delete adminState[uid]; }
        else if (s === 'set_mult') { state.SETTINGS.multiplier = parseFloat(msg.text); bot.sendMessage(chatId, `✅ Икс: ${msg.text}`); delete adminState[uid]; }
        else if (s === 'set_minbet') { state.SETTINGS.minBet = parseInt(msg.text); bot.sendMessage(chatId, `✅ Мин: ${msg.text} 💎`); delete adminState[uid]; }

        else if (s === 'search_id') {
            let user;
            if (/^\d+$/.test(msg.text)) user = await User.findOne({ uid: msg.text });
            else user = await User.findOne({ username: { $regex: msg.text.replace('@',''), $options: 'i' } });
            if (!user) bot.sendMessage(chatId, "❌ Не найден.");
            else {
                const banStatus = user.is_banned ? `🚫 ЗАБАНЕН: ${user.ban_reason || 'Нет'}` : '✅ Активен';
                bot.sendMessage(chatId, `👤 **Профиль**\n\nID: \`${user.uid}\`\nЮзер: @${user.username || 'нет'}\nИмя: ${user.first_name || '-'}\n💎 Баланс: **${user.balance}**\n🎰 Спинов: ${user.spins}\n🏆 Побед: ${user.wins}\n⭐ VIP: ${user.is_vip ? 'Да' : 'Нет'}\n📅 Рег: ${timeAgo(user.created_at)}\n🔥 Активность: ${timeAgo(user.last_active)}\n${banStatus}`, { parse_mode: 'Markdown' });
            }
            delete adminState[uid];
        }
        else if (s === 'give_bal_id') { adminState[uid] = `give_bal_v_${msg.text}`; bot.sendMessage(chatId, "Сумма (можно отрицательную):"); }
        else if (s.startsWith('give_bal_v_')) {
            const targetUid = s.split('_')[3];
            const amount = Math.floor(parseFloat(msg.text));
            const user = await User.findOne({ uid: targetUid });
            if (user) {
                user.balance += amount; if (user.balance < 0) user.balance = 0;
                addHistory(user, amount >= 0 ? `👑 Админ +${amount} 💎` : `👑 Админ ${amount} 💎`, amount);
                await user.save();
                await AdminLog.create({ action: amount >= 0 ? 'balance_add' : 'balance_remove', target_uid: targetUid, amount });
                bot.sendMessage(chatId, `✅ Баланс: ${user.balance} 💎`);
                bot.sendMessage(targetUid, amount >= 0 ? `🎁 Админ +${amount} 💎` : `⚠️ Админ ${amount} 💎`).catch(()=>{});
            }
            delete adminState[uid];
        }
        else if (s === 'ban_id') { adminState[uid] = `ban_r_${msg.text}`; bot.sendMessage(chatId, "Причина:"); }
        else if (s.startsWith('ban_r_')) {
            const targetUid = s.split('_')[2];
            await User.findOneAndUpdate({ uid: targetUid }, { is_banned: true, ban_reason: msg.text });
            await Ban.create({ uid: targetUid, reason: msg.text, banned_by: 'admin' });
            await AdminLog.create({ action: 'ban', target_uid: targetUid, details: msg.text });
            bot.sendMessage(targetUid, `🚫 Забанены.\nПричина: ${msg.text}`).catch(()=>{});
            bot.sendMessage(chatId, `✅ ${targetUid} забанен.`);
            delete adminState[uid];
        }
        else if (s === 'unban_id') {
            await User.findOneAndUpdate({ uid: msg.text }, { is_banned: false, ban_reason: null });
            await Ban.deleteMany({ uid: msg.text });
            await AdminLog.create({ action: 'unban', target_uid: msg.text });
            bot.sendMessage(msg.text, "✅ Разбанены.").catch(()=>{});
            bot.sendMessage(chatId, `✅ ${msg.text} разбанен.`);
            delete adminState[uid];
        }
        else if (s === 'vip_id') {
            const user = await User.findOne({ uid: msg.text });
            if (!user) { bot.sendMessage(chatId, "❌ Не найден."); delete adminState[uid]; return; }
            user.is_vip = !user.is_vip; await user.save();
            await AdminLog.create({ action: user.is_vip ? 'vip_give' : 'vip_remove', target_uid: msg.text });
            bot.sendMessage(msg.text, user.is_vip ? "⭐ VIP выдан!" : "⭐ VIP снят.").catch(()=>{});
            bot.sendMessage(chatId, `✅ VIP ${user.is_vip ? 'выдан' : 'снят'}.`);
            delete adminState[uid];
        }

        else if (s === 'bc_text') {
            const users = await User.find();
            let sent = 0, failed = 0;
            for (const u of users) { try { await bot.sendMessage(u.uid, msg.text); sent++; } catch(e) { failed++; } }
            await AdminLog.create({ action: 'broadcast_text', details: `${sent}/${failed}` });
            bot.sendMessage(chatId, `✅ ${sent}\n❌ ${failed}`);
            delete adminState[uid];
        }
        else if (s === 'bc_photo_url') { adminState[uid] = `bc_photo_c_${msg.text}`; bot.sendMessage(chatId, "Подпись:"); }
        else if (s.startsWith('bc_photo_c_')) {
            const url = s.split('_')[3];
            const users = await User.find();
            let sent = 0;
            for (const u of users) { try { await bot.sendPhoto(u.uid, url, { caption: msg.text }); sent++; } catch(e) {} }
            bot.sendMessage(chatId, `✅ ${sent}`); delete adminState[uid];
        }
        else if (s === 'bc_btn_text') { adminState[uid] = `bc_btn_t_${msg.text}`; bot.sendMessage(chatId, "Текст кнопки:"); }
        else if (s.startsWith('bc_btn_t_')) {
            const btnText = msg.text;
            const text = s.split('_').slice(3).join('_');
            adminState[uid] = `bc_btn_u_${text}_${btnText}`;
            bot.sendMessage(chatId, "URL кнопки:");
        }
        else if (s.startsWith('bc_btn_u_')) {
            const parts = s.split('_');
            const btnUrl = msg.text;
            const btnText = parts[4];
            const text = parts[3];
            const users = await User.find();
            let sent = 0;
            for (const u of users) { try { await bot.sendMessage(u.uid, text, { reply_markup: { inline_keyboard: [[{ text: btnText, url: btnUrl }]] } }); sent++; } catch(e) {} }
            bot.sendMessage(chatId, `✅ ${sent}`); delete adminState[uid];
        }
        else if (s === 'bc_sched_text') { adminState[uid] = `bc_sched_d_${msg.text}`; bot.sendMessage(chatId, "Через сколько минут?"); }
        else if (s.startsWith('bc_sched_d_')) {
            const text = s.split('_').slice(3).join('_');
            const delay = Math.floor(parseFloat(msg.text));
            if (!delay || delay < 1) { bot.sendMessage(chatId, "❌ Некорректно."); delete adminState[uid]; return; }
            const id = Date.now().toString();
            state.BROADCAST_QUEUE.push({ id, text, fireAt: Date.now() + delay * 60000 });
            setTimeout(async () => {
                const idx = state.BROADCAST_QUEUE.findIndex(x => x.id === id);
                if (idx >= 0) state.BROADCAST_QUEUE.splice(idx, 1);
                const users = await User.find();
                for (const u of users) { try { await bot.sendMessage(u.uid, text); } catch(e) {} }
            }, delay * 60000);
            bot.sendMessage(chatId, `✅ Через ${delay} мин.`); delete adminState[uid];
        }

        else if (s === 'p_code') { adminState[uid] = `p_val_${msg.text.trim().toUpperCase()}`; bot.sendMessage(chatId, "Сумма:"); }
        else if (s.startsWith('p_val_')) { adminState[uid] = `p_lim_${s.split('_')[2]}_${Math.floor(parseFloat(msg.text))}`; bot.sendMessage(chatId, "Лимит:"); }
        else if (s.startsWith('p_lim_')) {
            const code = s.split('_')[2];
            const val = Math.floor(parseFloat(s.split('_')[3]));
            const limit = parseInt(msg.text);
            await Promo.findOneAndUpdate({ code }, { code, value: val, limit, usedCount: 0 }, { upsert: true });
            await User.updateMany({}, { $pull: { used_promos: code } });
            bot.sendMessage(chatId, `✅ \`${code}\` — ${val} 💎 | ${limit}`, { parse_mode: 'Markdown' });
            delete adminState[uid];
        }
        else if (s === 'p_del') {
            const delCode = msg.text.trim().toUpperCase();
            await Promo.deleteOne({ code: delCode });
            await User.updateMany({}, { $pull: { used_promos: delCode } });
            bot.sendMessage(chatId, "🗑 Удалено."); delete adminState[uid];
        }

        // ===== СОЗДАНИЕ ЗАДАНИЯ =====
        else if (s === 'task_code') {
            adminState[uid] = `task_title_${msg.text.trim()}`;
            bot.sendMessage(chatId, "Название задания:");
        }
        else if (s.startsWith('task_title_')) {
            const code = s.split('_')[2];
            adminState[uid] = `task_desc_${code}_${msg.text}`;
            bot.sendMessage(chatId, "Описание:");
        }
        else if (s.startsWith('task_desc_')) {
            const parts = s.split('_');
            const code = parts[2];
            const title = parts[3];
            adminState[uid] = `task_reward_${code}_${title}_${msg.text}`;
            bot.sendMessage(chatId, "Награда в 💎:");
        }
        else if (s.startsWith('task_reward_')) {
            const parts = s.split('_');
            const code = parts[2];
            const title = parts[3];
            const desc = parts[4];
            const reward = Math.floor(parseFloat(msg.text));
            adminState[uid] = `task_type_${code}_${title}_${desc}_${reward}`;
            bot.sendMessage(chatId, "Выберите тип:", { reply_markup: { inline_keyboard: [
                [{ text: "📢 Подписка", callback_data: "task_type_channel_sub" }],
                [{ text: "🎰 Игры", callback_data: "task_type_play_games" }],
                [{ text: "👥 Реферал", callback_data: "task_type_referral" }],
                [{ text: "📝 Другое", callback_data: "task_type_custom" }]
            ]}});
        }
        else if (s.startsWith('task_target_')) {
            const parts = s.split('_');
            const code = parts[2];
            const title = parts[3];
            const desc = parts[4];
            const reward = parseInt(parts[5]);
            const type = parts[6];
            const target = msg.text;

            await Task.findOneAndUpdate(
                { code },
                { code, title, description: desc, reward, type, target_value: target, is_active: true },
                { upsert: true }
            );
            await AdminLog.create({ action: 'task_create', details: `Задание ${code} создано` });
            bot.sendMessage(chatId, `✅ Задание \`${code}\` создано!\n\n${title}\n💎 ${reward}\nТип: ${type}`, { parse_mode: 'Markdown' });
            delete adminState[uid];
        }
        else if (s === 'task_del') {
            const code = msg.text.trim();
            await Task.deleteOne({ code });
            await User.updateMany({}, { $pull: { tasks_completed: code } });
            bot.sendMessage(chatId, `🗑 Задание \`${code}\` удалено.`, { parse_mode: 'Markdown' });
            delete adminState[uid];
        }
    } catch (e) { console.error(e); }
});

// ==========================================
// 💸 СКАНЕР ДОНАТОВ
// ==========================================
setInterval(async () => {
    try {
        const res = await axios.get(`https://toncenter.com/api/v2/getTransactions?address=UQDoTj0hCwJbI-9fziRCyUZzO2XHmtcDzuiAiGjxG21G3dIX&limit=10&api_key=`);
        if (!res.data?.ok) return;
        for (let tx of res.data.result) {
            const comment = tx.in_msg?.message?.trim(), lt = tx.transaction_id.lt, val = parseFloat(tx.in_msg?.value || 0) / 1e9;
            if (!comment || isNaN(comment) || val <= 0) continue;
            const user = await User.findOne({ uid: comment });
            if (user && BigInt(lt) > BigInt(user.last_lt || "0")) { 
                const addedHottap = Math.floor(val * CONFIG.HOTTAP_RATE);
                user.balance = Math.floor(user.balance + addedHottap); 
                user.last_lt = lt.toString();
                user.total_deposited = (user.total_deposited || 0) + val;
                addHistory(user, `💰 Донат +${addedHottap} 💎`, addedHottap);
                await user.save();
                await Transaction.create({ uid: comment, type: 'deposit', ton_amount: val, amount: addedHottap, status: 'completed', tx_hash: tx.transaction_id.hash });
                bot.sendMessage(user.uid, `💎 **ДОНАТ ХОТ ТАП!**\n+${addedHottap} 💎`).catch(()=>{});
            }
        }
    } catch (err) {}
}, 15000);

// ==========================================
// 🌐 API
// ==========================================
const logger = require('./middleware/logger');
const auth = require('./middleware/auth');

app.use(logger);
app.use(auth);

app.use('/api', async (req, res, next) => {
    const uid = safeUid(req.body?.uid);
    if (uid) {
        await User.updateOne({ uid }, { last_active: Date.now(), notified_inactive: false }, { strict: false });
    }
    next();
});

app.get('/api/maintenance', (req, res) => {
    res.json({ maintenance: state.MAINTENANCE_MODE });
});

// Игровые роуты
app.use('/api', require('./routes/spin'));
app.use('/api', require('./routes/roulette'));
app.use('/api', require('./routes/promo'));
app.use('/api', require('./routes/profile'));
app.use('/api', require('./routes/withdraw')(bot, CONFIG));
app.use('/api', require('./routes/crash')(bot, CONFIG));
app.use('/api', require('./routes/tasks')(bot));

// Админ роуты
app.use('/api', require('./routes/admin/stats')(bot));
app.use('/api', require('./routes/admin/users')(bot));
app.use('/api', require('./routes/admin/finance')(bot));
app.use('/api', require('./routes/admin/broadcast')(bot));
app.use('/api', require('./routes/admin/logs')());
app.use('/api', require('./routes/admin/backup')());

// ==========================================
// 🛡 ОБРАБОТКА ОШИБОК
// ==========================================
app.use((err, req, res, next) => {
    console.error("[ERROR]", err.stack || err);
    res.status(500).json({ err: "Internal Server Error" });
});

// ==========================================
// 🎨 ФРОНТЕНД
// ==========================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});


});


const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('Сервер запущен на порту ' + PORT));
