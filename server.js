require('dotenv').config();
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
    res.send(`<!DOCTYPE html>
    <html lang="ru">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
        <script src="https://telegram.org/js/telegram-web-app.js"></script>
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@700;900&display=swap" rel="stylesheet">
        <style>
            :root { --neon-cyan: #00f0ff; --neon-magenta: #ff00ff; --gold: #FFD700; --dark: #0a0a0c; }
            body { margin: 0; font-family: 'Montserrat', sans-serif; text-align: center; color: #fff; background-color: var(--dark); overflow: hidden; height: 100vh; width: 100vw; }
            .back-video { position: fixed; top: 50%; left: 50%; min-width: 100%; min-height: 100%; z-index: -2; transform: translate(-50%, -50%); object-fit: cover; opacity: 0.8; }
            body::before { content: ""; position: fixed; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.8) 100%); z-index: -1; }
            
            .bottom-nav {
                position: fixed;
                bottom: 0;
                left: 0;
                width: 100%;
                display: flex;
                justify-content: space-around;
                background: rgba(10, 10, 15, 0.95);
                border-top: 2px solid var(--neon-magenta);
                box-shadow: 0 -5px 20px rgba(255, 0, 255, 0.2);
                backdrop-filter: blur(10px);
                z-index: 1000;
                padding: 10px 0;
                padding-bottom: calc(10px + env(safe-area-inset-bottom));
            }
            .bottom-nav-item {
                display: flex;
                flex-direction: column;
                align-items: center;
                color: #777;
                font-size: 11px;
                font-weight: 800;
                text-transform: uppercase;
                cursor: pointer;
                transition: 0.3s;
                gap: 5px;
                width: 20%;
            }
            .bottom-nav-item .icon { font-size: 22px; transition: 0.3s; filter: grayscale(1); }
            .bottom-nav-item.active { color: var(--neon-cyan); text-shadow: 0 0 10px var(--neon-cyan); }
            .bottom-nav-item.active .icon { filter: grayscale(0) drop-shadow(0 0 8px var(--neon-cyan)); transform: scale(1.1); }
            
            .page { display: none; padding: 20px; padding-bottom: 90px; height: 100vh; overflow-y: auto; box-sizing: border-box; animation: fadeIn 0.4s ease-out; }
            .page.active { display: block; }
            @keyframes fadeIn { from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: scale(1); } }
            
            .vip-title {
                margin: 10px 0 15px;
                font-size: clamp(26px, 8vw, 36px);
                font-weight: 1000;
                letter-spacing: 2px;
                background: linear-gradient(90deg, #00ff00, #00f0ff, #ff00ff);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                filter: drop-shadow(0 0 15px rgba(0, 240, 255, 0.5));
                text-transform: uppercase;
                text-align: center;
            }

            .sub-nav {
                display: flex;
                gap: 10px;
                justify-content: center;
                margin-bottom: 20px;
            }
            .sub-tab {
                background: rgba(0,0,0,0.5);
                border: 2px solid #555;
                color: #aaa;
                padding: 10px 20px;
                border-radius: 12px;
                font-weight: 900;
                text-transform: uppercase;
                font-size: 14px;
                transition: 0.3s;
                cursor: pointer;
                flex: 1;
                max-width: 150px;
            }
            .sub-tab.active {
                border-color: var(--neon-cyan);
                color: #fff;
                background: rgba(0, 240, 255, 0.1);
                box-shadow: 0 0 15px rgba(0, 240, 255, 0.4);
            }

            /* VIP НЕОНОВЫЙ БАЛАНС */
            .vip-balance-card {
                background: linear-gradient(135deg, rgba(20,20,25,0.9), rgba(10,10,15,0.95));
                border: 2px solid var(--neon-cyan);
                border-radius: 16px;
                padding: 15px 20px;
                margin-bottom: 20px;
                box-shadow: 0 0 20px rgba(0,240,255,0.3), inset 0 0 15px rgba(255,0,255,0.1);
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                position: relative;
                overflow: hidden;
            }
            .vip-balance-card::before {
                content: ''; position: absolute; top: 0; left: -100%; width: 50%; height: 100%;
                background: linear-gradient(90deg, transparent, rgba(255,0,255,0.2), transparent);
                animation: shine 3s infinite;
            }
            @keyframes shine { 100% { left: 200%; } }
            .vip-balance-title { font-size: 12px; color: #aaa; text-transform: uppercase; letter-spacing: 2px; font-weight: 800; margin-bottom: 5px; }
            .vip-balance-value { display: flex; align-items: center; justify-content: center; gap: 10px; }
            .vip-balance-number { font-size: 38px; color: #fff; font-weight: 900; text-shadow: 0 0 15px var(--neon-cyan), 0 0 5px var(--neon-magenta); }
            .vip-balance-gem { font-size: 32px; filter: drop-shadow(0 0 10px var(--neon-cyan)); }

            .card { background: rgba(20,20,25,0.85); border: 1px solid rgba(0,240,255,0.3); padding: 20px; margin-bottom: 20px; border-radius: 16px; box-shadow: inset 0 0 20px rgba(0,240,255,0.1), 0 5px 15px rgba(0,0,0,0.6); backdrop-filter: blur(5px); }
            
            .reel-cont { display: flex; justify-content: center; gap: 15px; margin: 30px 0; }
            .reel { width: 90px; height: 120px; background: #000; border: 2px solid var(--neon-cyan); border-radius: 16px; overflow: hidden; position: relative; box-shadow: 0 0 20px rgba(0,240,255,0.3); }
            .strip { width: 100%; position: absolute; top: 0; left: 0; will-change: transform; }
            .sym { height: 120px; display: flex; align-items: center; justify-content: center; font-size: 60px; filter: drop-shadow(0 0 10px rgba(255,255,255,0.2)); }
            
            .crash-monitor { width: 100%; height: 160px; background: #000; border: 2px solid var(--neon-magenta); border-radius: 16px; display: flex; flex-direction: column; justify-content: center; align-items: center; box-shadow: inset 0 0 30px rgba(255,0,255,0.2), 0 0 20px rgba(255,0,255,0.3); margin-bottom: 20px; }
            .crash-x {
                font-size: 38px;
                font-weight: 900;
                color: #fff;
                text-shadow: 0 0 18px rgba(255,255,255,0.65);
                font-variant-numeric: tabular-nums;
                font-feature-settings: "tnum";
                min-width: 180px;
                text-align: center;
                display: inline-block;
                letter-spacing: 1px;
                will-change: contents;
                transition: color 0.18s ease, text-shadow 0.18s ease;
            }
            .crash-status { font-size: 14px; color: #aaa; margin-top: 5px; text-transform: uppercase; letter-spacing: 2px; }

            .crash-mini-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px 0 14px; }
            .crash-mini-card { background: rgba(0,0,0,0.42); border: 1px solid rgba(0,240,255,0.22); border-radius: 14px; padding: 10px 8px; box-shadow: inset 0 0 12px rgba(0,240,255,0.06); }
            .crash-mini-label { color: #888; font-size: 10px; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; }
            .crash-mini-value { color: #fff; font-size: 15px; font-weight: 900; margin-top: 4px; text-shadow: 0 0 10px rgba(0,240,255,0.35); }
            .crash-history { display: flex; gap: 7px; overflow-x: auto; white-space: nowrap; margin: 0 0 14px; padding: 2px 1px 8px; scrollbar-width: none; }
            .crash-history::-webkit-scrollbar { display: none; }
            .crash-chip { flex: 0 0 auto; min-width: 54px; padding: 8px 9px; border-radius: 999px; background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.12); font-size: 12px; font-weight: 900; }
            .crash-chip.low { color: #ff4a4a; border-color: rgba(255,74,74,0.45); box-shadow: 0 0 12px rgba(255,74,74,0.12); }
            .crash-chip.mid { color: #ffd700; border-color: rgba(255,215,0,0.45); box-shadow: 0 0 12px rgba(255,215,0,0.12); }
            .crash-chip.high { color: #00f0ff; border-color: rgba(0,240,255,0.55); box-shadow: 0 0 12px rgba(0,240,255,0.16); }
            .crash-chip.max { color: #fff; border-color: rgba(255,215,0,0.9); background: linear-gradient(90deg, rgba(255,215,0,0.18), rgba(255,0,255,0.12)); box-shadow: 0 0 18px rgba(255,215,0,0.28); }


            .crash-monitor {
                position: relative;
                overflow: hidden;
            }
            .rocket-visual {
                position: absolute;
                left: 50%;
                top: 50%;
                transform: translate(-50%, -50%) scale(0.8) rotate(-12deg);
                font-size: 34px;
                opacity: 0;
                z-index: 2;
                pointer-events: none;
                will-change: transform, opacity;
                filter: drop-shadow(0 0 16px rgba(0,240,255,0.75));
                transition: transform .18s linear, opacity .16s ease, filter .16s ease;
            }
            .rocket-visual.fly {
                opacity: 0.95;
                animation: rocketWiggle .75s ease-in-out infinite alternate;
            }
            .rocket-visual.cashout {
                opacity: 1;
                font-size: 30px;
                filter: drop-shadow(0 0 22px rgba(0,255,120,0.95));
                animation: cashoutPop .45s ease;
            }
            .rocket-visual.boom {
                opacity: 1;
                font-size: 38px;
                filter: drop-shadow(0 0 26px rgba(255,40,90,0.95));
                animation: boomCenter .5s ease;
            }
            .rocket-trail {
                position: absolute;
                left: 50%;
                top: 58%;
                width: 7px;
                height: 64px;
                transform: translateX(-50%);
                border-radius: 999px;
                background: linear-gradient(to top, rgba(255,0,255,0), rgba(0,240,255,0.68), rgba(255,255,255,0.9));
                opacity: 0;
                z-index: 1;
                filter: blur(1px);
                pointer-events: none;
            }
            .rocket-trail.show {
                opacity: .75;
                animation: trailPulse .5s ease-in-out infinite alternate;
            }
            .crash-monitor.cashout-glow {
                box-shadow: 0 0 28px rgba(0,255,120,0.5), inset 0 0 28px rgba(0,255,120,0.10);
            }
            .crash-monitor.boom-glow {
                box-shadow: 0 0 32px rgba(255,0,90,0.58), inset 0 0 32px rgba(255,0,90,0.14);
            }
            @keyframes rocketWiggle {
                from { margin-left: -5px; }
                to { margin-left: 5px; }
            }
            @keyframes trailPulse {
                from { height: 48px; opacity: .35; }
                to { height: 78px; opacity: .75; }
            }
            @keyframes boomCenter {
                0% { transform: translate(-50%, -50%) scale(.6) rotate(0deg); opacity: .7; }
                45% { transform: translate(-50%, -50%) scale(1.35) rotate(0deg); opacity: 1; }
                100% { transform: translate(-50%, -50%) scale(1) rotate(0deg); opacity: 1; }
            }
            @keyframes cashoutPop {
                0% { transform: translate(-50%, -50%) scale(.7) rotate(0deg); }
                50% { transform: translate(-50%, -50%) scale(1.18) rotate(0deg); }
                100% { transform: translate(-50%, -50%) scale(1) rotate(0deg); }
            }

            .quick-bets { display: grid; grid-template-columns: repeat(5, 1fr); gap: 7px; margin: -4px 0 14px; }
            .quick-bet { border: 1px solid rgba(0,240,255,0.35); background: rgba(0,0,0,0.42); color: #fff; border-radius: 12px; padding: 10px 0; font-size: 12px; font-weight: 900; font-family: inherit; box-shadow: inset 0 0 10px rgba(0,240,255,0.06); }
            .quick-bet:active { transform: scale(0.96); }
            .crash-result { min-height: 20px; margin: -8px 0 11px; font-size: 13px; font-weight: 900; color: #aaa; text-shadow: 0 0 10px rgba(255,255,255,0.1); }

            
            .input-group { display: flex; gap: 10px; margin-bottom: 15px; }
            .input-box { flex: 1; background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.2); border-radius: 12px; padding: 10px; text-align: left; }
            .input-box span { display: block; font-size: 10px; color: #aaa; text-transform: uppercase; margin-bottom: 5px; }
            .input-box input { width: 100%; background: transparent; border: none; color: #fff; font-size: 20px; font-weight: 900; outline: none; font-family: 'Montserrat', sans-serif; }
            
            .btn-main { width: 100%; padding: 18px; background: linear-gradient(90deg, #00f0ff, #0055ff); color: #fff; border: none; border-radius: 14px; font-size: 20px; font-weight: 900; box-shadow: 0 0 20px rgba(0,240,255,0.4); text-transform: uppercase; cursor: pointer; transition: 0.1s; letter-spacing: 1px; }
            .btn-main:active { transform: scale(0.96); }
            .btn-main.magenta { background: linear-gradient(90deg, #ff00ff, #ff0055); box-shadow: 0 0 20px rgba(255,0,255,0.4); }
            .btn-main.dark { background: #1a1a24; border: 1px solid #333; box-shadow: none; color: #aaa; }
            .btn-main:disabled { opacity: 0.5; cursor: not-allowed; }

            #maintenanceOverlay {
                display: none;
                position: fixed;
                inset: 0;
                z-index: 99999;
                background: radial-gradient(circle at center, rgba(40,0,80,0.96), rgba(0,0,0,0.98));
                align-items: center;
                justify-content: center;
                text-align: center;
                padding: 20px;
                box-sizing: border-box;
            }
            .maint-box {
                width: 100%;
                max-width: 360px;
                border: 2px solid var(--neon-cyan);
                border-radius: 24px;
                padding: 28px 18px;
                background: rgba(10,10,20,0.94);
                box-shadow: 0 0 35px rgba(0,240,255,0.42), inset 0 0 25px rgba(255,0,255,0.12);
            }
            .maint-title {
                font-size: 24px;
                font-weight: 900;
                color: var(--neon-cyan);
                text-shadow: 0 0 15px var(--neon-cyan);
                margin-bottom: 14px;
            }
            .maint-text {
                font-size: 15px;
                color: #fff;
                margin: 8px 0;
                line-height: 1.45;
            }
            .maint-brand {
                margin-top: 20px;
                font-size: 18px;
                color: var(--gold);
                font-weight: 900;
                text-shadow: 0 0 12px rgba(255,215,0,0.45);
            }

            .copy-box { background: rgba(0,0,0,0.8); border: 1px dashed var(--neon-cyan); padding: 15px; border-radius: 12px; font-family: monospace; color: var(--neon-cyan); word-break: break-all; margin: 15px 0; font-size: 16px; }
            .top-row { display: flex; justify-content: space-between; align-items: center; padding: 15px 10px; border-bottom: 1px solid rgba(255,255,255,0.05); }
            .top-rank { color: var(--gold); font-weight: 900; width: 30px; font-size: 18px; }

            .profile-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin: 12px 0; }
            .profile-stat {
                background: rgba(0,0,0,0.45);
                border: 1px solid rgba(0,240,255,0.25);
                border-radius: 14px;
                padding: 10px 7px;
                box-shadow: inset 0 0 12px rgba(0,240,255,0.08);
            }
            .profile-stat .label { color: #aaa; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px; }
            .profile-stat .value { color: #fff; font-size: 20px; font-weight: 900; text-shadow: 0 0 10px rgba(0,240,255,0.45); word-break: break-word; }

            #profUid { font-size: 22px !important; letter-spacing: -1px; white-space: nowrap; }
            @media (max-width: 380px) {
                #profUid { font-size: 19px !important; letter-spacing: -1.5px; }
                .profile-stat .value { font-size: 19px; }
            }

            .history-list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
            .history-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 10px;
                background: rgba(0,0,0,0.38);
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 12px;
                padding: 10px 11px;
                text-align: left;
            }
            .history-main { color: #fff; font-size: 13px; font-weight: 900; line-height: 1.25; }
            .history-time { color: #777; font-size: 10px; margin-top: 3px; }
            .promo-card-title { color: var(--gold); font-size: 18px; font-weight: 900; margin: 8px 0 12px; text-shadow: 0 0 10px rgba(255,215,0,0.35); }
            .small-info { color: #777; font-size: 11px; margin-top: 12px; line-height: 1.45; }
            .bonus-grid { display: grid; grid-template-columns: 1fr; gap: 12px; margin-top: 14px; }
            .bonus-choice {
                position: relative;
                border: 1px solid rgba(0,240,255,0.38);
                border-radius: 18px;
                padding: 18px 16px;
                background: linear-gradient(135deg, rgba(0,240,255,0.10), rgba(255,0,255,0.12)), rgba(0,0,0,0.52);
                box-shadow: 0 0 20px rgba(0,240,255,0.16), inset 0 0 18px rgba(255,255,255,0.04);
                color: #fff;
                font-size: 18px;
                font-weight: 900;
                text-transform: uppercase;
                cursor: pointer;
                overflow: hidden;
            }
            .bonus-choice:before {
                content: "";
                position: absolute;
                inset: -60% -20%;
                background: linear-gradient(90deg, transparent, rgba(255,255,255,0.16), transparent);
                transform: rotate(18deg) translateX(-120%);
                animation: bonusShine 3.2s infinite;
            }
            .bonus-choice span { position: relative; z-index: 1; }
            .bonus-choice.roulette { border-color: rgba(255,215,0,0.55); box-shadow: 0 0 22px rgba(255,215,0,0.16), inset 0 0 20px rgba(255,0,255,0.08); }
            @keyframes bonusShine { 0% { transform: rotate(18deg) translateX(-130%); } 48%,100% { transform: rotate(18deg) translateX(130%); } }
            .roulette-stage { display: grid; place-items: center; margin: 16px 0 18px; position: relative; }
            .roulette-pointer {
                width: 0;
                height: 0;
                border-left: 16px solid transparent;
                border-right: 16px solid transparent;
                border-top: 30px solid var(--gold);
                filter: drop-shadow(0 0 10px rgba(255,215,0,0.75));
                position: relative;
                z-index: 3;
                margin-bottom: -14px;
            }
            .roulette-wheel {
                width: min(76vw, 300px);
                height: min(76vw, 300px);
                border-radius: 50%;
                position: relative;
                border: 5px solid rgba(0,240,255,0.75);
                background: conic-gradient(#00f0ff 0deg 72deg, #ff00ff 72deg 144deg, #ffd700 144deg 216deg, #00ff88 216deg 288deg, #3b2a66 288deg 360deg);
                box-shadow: 0 0 34px rgba(0,240,255,0.34), inset 0 0 30px rgba(0,0,0,0.42);
                transition: transform 3.8s cubic-bezier(0.12, 0.78, 0.18, 1);
                overflow: hidden;
            }
            .roulette-wheel:before {
                content: "";
                position: absolute;
                inset: 12px;
                border-radius: 50%;
                border: 2px dashed rgba(255,255,255,0.45);
                box-shadow: inset 0 0 18px rgba(0,0,0,0.35);
            }
            .roulette-wheel:after {
                content: "💎";
                position: absolute;
                inset: 50%;
                width: 70px;
                height: 70px;
                margin: -35px;
                border-radius: 50%;
                display: grid;
                place-items: center;
                background: rgba(0,0,0,0.78);
                border: 3px solid #fff;
                box-shadow: 0 0 20px rgba(255,255,255,0.32);
                font-size: 32px;
            }
            .roulette-label {
                position: absolute;
                left: 50%;
                top: 50%;
                width: 88px;
                margin-left: -44px;
                margin-top: -13px;
                color: #fff;
                font-size: 13px;
                font-weight: 900;
                text-shadow: 0 2px 8px rgba(0,0,0,0.8);
                transform-origin: 44px 13px;
            }
            .roulette-label.p1 { transform: rotate(36deg) translateY(-104px) rotate(-36deg); }
            .roulette-label.p2 { transform: rotate(108deg) translateY(-104px) rotate(-108deg); }
            .roulette-label.p3 { transform: rotate(180deg) translateY(-104px) rotate(-180deg); }
            .roulette-label.p4 { transform: rotate(252deg) translateY(-104px) rotate(-252deg); }
            .roulette-label.p5 { transform: rotate(324deg) translateY(-104px) rotate(-324deg); }
            .roulette-odds {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 7px;
                margin: 12px 0 6px;
            }
            .roulette-odds div {
                padding: 8px 6px;
                border-radius: 12px;
                background: rgba(0,0,0,0.34);
                border: 1px solid rgba(255,255,255,0.08);
                color: rgba(255,255,255,0.86);
                font-size: 11px;
                font-weight: 900;
            }
            .roulette-result {
                min-height: 46px;
                margin: 12px 0;
                color: #fff;
                font-size: 18px;
                font-weight: 900;
                text-shadow: 0 0 14px rgba(0,240,255,0.55);
                white-space: pre-line;
            }
            .roulette-result.win { color: var(--gold); animation: prizePop .8s ease both; }
            @keyframes prizePop { 0% { transform: scale(.86); opacity: .4; } 55% { transform: scale(1.12); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }

        
            /* VIP ХОТ ТАП — красивый экран загрузки */
            #vipLoader {
                position: fixed;
                inset: 0;
                z-index: 99999;
                display: flex;
                align-items: center;
                justify-content: center;
                background:
                    radial-gradient(circle at 50% 20%, rgba(0,240,255,.22), transparent 34%),
                    radial-gradient(circle at 50% 78%, rgba(255,0,200,.18), transparent 38%),
                    linear-gradient(180deg, #06010d 0%, #12001f 55%, #030008 100%);
                color: #fff;
                overflow: hidden;
                transition: opacity .45s ease, visibility .45s ease;
            }
            #vipLoader.hide {
                opacity: 0;
                visibility: hidden;
                pointer-events: none;
            }
            #vipLoader::before {
                content: "";
                position: absolute;
                inset: -20%;
                background:
                    linear-gradient(rgba(0,240,255,.18) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(0,240,255,.14) 1px, transparent 1px);
                background-size: 48px 48px;
                transform: perspective(500px) rotateX(62deg) translateY(18%);
                transform-origin: center bottom;
                animation: loaderGrid 2.2s linear infinite;
                opacity: .38;
            }
            @keyframes loaderGrid {
                from { background-position: 0 0, 0 0; }
                to { background-position: 0 48px, 0 48px; }
            }
            .loaderBox {
                position: relative;
                width: min(86vw, 390px);
                padding: 34px 24px;
                border: 2px solid rgba(0,240,255,.75);
                border-radius: 28px;
                background: rgba(10, 6, 22, .74);
                box-shadow: 0 0 28px rgba(0,240,255,.35), inset 0 0 22px rgba(255,0,200,.12);
                text-align: center;
            }
            .loaderLogo {
                font-size: 30px;
                line-height: 1;
                filter: drop-shadow(0 0 14px rgba(0,240,255,.75));
                animation: loaderPulse 1.4s ease-in-out infinite;
            }
            @keyframes loaderPulse {
                0%,100% { transform: scale(1); opacity: .9; }
                50% { transform: scale(1.09); opacity: 1; }
            }
            .loaderTitle {
                margin-top: 14px;
                font-size: 26px;
                font-weight: 900;
                letter-spacing: 1px;
                color: #fff;
                text-shadow: 0 0 14px rgba(0,240,255,.7), 0 0 22px rgba(255,0,200,.45);
            }
            .loaderText {
                margin-top: 8px;
                font-size: 14px;
                font-weight: 800;
                color: #b9f8ff;
                letter-spacing: 2px;
                text-transform: uppercase;
            }
            .loaderBar {
                margin: 24px auto 0;
                height: 12px;
                width: 86%;
                border-radius: 999px;
                overflow: hidden;
                background: rgba(255,255,255,.09);
                border: 1px solid rgba(0,240,255,.45);
            }
            .loaderBar span {
                display: block;
                height: 100%;
                width: 42%;
                border-radius: 999px;
                background: linear-gradient(90deg, #00f0ff, #ff00cc, #ffd000);
                box-shadow: 0 0 18px rgba(0,240,255,.7);
                animation: loaderBarMove 1.15s ease-in-out infinite;
            }
            @keyframes loaderBarMove {
                0% { transform: translateX(-105%); }
                100% { transform: translateX(245%); }
            }
            .loaderHint {
                margin-top: 14px;
                font-size: 12px;
                color: rgba(255,255,255,.62);
            }

        
            .toast-box {
                position: fixed;
                top: 82px;
                left: 50%;
                transform: translateX(-50%) translateY(-20px);
                width: calc(100% - 34px);
                max-width: 440px;
                z-index: 99999;
                padding: 14px 16px;
                border-radius: 18px;
                background: rgba(10, 10, 18, 0.92);
                border: 1px solid rgba(0, 240, 255, 0.45);
                box-shadow: 0 0 20px rgba(0, 240, 255, 0.22), inset 0 0 18px rgba(255,255,255,0.04);
                color: #fff;
                font-size: 15px;
                font-weight: 900;
                line-height: 1.25;
                opacity: 0;
                pointer-events: none;
                transition: opacity .22s ease, transform .22s ease;
                backdrop-filter: blur(10px);
                text-shadow: 0 0 10px rgba(255,255,255,0.28);
            }
            .toast-box.show { opacity: 1; transform: translateX(-50%) translateY(0); }
            .toast-box.success { border-color: rgba(0,255,140,0.65); box-shadow: 0 0 22px rgba(0,255,140,0.22); }
            .toast-box.warn { border-color: rgba(255,215,0,0.7); box-shadow: 0 0 22px rgba(255,215,0,0.18); }
            .toast-box.error { border-color: rgba(255,0,90,0.7); box-shadow: 0 0 22px rgba(255,0,90,0.22); }

            .vip-modal-overlay {
                position: fixed;
                inset: 0;
                z-index: 100000;
                display: none;
                align-items: center;
                justify-content: center;
                padding: 22px;
                box-sizing: border-box;
                background: radial-gradient(circle at 50% 28%, rgba(0,240,255,0.18), transparent 34%), rgba(0,0,0,0.72);
                backdrop-filter: blur(12px);
                opacity: 0;
                transition: opacity .2s ease;
            }
            .vip-modal-overlay.show { display: flex; opacity: 1; }
            .vip-modal {
                width: min(100%, 420px);
                border: 2px solid rgba(0,240,255,0.68);
                border-radius: 24px;
                padding: 20px;
                background: linear-gradient(145deg, rgba(12,12,22,0.98), rgba(22,8,32,0.98));
                box-shadow: 0 0 36px rgba(0,240,255,0.32), inset 0 0 22px rgba(255,0,255,0.12);
                transform: translateY(18px) scale(.96);
                transition: transform .2s ease;
                text-align: left;
            }
            .vip-modal-overlay.show .vip-modal { transform: translateY(0) scale(1); }
            .vip-modal-icon {
                width: 54px;
                height: 54px;
                margin: 0 auto 12px;
                border-radius: 18px;
                display: grid;
                place-items: center;
                font-size: 28px;
                background: rgba(0,240,255,0.12);
                border: 1px solid rgba(0,240,255,0.45);
                box-shadow: 0 0 18px rgba(0,240,255,0.28);
            }
            .vip-modal-title {
                text-align: center;
                font-size: 21px;
                font-weight: 900;
                color: #fff;
                text-shadow: 0 0 14px rgba(0,240,255,.55);
                margin-bottom: 8px;
                text-transform: uppercase;
            }
            .vip-modal-text {
                text-align: center;
                color: rgba(255,255,255,.72);
                font-size: 13px;
                line-height: 1.45;
                margin-bottom: 14px;
            }
            .vip-modal-field { margin: 12px 0; }
            .vip-modal-label {
                display: block;
                color: var(--neon-cyan);
                font-size: 11px;
                font-weight: 900;
                letter-spacing: 1px;
                text-transform: uppercase;
                margin-bottom: 7px;
            }
            .vip-modal-input {
                width: 100%;
                box-sizing: border-box;
                border: 1px solid rgba(255,255,255,0.16);
                border-radius: 14px;
                padding: 14px 13px;
                background: rgba(0,0,0,0.42);
                color: #fff;
                outline: none;
                font: 900 16px 'Montserrat', sans-serif;
                box-shadow: inset 0 0 14px rgba(0,240,255,0.06);
            }
            .vip-modal-input:focus { border-color: var(--neon-cyan); box-shadow: 0 0 14px rgba(0,240,255,0.22), inset 0 0 14px rgba(0,240,255,0.08); }
            .vip-modal-actions { display: grid; grid-template-columns: 1fr 1.2fr; gap: 10px; margin-top: 16px; }
            .vip-modal-btn {
                border: 0;
                border-radius: 14px;
                padding: 14px 10px;
                color: #fff;
                font: 900 14px 'Montserrat', sans-serif;
                text-transform: uppercase;
                cursor: pointer;
            }
            .vip-modal-cancel { background: rgba(255,255,255,0.10); border: 1px solid rgba(255,255,255,0.14); color: #cfcfcf; }
            .vip-modal-ok { background: linear-gradient(90deg, #00f0ff, #ff00ff); box-shadow: 0 0 20px rgba(0,240,255,0.28); }

        
            .balance-card {
                position: relative;
                overflow: hidden;
            }
            .balance-card:before {
                content: "";
                position: absolute;
                inset: -2px;
                background: radial-gradient(circle at 20% 20%, rgba(255,215,0,0.16), transparent 42%),
                            radial-gradient(circle at 80% 30%, rgba(0,240,255,0.12), transparent 45%);
                pointer-events: none;
            }
            .balance-card > * { position: relative; z-index: 1; }
            .slots-win .reel {
                border-color: rgba(255,215,0,0.95) !important;
                box-shadow: 0 0 22px rgba(255,215,0,0.42), inset 0 0 16px rgba(255,215,0,0.16) !important;
                animation: winPulse .55s ease-in-out 3;
            }
            @keyframes winPulse {
                0% { transform: scale(1); }
                50% { transform: scale(1.08); }
                100% { transform: scale(1); }
            }
            .top-podium {
                display: grid;
                grid-template-columns: 1fr 1.15fr 1fr;
                gap: 8px;
                align-items: end;
                margin: 12px 0 16px;
            }
            .podium-card {
                background: rgba(0,0,0,0.45);
                border: 1px solid rgba(255,255,255,0.10);
                border-radius: 16px;
                padding: 10px 6px;
                min-height: 74px;
                box-shadow: inset 0 0 14px rgba(255,255,255,0.04);
            }
            .podium-card.first {
                min-height: 92px;
                border-color: rgba(255,215,0,0.65);
                box-shadow: 0 0 20px rgba(255,215,0,0.18), inset 0 0 16px rgba(255,215,0,0.08);
            }
            .podium-place { font-size: 22px; margin-bottom: 5px; }
            .podium-id { color: #fff; font-size: 11px; font-weight: 900; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .podium-bal { color: var(--gold); font-size: 12px; font-weight: 900; margin-top: 4px; }
            .top-row {
                border-radius: 14px;
                margin-bottom: 7px;
                background: rgba(0,0,0,0.28);
                border: 1px solid rgba(255,255,255,0.06);
            }
            .crash-monitor {
                background:
                    radial-gradient(circle at 50% 70%, rgba(255,0,255,0.10), transparent 38%),
                    radial-gradient(circle at 50% 30%, rgba(0,240,255,0.10), transparent 44%),
                    rgba(0,0,0,0.45);
            }
            .btn-main {
                position: relative;
                overflow: hidden;
            }
            .btn-main:after {
                content: "";
                position: absolute;
                top: 0;
                left: -80%;
                width: 45%;
                height: 100%;
                background: linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent);
                transform: skewX(-20deg);
                animation: btnShine 3.5s infinite;
            }
            @keyframes btnShine {
                0% { left: -80%; }
                42%,100% { left: 125%; }
            }

        </style>
    </head>
    <body>
        <div id="gameToast" class="toast-box"></div>
        <div id="vipModalOverlay" class="vip-modal-overlay" aria-hidden="true">
            <div class="vip-modal" role="dialog" aria-modal="true" aria-labelledby="vipModalTitle">
                <div class="vip-modal-icon" id="vipModalIcon">💎</div>
                <div class="vip-modal-title" id="vipModalTitle">VIP ОКНО</div>
                <div class="vip-modal-text" id="vipModalText"></div>
                <div class="vip-modal-field" id="vipModalField">
                    <label class="vip-modal-label" id="vipModalLabel" for="vipModalInput">Введите значение</label>
                    <input class="vip-modal-input" id="vipModalInput" autocomplete="off">
                </div>
                <div class="vip-modal-actions">
                    <button class="vip-modal-btn vip-modal-cancel" id="vipModalCancel" type="button">Отмена</button>
                    <button class="vip-modal-btn vip-modal-ok" id="vipModalOk" type="button">Готово</button>
                </div>
            </div>
        </div>
        <div id="vipLoader">
            <div class="loaderBox">
                <div class="loaderLogo">💎</div>
                <div class="loaderTitle">VIP ХОТ ТАП</div>
                <div class="loaderText">Загрузка казино...</div>
                <div class="loaderBar"><span></span></div>
                <div class="loaderHint">Подключаем банк, краш и слоты</div>
            </div>
        </div>

        <video autoplay loop muted playsinline class="back-video"><source src="https://raw.githubusercontent.com/venom142/ton-casino-bot/main/gemini_generated_video_9fc75b5d.mp4" type="video/mp4"></video>
        <audio id="bgm" loop src="https://files.catbox.moe/ef3c37.mp3"></audio>

        <div id="maintenanceOverlay">
            <div class="maint-box">
                <div class="maint-title">🛠 ТЕХНИЧЕСКИЙ ПЕРЕРЫВ</div>
                <div class="maint-text">Игра временно недоступна.</div>
                <div class="maint-text">Мы скоро вернёмся.</div>
                <div class="maint-brand">💎 VIP ХОТ ТАП 💎</div>
            </div>
        </div>

        <div class="bottom-nav">
            <div class="bottom-nav-item active" id="bnav-main" onclick="goMain()">
                <div class="icon">🏠</div>
                <div>Главная</div>
            </div>
            <div class="bottom-nav-item" id="bnav-promo" onclick="sh(7)">
                <div class="icon">🎁</div>
                <div>Бонусы</div>
            </div>
            <div class="bottom-nav-item" id="bnav-profile" onclick="sh(5)">
                <div class="icon">👤</div>
                <div>Профиль</div>
            </div>
            <div class="bottom-nav-item" id="bnav-bank" onclick="sh(4)">
                <div class="icon">🏦</div>
                <div>Банк</div>
            </div>
            <div class="bottom-nav-item" id="bnav-history" onclick="sh(8)">
                <div class="icon">🕘</div>
                <div>История</div>
            </div>
        </div>

        <!-- ВКЛАДКА 1: СЛОТЫ -->
        <div id="pg1" class="page active">
            <div class="vip-title">💎 VIP ХОТ ТАП 💎</div>
            <div class="sub-nav">
                <button class="sub-tab sub-tab-slots active" onclick="sh(1)">🎰 Слоты</button>
                <button class="sub-tab sub-tab-crash" onclick="sh(2)">🚀 Краш</button>
            </div>
            <div class="vip-balance-card">
                <div class="vip-balance-title">БАЛАНС ХОТ ТАП</div>
                <div class="vip-balance-value">
                    <span class="vip-balance-number" id="bal1">0</span>
                    <span class="vip-balance-gem">💎</span>
                </div>
            </div>
            
            <div class="reel-cont">
                <div class="reel"><div class="strip" id="s1"><div class="sym">🍒</div></div></div>
                <div class="reel"><div class="strip" id="s2"><div class="sym">🔔</div></div></div>
                <div class="reel"><div class="strip" id="s3"><div class="sym">🍋</div></div></div>
            </div>
            
            <div class="input-group">
                <div class="input-box" style="flex: 0.3;" onclick="chBet(-10, 'bet1')"><div style="text-align:center; font-size:24px; color:#aaa; margin-top:5px;">-</div></div>
                <div class="input-box"><span style="text-align:center;">Ставка (💎)</span><input type="number" id="bet1" value="10" step="10" style="text-align:center;" readonly></div>
                <div class="input-box" style="flex: 0.3;" onclick="chBet(10, 'bet1')"><div style="text-align:center; font-size:24px; color:#aaa; margin-top:5px;">+</div></div>
            </div>
            <button class="btn-main" onclick="playSpin()" id="btnSpin">КРУТИТЬ</button>
        </div>

        <!-- ВКЛАДКА 2: КРАШ -->
        <div id="pg2" class="page">
            <div class="vip-title">💎 VIP ХОТ ТАП 💎</div>
            <div class="sub-nav">
                <button class="sub-tab sub-tab-slots" onclick="sh(1)">🎰 Слоты</button>
                <button class="sub-tab sub-tab-crash active" onclick="sh(2)">🚀 Краш</button>
            </div>
            <div class="vip-balance-card">
                <div class="vip-balance-title">БАЛАНС ХОТ ТАП</div>
                <div class="vip-balance-value">
                    <span class="vip-balance-number" id="bal2">0</span>
                    <span class="vip-balance-gem">💎</span>
                </div>
            </div>
            
            <div class="crash-monitor" id="crashMonitor">
                <div class="rocket-trail" id="rocketTrail"></div>
                <div class="rocket-visual" id="rocketVisual">🚀</div>
                <div class="crash-x" id="cX">1.00x</div>
                <div class="crash-status" id="cMsg">ОЖИДАНИЕ...</div>
            </div>

            <div id="crashResult" class="crash-result">Сделай ставку до старта раунда</div>

            <div class="crash-mini-row">
                <div class="crash-mini-card">
                    <div class="crash-mini-label">Игроков</div>
                    <div class="crash-mini-value" id="crashPlayers">0</div>
                </div>
                <div class="crash-mini-card">
                    <div class="crash-mini-label">Моя ставка</div>
                    <div class="crash-mini-value"><span id="crashMyBet">0</span> 💎</div>
                </div>
            </div>

            <div class="crash-history" id="crashHistory">
                <div class="crash-chip low">--</div>
            </div>

            <div class="input-group">
                <div class="input-box" style="flex: 0.3;" onclick="chBet(-10, 'bet2')"><div style="text-align:center; font-size:24px; color:#aaa; margin-top:5px;">-</div></div>
                <div class="input-box"><span style="text-align:center;">Ставка (💎)</span><input type="number" id="bet2" value="10" step="10" style="text-align:center;" readonly></div>
                <div class="input-box" style="flex: 0.3;" onclick="chBet(10, 'bet2')"><div style="text-align:center; font-size:24px; color:#aaa; margin-top:5px;">+</div></div>
            </div>

            <div class="quick-bets">
                <button class="quick-bet" onclick="setCrashBet(10)">10</button>
                <button class="quick-bet" onclick="setCrashBet(50)">50</button>
                <button class="quick-bet" onclick="setCrashBet(100)">100</button>
                <button class="quick-bet" onclick="setCrashBet(500)">500</button>
                <button class="quick-bet" onclick="setCrashBet('all')">ALL</button>
            </div>

            <button class="btn-main magenta" onclick="placeCrashBet()" id="btnCrash">ПОСТАВИТЬ</button>
        </div>

        <!-- ВКЛАДКА 3: ТОП -->
        <div id="pg3" class="page">
            <div class="card" style="padding:10px;">
                <h2 style="color:var(--neon-cyan); margin:10px 0; font-size:18px;">🏆 ЛУЧШИЕ ИГРОКИ</h2>
                <div id="topList">Загрузка...</div>
                <button class="btn-main dark" onclick="sh(5)" style="margin-top: 15px; font-size: 14px;">🔙 НАЗАД В ПРОФИЛЬ</button>
            </div>
        </div>

        <!-- ВКЛАДКА 4: БАНК -->
        <div id="pg4" class="page">
            <div class="card">
                <h2 style="color:var(--neon-magenta); margin-top:0;">КАССА</h2>
                <p style="color:#aaa; font-size:13px; text-align:left;">Пополнение автоматическое. Скопируй адрес ниже и отправь на него TON. <b>Обязательно укажи свой UID в комментарии (Memo)!</b> TON будут конвертированы в 💎 ХОТ ТАП.</p>
                <div style="color:#00f0ff; font-size:13px; font-weight:900; margin:8px 0 14px;">Курс: 1 TON = 10 000 💎 ХОТ ТАП</div>
                <div class="copy-box" onclick="copy('UQDoTj0hCwJbI-9fziRCyUZzO2XHmtcDzuiAiGjxG21G3dIX')">UQDoTj0hCwJbI-9fziRCyUZzO2XHmtcDzuiAiGjxG21G3dIX</div>
                <p style="color:#ff0055; font-size:12px; font-weight:bold;">⚠️ ТВОЙ КОД ДЛЯ MEMO / COMMENT:</p>
                <div class="copy-box" style="border-color:#ff0055; font-size:24px; font-weight:bold; color:#fff;" onclick="copy(uid.toString())" id="memoText">...</div>
                
                <button class="btn-main" style="margin-top:20px; font-size:16px;" onclick="withdraw()">💸 ВЫВЕСТИ СРЕДСТВА</button>
            </div>
        </div>

        <!-- ВКЛАДКА 5: ПРОФИЛЬ -->
        <div id="pg5" class="page">
            <div class="card">
                <h2 style="color:var(--neon-cyan); margin-top:0;">👤 VIP ПРОФИЛЬ</h2>
                <div class="profile-grid">
                    <div class="profile-stat"><div class="label">ID игрока</div><div class="value" id="profUid">...</div></div>
                    <div class="profile-stat"><div class="label">Баланс</div><div class="value"><span id="balP">0</span> 💎</div></div>
                    <div class="profile-stat"><div class="label">Спины</div><div class="value" id="profSpins">0</div></div>
                    <div class="profile-stat"><div class="label">Победы</div><div class="value" id="profWins">0</div></div>
                    <div class="profile-stat"><div class="label">Промо</div><div class="value" id="profPromos">0</div></div>
                    <div class="profile-stat"><div class="label">Версия</div><div class="value" style="font-size:15px;" id="profVersion">Alpha</div></div>
                </div>
            </div>
            
            <button class="btn-main" onclick="sh(3)" style="margin-bottom: 10px; font-size: 16px;">🏆 ТОП ИГРОКОВ</button>
            <button class="btn-main dark" onclick="sh(6)" style="font-size: 16px;">⚙️ НАСТРОЙКИ</button>
        </div>

        <!-- ВКЛАДКА 6: НАСТРОЙКИ -->
        <div id="pg6" class="page">
            <div class="card">
                <h2 style="color:var(--neon-cyan); margin-top:0;">⚙️ НАСТРОЙКИ</h2>
                <button class="btn-main dark" style="margin-top:10px; font-size:16px; color:#fff; border-color:var(--neon-cyan);" onclick="toggleAudio()" id="audioBtn">🔊 ВЫКЛЮЧИТЬ ЗВУК</button>
                <div class="profile-stat" style="margin-top:15px;">
                    <div class="label">Язык</div>
                    <div class="value">RU</div>
                </div>
                <div class="profile-stat" style="margin-top:10px;">
                    <div class="label">Версия игры</div>
                    <div class="value" style="font-size:16px;">VIP ХОТ ТАП Alpha 1.0</div>
                </div>
                <button class="btn-main dark" onclick="sh(5)" style="margin-top: 15px; font-size: 14px;">🔙 НАЗАД В ПРОФИЛЬ</button>
            </div>
        </div>

        <!-- ВКЛАДКА 7: БОНУСЫ -->
        <div id="pg7" class="page">
            <div class="card">
                <div class="promo-card-title">🎁 БОНУСЫ</div>
                <div class="small-info">Выбирай бонус: активируй промокод или крути бесплатную рулетку 1 раз в 24 часа.</div>
                <div class="bonus-grid">
                    <button class="bonus-choice" onclick="sh(9)"><span>🎁 Промокод</span></button>
                    <button class="bonus-choice roulette" onclick="sh(10)"><span>🎡 Рулетка</span></button>
                    <button class="bonus-choice" onclick="sh(11)" style="border-color: rgba(0,255,140,0.55); box-shadow: 0 0 22px rgba(0,255,140,0.16), inset 0 0 20px rgba(0,255,140,0.08);"><span>📢 Задания</span></button>
                </div>
            </div>
        </div>

        <!-- ВКЛАДКА 8: ИСТОРИЯ -->
        <div id="pg8" class="page">
            <div class="card">
                <div class="promo-card-title">📜 ПОСЛЕДНИЕ ДЕЙСТВИЯ</div>
                <div id="historyListPage8" class="history-list">
                    <div class="history-row"><div><div class="history-main">Пока действий нет</div><div class="history-time">Сыграй или пополни баланс</div></div></div>
                </div>
            </div>
        </div>

        <!-- ВКЛАДКА 9: ПРОМОКОД -->
        <div id="pg9" class="page">
            <div class="card">
                <div class="promo-card-title">🎁 ПРОМОКОД</div>
                <div class="input-box" style="margin-bottom:12px;">
                    <span>Введите промокод</span>
                    <input type="text" id="promoInput" placeholder="VIPSTART" style="text-transform:uppercase;">
                </div>
                <button class="btn-main magenta" onclick="activatePromoFromProfile()" style="font-size:16px;">АКТИВИРОВАТЬ</button>
                <button class="btn-main dark" onclick="sh(7)" style="margin-top:12px; font-size:14px;">🔙 НАЗАД К БОНУСАМ</button>
            </div>
        </div>

        <!-- ВКЛАДКА 10: РУЛЕТКА -->
        <div id="pg10" class="page">
            <div class="card">
                <div class="promo-card-title">🎡 Бесплатная рулетка</div>
                <div class="small-info">Возможные призы и шансы выпадения. Доступно 1 раз в 24 часа.</div>
                <div class="roulette-odds">
                    <div>💎 +10 — 30%</div><div>💎 +25 — 20%</div>
                    <div>💎 +50 — 10%</div><div>💎 +100 — 5%</div>
                    <div>😭 Пусто — 35%</div>
                </div>
                <div class="roulette-stage">
                    <div class="roulette-pointer"></div>
                    <div class="roulette-wheel" id="rouletteWheel">
                        <div class="roulette-label p1">💎 +10</div>
                        <div class="roulette-label p2">💎 +25</div>
                        <div class="roulette-label p3">💎 +50</div>
                        <div class="roulette-label p4">💎 +100</div>
                        <div class="roulette-label p5">😭 Пусто</div>
                    </div>
                </div>
                <div class="roulette-result" id="rouletteResult">Нажми кнопку и забери бесплатный приз</div>
                <button class="btn-main" onclick="spinBonusRoulette()" id="btnRoulette" style="font-size:16px;">🎡 КРУТИТЬ РУЛЕТКУ</button>
                <button class="btn-main dark" onclick="sh(7)" style="margin-top:12px; font-size:14px;">🔙 НАЗАД К БОНУСАМ</button>
            </div>
        </div>

        <div id="pg11" class="page">
            <div class="card">
                <div class="promo-card-title">📢 ЗАДАНИЯ</div>
                <div class="small-info">Выполняй задания и получай бонусы!</div>
                <div id="tasksList" style="margin-top: 14px;">
                    <div class="small-info">Загрузка...</div>
                </div>
                <button class="btn-main dark" onclick="sh(7)" style="margin-top: 12px; font-size: 14px;">🔙 НАЗАД К БОНУСАМ</button>
            </div>
        </div>

        <script>

            function hideVipLoader() {
                const loader = document.getElementById('vipLoader');
                if (!loader) return;
                loader.classList.add('hide');
                setTimeout(() => loader.remove(), 650);
            }
            window.addEventListener('load', () => setTimeout(hideVipLoader, 900));
            setTimeout(hideVipLoader, 4500);

            const tg = window.Telegram?.WebApp || {
                initDataUnsafe: {},
                expand: () => {},
                ready: () => {}
            };
            try { tg.expand(); tg.ready?.(); } catch(e) {}
            

            let toastTimer = null;
            function showToast(msg, type = "info") {
                const box = document.getElementById('gameToast');
                if (!box) return;
                box.className = 'toast-box ' + type;
                box.textContent = msg || '';
                clearTimeout(toastTimer);
                requestAnimationFrame(() => box.classList.add('show'));
                toastTimer = setTimeout(() => {
                    box.classList.remove('show');
                }, 2300);
            }
            function gameAlert(msg) {
                const t = String(msg || '');
                const low = t.toLowerCase();
                let type = "info";
                if (t.includes('✅') || t.includes('🎁') || t.includes('🎡 Выпал') || t.includes('Начислено') || t.includes('Выигрыш') || t.includes('забрал') || low.includes('скопировано')) type = "success";
                if (t.includes('⚠️') || low.includes('уже') || low.includes('введите') || low.includes('лимит')) type = "warn";
                if (t.includes('❌') || low.includes('ошибка') || low.includes('недостаточно') || low.includes('невер') || low.includes('мало')) type = "error";
                showToast(t, type);
            }

            let activeVipModalResolve = null;
            function closeVipModal(value = null) {
                const overlay = document.getElementById('vipModalOverlay');
                if (overlay) {
                    overlay.classList.remove('show');
                    overlay.setAttribute('aria-hidden', 'true');
                }
                if (activeVipModalResolve) {
                    const resolve = activeVipModalResolve;
                    activeVipModalResolve = null;
                    resolve(value);
                }
            }
            function vipPrompt({ title, text = '', label, placeholder = '', type = 'text', icon = '💎', okText = 'Готово' }) {
                return new Promise((resolve) => {
                    const overlay = document.getElementById('vipModalOverlay');
                    const input = document.getElementById('vipModalInput');
                    const field = document.getElementById('vipModalField');
                    const ok = document.getElementById('vipModalOk');
                    const cancel = document.getElementById('vipModalCancel');
                    if (!overlay || !input || !ok || !cancel) {
                        gameAlert('Ошибка окна ввода');
                        resolve(null);
                        return;
                    }
                    activeVipModalResolve = resolve;
                    document.getElementById('vipModalIcon').textContent = icon;
                    document.getElementById('vipModalTitle').textContent = title || 'VIP ОКНО';
                    document.getElementById('vipModalText').textContent = text || '';
                    document.getElementById('vipModalLabel').textContent = label || 'Введите значение';
                    ok.textContent = okText;
                    input.value = '';
                    input.type = type;
                    input.placeholder = placeholder;
                    if (field) field.style.display = 'block';
                    overlay.classList.add('show');
                    overlay.setAttribute('aria-hidden', 'false');
                    setTimeout(() => input.focus(), 80);
                    ok.onclick = () => closeVipModal(input.value.trim());
                    cancel.onclick = () => closeVipModal(null);
                    overlay.onclick = (e) => { if (e.target === overlay) closeVipModal(null); };
                    input.onkeydown = (e) => {
                        if (e.key === 'Enter') closeVipModal(input.value.trim());
                        if (e.key === 'Escape') closeVipModal(null);
                    };
                });
            }

            const uid = tg.initDataUnsafe?.user?.id || 123456789;

            async function checkMaintenance() {
                try {
                    const r = await fetch('/api/maintenance');
                    const d = await r.json();
                    const overlay = document.getElementById('maintenanceOverlay');
                    if (overlay) overlay.style.display = d.maintenance ? 'flex' : 'none';
                } catch(e) {}
            }
            checkMaintenance();
            setInterval(checkMaintenance, 5000);
            const SLOT_MIN_BET = 10;
            let bal = 0, isSlotGame = false;
            let crashPollInterval = null;
            let lastCrashStatus = '';
            let crashAnimFrame = null;
            let crashStatus = 'betting';
            let syncedStartTime = 0;
            let lastCrashText = '';
            let lastCrashRoundResultShown = false;
            let lastCashoutVisualRound = null;

            function setCrashMultiplier(value) {
                const num = Number(value);
                if (!isFinite(num)) return;
                const txt = num.toFixed(2) + "x";
                if (txt === lastCrashText) return;
                lastCrashText = txt;
                requestAnimationFrame(function () {
                    const el = document.getElementById("cX");
                    if (el) el.innerText = txt;
                });
            }

            function stopCrashAnimation() {
                if (crashAnimFrame) {
                    cancelAnimationFrame(crashAnimFrame);
                    crashAnimFrame = null;
                }
            }

            function animateCrashMultiplier() {
                if (crashStatus !== 'flying' || !syncedStartTime) return;
                const elapsed = Date.now() - syncedStartTime;
                const current = elapsed < 0 ? 1.00 : Math.pow(1.05, elapsed / 500);
                setCrashMultiplier(current);
                crashAnimFrame = requestAnimationFrame(animateCrashMultiplier);
            }

            function startCrashAnimation(startTime, serverTime) {
                const nowClient = Date.now();
                syncedStartTime = startTime + (nowClient - serverTime);
                if (!crashAnimFrame) animateCrashMultiplier();
            }


            function setCrashBet(value) {
                const inp = document.getElementById('bet2');
                if (!inp) return;
                if (value === 'all') inp.value = Math.max(10, Math.floor(bal || 10));
                else inp.value = Math.max(10, Math.floor(Number(value) || 10));
            }

            function crashChipClass(x) {
                const n = Number(x);
                if (n >= 30) return 'max';
                if (n >= 5) return 'high';
                if (n >= 2) return 'mid';
                return 'low';
            }

            function renderCrashHistory(history) {
                const box = document.getElementById('crashHistory');
                if (!box) return;
                if (!history || history.length === 0) {
                    box.innerHTML = '<div class="crash-chip low">--</div>';
                    return;
                }
                box.innerHTML = history.map(x => {
                    const n = Number(x || 0);
                    return '<div class="crash-chip ' + crashChipClass(n) + '">' + n.toFixed(2) + 'x</div>';
                }).join('');
            }

            function setCrashResult(text, type) {
                const el = document.getElementById('crashResult');
                if (!el) return;
                el.innerText = text || '';
                if (type === 'win') el.style.color = '#00ff66';
                else if (type === 'lose') el.style.color = '#ff4a4a';
                else if (type === 'wait') el.style.color = '#ffd700';
                else el.style.color = '#aaa';
            }


            function setRocketState(state, multiplier = 1) {
                const rocket = document.getElementById('rocketVisual');
                const trail = document.getElementById('rocketTrail');
                const monitor = document.getElementById('crashMonitor');
                const msg = document.getElementById('cMsg');

                if (!rocket || !trail || !monitor) return;

                rocket.className = 'rocket-visual';
                trail.className = 'rocket-trail';
                monitor.classList.remove('cashout-glow', 'boom-glow');

                rocket.style.opacity = '0';
                trail.style.opacity = '0';
                rocket.innerText = '🚀';

                if (state === 'idle') {
                    rocket.style.transform = 'translate(-50%, -50%) translateY(38px) scale(0.8) rotate(-12deg)';
                    if (msg) msg.innerText = 'СДЕЛАЙ СТАВКУ ДО СТАРТА';
                    return;
                }

                if (state === 'fly') {
                    const m = Math.max(1, Math.min(Number(multiplier) || 1, 30));
                    const y = 58 - (m - 1) * 2.4;

                    rocket.innerText = '🚀';
                    rocket.style.opacity = '1';
                    trail.style.opacity = '0.8';
                    rocket.style.transform = 'translate(-50%, -50%) translateY(' + Math.max(-18, y) + 'px) scale(0.9) rotate(-12deg)';

                    rocket.classList.add('fly');
                    trail.classList.add('show');

                    if (msg) msg.innerText = 'РАКЕТА ЛЕТИТ...';
                    return;
                }

                if (state === 'cashout') {
                    rocket.innerText = '✅';
                    rocket.style.opacity = '1';
                    trail.style.opacity = '0';
                    rocket.style.transform = 'translate(-50%, -50%) translateY(42px) scale(0.72) rotate(0deg)';

                    rocket.classList.add('cashout');
                    monitor.classList.add('cashout-glow');

                    if (msg) msg.innerText = 'КУШ ЗАБРАН';
                    return;
                }

                if (state === 'boom') {
                    rocket.innerText = '💥';
                    rocket.style.opacity = '1';
                    trail.style.opacity = '0';
                    rocket.style.transform = 'translate(-50%, -50%) translateY(28px) scale(0.88) rotate(0deg)';

                    rocket.classList.add('boom');
                    monitor.classList.add('boom-glow');

                    if (msg) msg.innerText = 'РАКЕТА ВЗОРВАЛАСЬ!';
                }
            }


            
            document.getElementById('memoText').innerText = uid;
            const syms = ['🍒','🔔','💎','7️⃣','🍋'];

            let lastMainPage = 1;

            function sh(n) {
                if(n === 1 || n === 2) lastMainPage = n;

                document.querySelectorAll('.page').forEach(e => e.classList.remove('active'));
                const pg = document.getElementById('pg'+n);
                if(pg) pg.classList.add('active');

                document.querySelectorAll('.bottom-nav-item').forEach(e => e.classList.remove('active'));
                if (n===1 || n===2) document.getElementById('bnav-main').classList.add('active');
                else if (n===7 || n===9 || n===10 || n===11) document.getElementById('bnav-promo').classList.add('active');
                else if (n===5 || n===3 || n===6) document.getElementById('bnav-profile').classList.add('active');
                else if (n===4) document.getElementById('bnav-bank').classList.add('active');
                else if (n===8) document.getElementById('bnav-history').classList.add('active');

                if (n===1 || n===2) {
                    document.querySelectorAll('.sub-tab').forEach(e => e.classList.remove('active'));
                    if (n===1) document.querySelectorAll('.sub-tab-slots').forEach(e => e.classList.add('active'));
                    if (n===2) document.querySelectorAll('.sub-tab-crash').forEach(e => e.classList.add('active'));
                }
                
                if(n === 3) loadTop();
                if(n === 5 || n === 8) loadProfile();
                
                if(n === 2) {
                    if(!crashPollInterval) crashPollInterval = setInterval(pollCrashState, 500);
                    pollCrashState();
                } else {
                    if(crashPollInterval) { clearInterval(crashPollInterval); crashPollInterval = null; }
                }
            }

            function goMain() {
                sh(lastMainPage);
            }

            function chBet(d, id) {
                let v = parseFloat(document.getElementById(id).value) + d;
                if(v < SLOT_MIN_BET) v = SLOT_MIN_BET;
                document.getElementById(id).value = Math.floor(v);
            }

            async function copy(t) {
                try {
                    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(t);
                    else {
                        const ta = document.createElement('textarea');
                        ta.value = t;
                        ta.style.position = 'fixed';
                        ta.style.opacity = '0';
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        ta.remove();
                    }
                    gameAlert("✅ Скопировано!");
                } catch(e) {
                    gameAlert("❌ Не удалось скопировать");
                }
            }

            function toggleAudio() {
                const a = document.getElementById('bgm');
                a.muted = !a.muted;
                if(a.muted) { document.getElementById('audioBtn').innerText="🔈 ВКЛЮЧИТЬ ЗВУК"; document.getElementById('audioBtn').style.borderColor="#333"; }
                else { a.play().catch(e=>{}); document.getElementById('audioBtn').innerText="🔊 ВЫКЛЮЧИТЬ ЗВУК"; document.getElementById('audioBtn').style.borderColor="var(--neon-cyan)"; }
            }

            function formatBal(val) {
                return Math.floor(val).toLocaleString('ru-RU');
            }

            function updateBal(newBal) {
                bal = Math.floor(newBal);
                document.getElementById('bal1').innerText = formatBal(bal);
                document.getElementById('bal2').innerText = formatBal(bal);
                const bp = document.getElementById('balP');
                if (bp) bp.innerText = formatBal(bal);
            }

            async function upd() {
                try {
                    const r = await fetch('/api/sync', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid})});
                    const d = await r.json(); updateBal(d.balance);
                } catch(e){}
            }

            async function loadTop() {
                document.getElementById('topList').innerHTML = "Загрузка...";
                const r = await fetch('/api/leaderboard', {method:'POST'});
                const d = await r.json();
                let h = '';
                d.forEach((u,i) => {
                    let rank = i===0?'🥇':i===1?'🥈':i===2?'🥉':(i+1);
                    h += '<div class="top-row"><div class="top-rank">'+rank+'</div><div style="flex:1; text-align:left; color:#ccc;">ID '+u.uid+'</div><div style="color:var(--neon-cyan); font-weight:900;">'+formatBal(u.balance)+' 💎</div></div>';
                });
                document.getElementById('topList').innerHTML = h;
            }

            // --- ИГРА: СЛОТЫ ---
            function buildStrip(targetSymbol) {
                let html = '';
                for(let i=0; i<25; i++) {
                    html += '<div class="sym">'+syms[Math.floor(Math.random()*syms.length)]+'</div>';
                }
                html += '<div class="sym">'+targetSymbol+'</div>';
                return html;
            }

            function flashSlotsWin() {
                const reels = document.querySelector('.reel-cont');
                if (!reels) return;
                reels.classList.remove('slots-win');
                void reels.offsetWidth;
                reels.classList.add('slots-win');
                setTimeout(() => reels.classList.remove('slots-win'), 1800);
            }

            async function playSpin() {
                if(isSlotGame) return;
                const betEl = document.getElementById('bet1');
                const btn = document.getElementById('btnSpin');
                const bet = Math.floor(Number(betEl?.value));
                if(!Number.isFinite(bet) || bet < SLOT_MIN_BET) return gameAlert("Ошибка ставки");
                if(bet > bal) return gameAlert("Мало 💎 ХОТ ТАП!");
                const a = document.getElementById('bgm');
                if(a && a.paused && !a.muted) a.play().catch(e=>{});
                
                isSlotGame = true;
                if(btn) btn.disabled = true;
                
                try {
                    const r = await fetch('/api/spin', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, bet})});
                    const d = await r.json();
                    
                    if(d.err) { gameAlert(d.err); isSlotGame = false; if(btn) btn.disabled = false; return; }
                    if(!Array.isArray(d.result) || d.result.length < 3) throw new Error('Bad spin result');
                    updateBal(bal - bet);
                    
                    const s1 = document.getElementById('s1'); const s2 = document.getElementById('s2'); const s3 = document.getElementById('s3');
                    if(!s1 || !s2 || !s3) throw new Error('Slot reels not found');
                    document.querySelector('.reel-cont')?.classList.remove('slots-win');
                    
                    s1.style.transition = 'none'; s1.style.transform = 'translateY(0)';
                    s2.style.transition = 'none'; s2.style.transform = 'translateY(0)';
                    s3.style.transition = 'none'; s3.style.transform = 'translateY(0)';
                    
                    s1.innerHTML = buildStrip(d.result[0]);
                    s2.innerHTML = buildStrip(d.result[1]);
                    s3.innerHTML = buildStrip(d.result[2]);
                    
                    void s1.offsetWidth; void s2.offsetWidth; void s3.offsetWidth;
                    
                    const targetY = -(25 * 120); 
                    
                    setTimeout(() => { s1.style.transition = 'transform 2s cubic-bezier(0.15, 1, 0.3, 1)'; s1.style.transform = 'translateY(' + targetY + 'px)'; }, 50);
                    setTimeout(() => { s2.style.transition = 'transform 2s cubic-bezier(0.15, 1, 0.3, 1)'; s2.style.transform = 'translateY(' + targetY + 'px)'; }, 300);
                    setTimeout(() => { s3.style.transition = 'transform 2s cubic-bezier(0.15, 1, 0.3, 1)'; s3.style.transform = 'translateY(' + targetY + 'px)'; }, 600);
                    
                    setTimeout(() => {
                        try {
                            updateBal(d.balance);
                            if(d.winSum > 0) {
                                flashSlotsWin();
                                gameAlert("🎉 ВЫИГРЫШ: " + formatBal(d.winSum) + " 💎");
                                if(window.navigator.vibrate) window.navigator.vibrate([100,50,100,50,100]);
                            }
                        } catch(e) {
                            gameAlert("Ошибка слотов");
                        } finally {
                            isSlotGame = false;
                            if(btn) btn.disabled = false;
                        }
                    }, 2600);
                } catch(e) {
                    gameAlert("Ошибка слотов");
                    isSlotGame = false;
                    if(btn) btn.disabled = false;
                }
            }

            // --- ИГРА: КРАШ (ГЛОБАЛЬНАЯ) ---
            async function pollCrashState() {
                try {
                    const r = await fetch('/api/crash/state', {
                        method:'POST',
                        headers:{'Content-Type':'application/json'},
                        body:JSON.stringify({uid})
                    });
                    const d = await r.json();

                    const cx = document.getElementById('cX');
                    const cm = document.getElementById('cMsg');
                    const btn = document.getElementById('btnCrash');

                    renderCrashHistory(d.history || []);
                    const playersEl = document.getElementById('crashPlayers');
                    if (playersEl) playersEl.innerText = d.playersCount || 0;
                    const myBetEl = document.getElementById('crashMyBet');
                    if (myBetEl) myBetEl.innerText = formatBal(d.bet || 0);

                    crashStatus = d.status;

                    if (d.status === 'betting') {
                        lastCrashRoundResultShown = false;
                        lastCashoutVisualRound = null;
                        setRocketState('idle');
                        stopCrashAnimation();
                        setCrashMultiplier(1.00);
                        cx.style.color = "#fff";
                        cx.style.textShadow = "0 0 18px rgba(255,255,255,0.65)";
                        cm.innerText = "ДО СТАРТА: " + d.timeLeft + " СЕК";
                        cm.style.color = "#aaa";

                        if (d.bet > 0) {
                            setCrashResult("✅ Ставка принята: " + formatBal(d.bet) + " 💎", "wait");
                            btn.disabled = true;
                            btn.innerText = "СТАВКА ПРИНЯТА";
                            btn.style.background = "#555";
                            btn.style.boxShadow = "none";
                        } else {
                            setCrashResult("Сделай ставку до старта раунда", "info");
                            btn.disabled = false;
                            btn.innerText = "ПОСТАВИТЬ";
                            btn.onclick = placeCrashBet;
                            btn.style.background = "";
                            btn.style.boxShadow = "";
                        }
                    } else if (d.status === 'flying') {
                        setRocketState('fly', d.currentMultiplier);
                        cx.style.color = "#00ff66";
                        cx.style.textShadow = "0 0 18px rgba(0,255,102,0.55)";
                        cm.innerText = "РАКЕТА ЛЕТИТ...";
                        cm.style.color = "#00f0ff";

                        if (d.startTime && d.serverTime) {
                            startCrashAnimation(Number(d.startTime), Number(d.serverTime));
                        }

                        if (d.bet > 0 && !d.cashedOut) {
                            const potential = Math.floor(Number(d.bet) * Number(d.currentMultiplier || 1));
                            setCrashResult("Потенциал: +" + formatBal(potential) + " 💎", "wait");
                            btn.disabled = false;
                            btn.innerText = "💰 ЗАБРАТЬ КУШ";
                            btn.onclick = cashoutCrashGlobal;
                            btn.style.background = "linear-gradient(90deg, #00ff00, #009900)";
                            btn.style.boxShadow = "0 0 20px rgba(0,255,0,0.5)";
                        } else if (d.bet > 0 && d.cashedOut) {
                            if (lastCashoutVisualRound !== d.roundId) {
                                setRocketState('cashout');
                                lastCashoutVisualRound = d.roundId;
                            }
                            setCrashResult("✅ Забрал +" + formatBal(d.winSum) + " 💎", "win");
                            btn.disabled = true;
                            btn.innerText = "✅ ЗАБРАЛ +" + formatBal(d.winSum) + " 💎";
                            btn.style.background = "#555";
                            btn.style.boxShadow = "none";
                        } else {
                            setCrashResult("Раунд идёт, жди следующий", "info");
                            btn.disabled = true;
                            btn.innerText = "ОЖИДАНИЕ...";
                            btn.style.background = "#555";
                            btn.style.boxShadow = "none";
                        }
                    } else if (d.status === 'crashed') {
                        if (d.bet > 0 && d.cashedOut) {
                            setRocketState('cashout');
                        } else {
                            setRocketState('boom');
                        }
                        stopCrashAnimation();
                        setCrashMultiplier(Number(d.crashedMultiplier || 1));
                        cx.style.color = "#ff3030";
                        cx.style.textShadow = "0 0 18px rgba(255,48,48,0.65)";
                        cm.innerText = "💥 РАКЕТА ВЗОРВАЛАСЬ!";
                        cm.style.color = "#ff3030";

                        if (!lastCrashRoundResultShown) {
                            if (d.bet > 0 && d.cashedOut) {
                                setCrashResult("✅ Ты забрал +" + formatBal(d.winSum) + " 💎", "win");
                            } else if (d.bet > 0) {
                                setCrashResult("💥 Проигрыш -" + formatBal(d.bet) + " 💎", "lose");
                            } else {
                                setCrashResult("💥 Взорвалась на " + Number(d.crashedMultiplier || 1).toFixed(2) + "x", "lose");
                            }
                            lastCrashRoundResultShown = true;
                        }

                        btn.disabled = true;
                        btn.innerText = (d.bet > 0 && d.cashedOut) ? "✅ ЗАБРАЛ" : "ВЗРЫВ";
                        btn.style.background = "#ff0000";
                        btn.style.boxShadow = "0 0 20px rgba(255,0,0,0.5)";

                        if (lastCrashStatus !== 'crashed' && window.navigator.vibrate) {
                            window.navigator.vibrate([500]);
                        }
                    }

                    lastCrashStatus = d.status;
                } catch(e) {}
            }

            async function placeCrashBet() {
                const bet = parseFloat(document.getElementById('bet2').value);
                if(bet > bal) return gameAlert("Мало 💎 ХОТ ТАП!");
                
                const btn = document.getElementById('btnCrash');
                btn.disabled = true;
                
                const a = document.getElementById('bgm'); if(a.paused && !a.muted) a.play().catch(e=>{});
                
                try {
                    const r = await fetch('/api/crash/bet', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, bet})});
                    const d = await r.json();
                    if(d.err) { gameAlert(d.err); btn.disabled = false; }
                    else { updateBal(d.balance); pollCrashState(); }
                } catch(e) { btn.disabled = false; }
            }

            async function cashoutCrashGlobal() {
                const btn = document.getElementById('btnCrash');
                btn.disabled = true;
                
                try {
                    const r = await fetch('/api/crash/cashout', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid})});
                    const d = await r.json();
                    if(d.err) {
                        gameAlert(d.err);
                        btn.disabled = false;
                    } else if (d.success) {
                        setRocketState('cashout');
                        gameAlert("✅ +" + formatBal(d.winSum) + " 💎");
                        if(window.navigator.vibrate) window.navigator.vibrate([100,50,100]);
                        updateBal(d.balance);
                        pollCrashState(); // Немедленно обновить UI
                    }
                } catch(e) {
                    btn.disabled = false;
                    gameAlert("Ошибка забора куша");
                }
            }

            async function withdraw() {
                const a = await vipPrompt({
                    title: 'Вывод средств',
                    text: 'Укажи TON-кошелёк. Заявка уйдёт админу на проверку.',
                    label: 'Кошелёк для вывода',
                    placeholder: 'UQ...',
                    icon: '💸',
                    okText: 'Дальше'
                });
                if(!a) return;
                const sum = await vipPrompt({
                    title: 'Сумма вывода',
                    text: 'Минимальный вывод: 10 💎.',
                    label: 'Сумма в 💎',
                    placeholder: '10',
                    type: 'number',
                    icon: '💎',
                    okText: 'Отправить'
                });
                if(!sum) return;
                try {
                    const r = await fetch('/api/withdraw', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, address:a, amount:parseFloat(sum)})});
                    const d = await r.json();
                    gameAlert(d.msg||d.err);
                    upd();
                } catch(e) {
                    gameAlert('Ошибка при создании заявки');
                }
            }
            
            function renderHistory(history, containerId) {
                const list = document.getElementById(containerId);
                if (!list) return;
                if (!history || history.length === 0) {
                    list.innerHTML = '<div class="history-row"><div><div class="history-main">Пока действий нет</div><div class="history-time">Сыграй или пополни баланс</div></div></div>';
                    return;
                }
                list.innerHTML = history.map(h => {
                    let time = '';
                    try {
                        if (h.createdAt) time = new Date(h.createdAt).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
                    } catch(e) {}
                    return '<div class="history-row"><div><div class="history-main">' + (h.text || 'Действие') + '</div><div class="history-time">' + time + '</div></div></div>';
                }).join('');
            }

            async function loadProfile() {
                try {
                    const r = await fetch('/api/profile', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid})});
                    const d = await r.json();
                    if(d.err) return gameAlert(d.err);
                    const profUid = document.getElementById('profUid');
                    if(profUid) profUid.innerText = d.uid;
                    document.getElementById('profSpins').innerText = formatBal(d.spins || 0);
                    document.getElementById('profWins').innerText = formatBal(d.wins || 0);
                    document.getElementById('profPromos').innerText = formatBal(d.promos || 0);
                    
                    renderHistory(d.history || [], 'historyListPage8');
                    updateBal(d.balance || 0);
                } catch(e) {}
            }

            function activatePromoFromProfile() {
                const inp = document.getElementById('promoInput');
                const code = (inp?.value || '').trim().toUpperCase();
                if(!code) return gameAlert("Введите промокод");
                fetch('/api/promo', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid, promo:code})})
                .then(r=>r.json()).then(d=>{
                    gameAlert(d.msg||d.err);
                    if(d.msg && inp) inp.value = "";
                    upd();
                    loadProfile();
                });
            }

            let rouletteRotation = 0;
            const roulettePrizeIndex = { "💎 +10": 0, "💎 +25": 1, "💎 +50": 2, "💎 +100": 3, "😭 Пусто": 4 };
            async function spinBonusRoulette() {
                const btn = document.getElementById('btnRoulette');
                const wheel = document.getElementById('rouletteWheel');
                const resultBox = document.getElementById('rouletteResult');
                if (!btn || !wheel || !resultBox) return gameAlert('Ошибка рулетки');
                btn.disabled = true;
                resultBox.classList.remove('win');
                resultBox.innerText = 'Рулетка запускается...';
                try {
                    const r = await fetch('/api/roulette', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({uid})});
                    const d = await r.json();
                    if (d.err) {
                        resultBox.innerText = d.err;
                        gameAlert(d.err);
                        return;
                    }
                    const idx = roulettePrizeIndex[d.prize] ?? 4;
                    const segment = 72;
                    const center = idx * segment + segment / 2;
                    rouletteRotation = Math.ceil(rouletteRotation / 360) * 360 + 360 * 5 + (360 - center) + Math.floor(Math.random() * 18 - 9);
                    wheel.style.transform = 'rotate(' + rouletteRotation + 'deg)';
                    setTimeout(() => {
                        resultBox.innerText = d.msg || ('Выпало: ' + d.prize);
                        resultBox.classList.add('win');
                        if (d.balance !== undefined) updateBal(d.balance);
                        gameAlert(d.msg || ('Выпало: ' + d.prize));
                        if(window.navigator.vibrate) window.navigator.vibrate([80,50,120]);
                        loadProfile();
                    }, 3900);
                } catch(e) {
                    resultBox.innerText = 'Ошибка рулетки';
                    gameAlert('Ошибка рулетки');
                } finally {
                    setTimeout(() => { btn.disabled = false; }, 4000);
                }
            }

            async function loadTasks() {
                try {
                    const r = await fetch('/api/tasks/list', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({uid}) });
                    const d = await r.json();
                    const container = document.getElementById('tasksList');
                    if (!container) return;
                    if (!d.tasks || d.tasks.length === 0) { container.innerHTML = '<div class="small-info">Пока нет заданий</div>'; return; }
                    let html = '';
                    for (const t of d.tasks) {
                        const done = t.completed;
                        const btnText = done ? '✅ ВЫПОЛНЕНО' : '✅ ВЫПОЛНИТЬ';
                        const btnStyle = done ? 'background:#555;box-shadow:none;' : '';
                        const onclick = done ? '' : `onclick="completeTask('${t.code}')"`;
                        html += `<div class="bonus-choice" style="border-color: rgba(0,255,140,0.55); text-align: left; padding: 14px 16px; cursor: default; margin-bottom: 10px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;"><span style="font-size: 16px;">${t.title}</span><span style="color: var(--gold); font-size: 18px;">+${t.reward} 💎</span></div>
                            <div style="font-size: 12px; color: #888; margin-top: 6px; text-transform: none; font-weight: 400;">${t.description}</div>
                            <button class="btn-main" style="margin-top: 12px; font-size: 14px; ${btnStyle}" ${onclick} id="btnTask_${t.code}">${btnText}</button>
                        </div>`;
                    }
                    container.innerHTML = html;
                } catch(e) { console.error(e); }
            }
            async function completeTask(code) {
                const btn = document.getElementById('btnTask_' + code);
                if (!btn) return; btn.disabled = true; btn.innerText = "Проверка...";
                try {
                    const r = await fetch('/api/tasks/complete', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({uid, task_code: code}) });
                    const d = await r.json(); gameAlert(d.msg || d.err);
                    if (d.success) { btn.innerText = "✅ ВЫПОЛНЕНО"; btn.style.background = "#555"; btn.style.boxShadow = "none"; upd(); loadTasks(); }
                    else { btn.disabled = false; btn.innerText = "✅ ВЫПОЛНИТЬ"; }
                } catch(e) { gameAlert("Ошибка"); btn.disabled = false; btn.innerText = "✅ ВЫПОЛНИТЬ"; }
            }
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => { if (document.getElementById('pg11') && document.getElementById('pg11').classList.contains('active')) loadTasks(); });
            });
            observer.observe(document.body, { attributes: true, childList: true, subtree: true });
            setInterval(upd, 5000); upd();
            document.getElementById('bgm').muted = false;
        </script>
    </body>
    </html>`);
});


const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('Сервер запущен на порту ' + PORT));
