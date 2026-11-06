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
const { approveWithdraw, rejectWithdraw } = require('./utils/wallet');
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
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("💎 MongoDB подключена!"))
    .catch(err => console.error("❌ Ошибка БД:", err.message));

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const adminState = {};
const taskDraft = {}; // admin uid -> { step, title, desc, reward, type }

// Типы заданий: что просим у админа и как называем
const TASK_TYPES = {
    channel_sub: { label: '📢 Подписка на канал', short: 'канал', ask: '📢 Пришли <b>@канал</b> (например <code>@my_channel</code>).\n⚠️ Бот должен быть <b>админом</b> этого канала, иначе подписку не проверить.' },
    link:        { label: '🔗 Открыть ссылку', short: 'ссылка', ask: '🔗 Пришли <b>ссылку</b> (начинается с https://). Игрок откроет её и сможет забрать награду.' },
    play_games:  { label: '🎰 Сыграть N раз', short: 'игры', ask: '🎰 Сколько игр (спинов) нужно сыграть? Пришли число, например <code>10</code>.' },
    custom:      { label: '🎁 Бесплатное (без проверки)', short: 'бонус', ask: '' }
};
const TASK_LEGACY_LABEL = { referral: '👥 реферал (скоро)' };

async function makeTaskCode() {
    for (let i = 0; i < 6; i++) {
        const code = 'T' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 4).toUpperCase();
        if (!(await Task.exists({ code }))) return code;
    }
    throw new Error('не удалось подобрать код задания');
}

async function showTaskList(chatId, msgId, note) {
    const tasks = await Task.find().sort({ created_at: 1 }).limit(30);
    let text = "📋 <b>ЗАДАНИЯ</b>" + (note ? `\n<i>${escHtml(note)}</i>` : '') + "\n";
    const rows = [];
    if (!tasks.length) text += "\nПока нет заданий.";
    tasks.forEach((t, i) => {
        const kind = (TASK_TYPES[t.type] && TASK_TYPES[t.type].short) || TASK_LEGACY_LABEL[t.type] || t.type;
        text += `\n${i + 1}. ${t.is_active ? '✅' : '⏸'} <b>${escHtml(t.title)}</b> — 💎 ${t.reward} · ${escHtml(kind)}`;
        rows.push([
            { text: `🗑 ${i + 1}`, callback_data: 'tdel_' + t._id },
            { text: `${t.is_active ? '⏸ Выкл' : '▶️ Вкл'} ${i + 1}`, callback_data: 'ttog_' + t._id }
        ]);
    });
    rows.push([{ text: "➕ Создать задание", callback_data: "adm_task_add" }]);
    rows.push([{ text: "🔙 Назад", callback_data: "admin_menu" }]);
    const opts = { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows }, disable_web_page_preview: true };
    if (msgId) {
        try { await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, ...opts }); return; } catch (e) {
            if (/not modified/i.test(e.message || '')) return;
        }
    }
    await bot.sendMessage(chatId, text, opts);
}

async function createTaskFromDraft(chatId, uid, target) {
    const d = taskDraft[uid];
    if (!d) return;
    const code = await makeTaskCode();
    // create (а не upsert по коду): новое задание НИКОГДА не затирает существующие
    await Task.create({ code, title: d.title, description: d.desc || '', reward: d.reward, type: d.type, target_value: target, is_active: true });
    await AdminLog.create({ action: 'task_create', details: `Задание ${code} создано` });
    delete taskDraft[uid];
    await showTaskList(chatId, null, `✅ Задание «${d.title}» создано (+${d.reward} 💎).`);
}

async function handleTaskDraft(msg) {
    const uid = msg.from.id, chatId = msg.chat.id;
    const text = (msg.text || '').trim();
    const d = taskDraft[uid];
    if (text === '/cancel') { delete taskDraft[uid]; await showTaskList(chatId, null, 'Создание отменено.'); return; }
    if (!text || text.startsWith('/')) return;

    if (d.step === 'title') {
        d.title = text.slice(0, 100); d.step = 'desc';
        await bot.sendMessage(chatId, "Шаг 2/4. Пришли <b>описание</b> (до 300 символов) или <code>-</code>, если без описания.", { parse_mode: 'HTML' });
    } else if (d.step === 'desc') {
        d.desc = text === '-' ? '' : text.slice(0, 300); d.step = 'reward';
        await bot.sendMessage(chatId, "Шаг 3/4. Пришли <b>награду</b> в 💎 (целое число).", { parse_mode: 'HTML' });
    } else if (d.step === 'reward') {
        const v = parseInt(text, 10);
        if (!Number.isFinite(v) || v <= 0 || v > 1e9) { await bot.sendMessage(chatId, "❌ Нужно целое число от 1 до 1 000 000 000."); return; }
        d.reward = v; d.step = 'type';
        await bot.sendMessage(chatId, "Шаг 4/4. Выбери <b>тип</b> задания:", { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
            ...Object.entries(TASK_TYPES).map(([k, t]) => [{ text: t.label, callback_data: 'ttype_' + k }]),
            [{ text: "❌ Отмена", callback_data: "tcancel" }]
        ]}});
    } else if (d.step === 'target') {
        let target = text;
        if (d.type === 'channel_sub') {
            target = text.replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '');
            if (!/^[A-Za-z0-9_]{4,32}$/.test(target)) { await bot.sendMessage(chatId, "❌ Нужен @канал, например @my_channel"); return; }
            target = '@' + target;
        } else if (d.type === 'link') {
            if (!/^https?:\/\/\S+$/i.test(text) || text.length > 300) { await bot.sendMessage(chatId, "❌ Нужна ссылка, начинающаяся с https://"); return; }
        } else if (d.type === 'play_games') {
            const n = parseInt(text, 10);
            if (!Number.isFinite(n) || n < 1 || n > 1e6) { await bot.sendMessage(chatId, "❌ Нужно число от 1 до 1 000 000."); return; }
            target = String(n);
        }
        await createTaskFromDraft(chatId, uid, target);
    }
}

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

// ===== Карточка игрока в /start: ник, баланс, VIP — обновляется кнопкой и сама =====
const escHtml = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function playerNick(u, from) {
    const un = (u && u.username) || (from && from.username) || '';
    if (un) return '@' + String(un).replace(/^@/, '');
    return (u && u.first_name) || (from && from.first_name) || 'Игрок';
}

function buildStartCard(u, from, isNew) {
    const vip = u && u.is_vip;
    const lines = [
        '💎 <b>VIP ХОТ ТАП</b>',
        '',
        `${vip ? '👑 <b>VIP</b>' : '👤 Игрок'}: <b>${escHtml(playerNick(u, from))}</b>`,
        `💰 Баланс: <b>${formatNumber(Math.floor(u ? u.balance || 0 : 0))} 💎</b>`,
        `🆔 ID: <code>${escHtml(u ? u.uid : (from && from.id))}</code>`
    ];
    if (isNew) lines.push('', `🎁 Стартовый бонус: <b>${CONFIG.START_BALANCE} 💎</b>`);
    return lines.join('\n');
}

function startKeyboard(isAdmin) {
    const kb = [
        [{ text: "🎰 ВОЙТИ В VIP ЗАЛ", web_app: { url: CONFIG.APP_URL } }],
        [{ text: "🔄 Обновить баланс", callback_data: "start_refresh" }]
    ];
    if (isAdmin) kb.push([{ text: "👑 ПАНЕЛЬ ВЛАДЕЛЬЦА", callback_data: "admin_menu" }]);
    return { inline_keyboard: kb };
}

// Карточки, которые держим «живыми»: когда баланс/ник/VIP меняются — сообщение правится само
const liveCards = new Map(); // uid -> { chatId, msgId, sig, at }
const LIVE_TTL_MS = 30 * 60 * 1000, LIVE_MAX = 500, LIVE_TICK_MS = 15000;
const cardSig = (u) => `${Math.floor(u.balance || 0)}|${u.is_vip ? 1 : 0}|${u.username || ''}|${u.first_name || ''}`;

function trackCard(uid, chatId, msgId, u) {
    if (liveCards.size >= LIVE_MAX && !liveCards.has(uid)) liveCards.delete(liveCards.keys().next().value);
    liveCards.set(uid, { chatId, msgId, sig: cardSig(u), at: Date.now() });
}

async function editCard(chatId, msgId, u, from) {
    try {
        await bot.editMessageText(buildStartCard(u, from, false), {
            chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
            reply_markup: startKeyboard(from && from.id === CONFIG.ADMIN_ID)
        });
        return true;
    } catch (e) {
        if (/not modified/i.test(e.message || '')) return true;
        return false; // сообщение удалено/устарело — перестаём его обновлять
    }
}

setInterval(async () => {
    if (!liveCards.size || mongoose.connection.readyState !== 1) return;
    try {
        const now = Date.now();
        for (const [uid, c] of liveCards) if (now - c.at > LIVE_TTL_MS) liveCards.delete(uid);
        const users = await User.find({ uid: { $in: [...liveCards.keys()] } }).select('uid balance is_vip username first_name').lean();
        for (const u of users) {
            const c = liveCards.get(u.uid);
            if (!c || cardSig(u) === c.sig) continue;
            const ok = await editCard(c.chatId, c.msgId, u, { id: Number(u.uid) });
            if (ok) c.sig = cardSig(u); else liveCards.delete(u.uid);
            await new Promise(r => setTimeout(r, 60));
        }
    } catch (e) { console.error('[liveCards]', e.message); }
}, LIVE_TICK_MS);

bot.onText(/\/start/, async (msg) => {
    const uid = msg.from.id.toString();
    const username = msg.from.username || '';
    const firstName = msg.from.first_name || '';
    try {
        const existed = await User.exists({ uid });
        const u = await User.findOneAndUpdate(
            { uid },
            { uid, username, first_name: firstName },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        const sent = await bot.sendMessage(msg.chat.id, buildStartCard(u, msg.from, !existed), {
            parse_mode: 'HTML', reply_markup: startKeyboard(msg.from.id === CONFIG.ADMIN_ID)
        });
        trackCard(uid, msg.chat.id, sent.message_id, u);
    } catch (e) {
        console.error('[start]', e.message);
        bot.sendMessage(msg.chat.id, '⚠️ Не удалось загрузить профиль. Попробуй ещё раз через минуту: /start').catch(() => {});
    }
});

bot.on('callback_query', async (q) => {
    bot.answerCallbackQuery(q.id).catch(() => {}); // убираем «часики» на кнопке
    if (!q.message) return;
    const uid = q.from.id;
    const chatId = q.message.chat.id;
    const msgId = q.message.message_id;

    if (q.data === 'start_refresh') {
        try {
            const u = await User.findOne({ uid: String(uid) }).lean();
            if (u) { await editCard(chatId, msgId, u, q.from); trackCard(String(uid), chatId, msgId, u); }
        } catch (e) { console.error('[refresh]', e.message); }
        return;
    }

    if (q.data.startsWith('withdraw_ok_') || q.data.startsWith('withdraw_no_')) {
        if (uid !== CONFIG.ADMIN_ID) return; // только владелец
        const approve = q.data.startsWith('withdraw_ok_');
        const txId = q.data.split('_')[4];
        bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
        try {
            const r = approve ? await approveWithdraw(txId) : await rejectWithdraw(txId);
            if (r.err) return bot.sendMessage(chatId, "❌ " + r.err);
            // данные берём из базы, а не из callback_data
            await AdminLog.create({ action: approve ? 'withdraw_approve' : 'withdraw_reject', target_uid: r.tx.uid, amount: r.tx.amount, details: 'Через бот' });
            bot.sendMessage(r.tx.uid, approve ? `✅ Заявка на вывод ${r.tx.amount} 💎 одобрена!` : `❌ Заявка на вывод ${r.tx.amount} 💎 отклонена.`).catch(()=>{});
            bot.sendMessage(chatId, approve ? `✅ Вывод одобрён.\nИгрок: ${r.tx.uid}\nСумма: ${r.tx.amount} 💎` : "❌ Заявка отклонена, сумма возвращена игроку.");
        } catch (e) { console.error('[withdraw cb]', e.message); bot.sendMessage(chatId, "❌ Ошибка обработки заявки."); }
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

    // ===== ЗАДАНИЯ (админ) =====
    if (!/^(adm_task|ttype_|tdel|ttog|tcancel)/.test(q.data)) delete taskDraft[uid];

    if (q.data === "adm_tasks" || q.data === "tcancel") {
        delete taskDraft[uid];
        await showTaskList(chatId, msgId);
        return;
    }
    if (q.data === "adm_task_add") {
        delete adminState[uid];
        taskDraft[uid] = { step: 'title' };
        bot.sendMessage(chatId, "➕ <b>Новое задание</b>\n\nШаг 1/4. Пришли <b>название</b> задания (до 100 символов).\n\nОтмена: /cancel", { parse_mode: 'HTML' });
        return;
    }
    if (q.data.startsWith("ttype_")) {
        const d = taskDraft[uid];
        const type = q.data.slice(6);
        if (!d || d.step !== 'type' || !TASK_TYPES[type]) return;
        d.type = type;
        if (type === 'custom') { await createTaskFromDraft(chatId, uid, ''); return; }
        d.step = 'target';
        bot.sendMessage(chatId, TASK_TYPES[type].ask, { parse_mode: 'HTML', disable_web_page_preview: true });
        return;
    }
    if (q.data.startsWith("tdel_")) {
        const t = await Task.findById(q.data.slice(5)).catch(() => null);
        if (!t) { await showTaskList(chatId, msgId); return; }
        bot.sendMessage(chatId, `🗑 Удалить задание <b>${escHtml(t.title)}</b>?\nУ игроков останется отметка «выполнено», награды не отменяются.`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: "✅ Да, удалить", callback_data: "tdelok_" + t._id }, { text: "❌ Нет", callback_data: "adm_tasks" }]] }
        });
        return;
    }
    if (q.data.startsWith("tdelok_")) {
        const t = await Task.findByIdAndDelete(q.data.slice(7)).catch(() => null);
        if (t) await AdminLog.create({ action: 'task_delete', details: `Задание ${t.code} удалено` });
        await showTaskList(chatId, null, t ? `🗑 Задание «${t.title}» удалено.` : 'Задание уже удалено.');
        return;
    }
    if (q.data.startsWith("ttog_")) {
        const t = await Task.findById(q.data.slice(5)).catch(() => null);
        if (t) { t.is_active = !t.is_active; await t.save(); }
        await showTaskList(chatId, msgId);
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
    if (!msg.from) return;
    if (taskDraft[msg.from.id] && msg.from.id === CONFIG.ADMIN_ID) {
        try { await handleTaskDraft(msg); } catch (e) { console.error('[task draft]', e.message); bot.sendMessage(msg.chat.id, '⚠️ Ошибка. Попробуй ещё раз или /cancel').catch(() => {}); }
        return;
    }
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
app.use('/api', auth);
const { createLimiter } = require('./middleware/rateLimit');
const adminOnly = require('./middleware/adminOnly');
app.use('/api', createLimiter({ windowMs: 10000, max: 60 }));
// Строгий лимит на денежные операции
const moneyLimiter = createLimiter({ windowMs: 5000, max: 8 });
['/spin', '/roulette', '/promo', '/withdraw', '/crash/bet', '/crash/cashout', '/tasks/complete'].forEach(p => app.use('/api' + p, moneyLimiter));
app.use('/api/admin', adminOnly);

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




const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('Сервер запущен на порту ' + PORT));
