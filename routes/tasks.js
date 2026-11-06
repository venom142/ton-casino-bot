const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Task = require('../models/Task');
const { safeUid } = require('../utils/helpers');
const { CONFIG } = require('../config');

// Ссылочные задания проверить нельзя, поэтому требуем «открыл ссылку -> подождал -> забрал».
// Момент открытия хранится в памяти сервера (после перезапуска ссылку нужно открыть заново).
const LINK_MIN_WAIT_MS = 7000;
const LINK_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const linkStarted = new Map(); // `${uid}:${code}` -> timestamp

function cleanupStarted() {
    if (linkStarted.size < 5000) return;
    const now = Date.now();
    for (const [k, ts] of linkStarted) if (now - ts > LINK_MAX_AGE_MS) linkStarted.delete(k);
}

const isUrl = (v) => /^https?:\/\/\S+$/i.test(String(v || ''));

// Задание типа "custom" со ссылкой в цели работает как ссылочное, без ссылки — как бесплатный бонус
const effectiveType = (t) => (t.type === 'custom' && isUrl(t.target_value)) ? 'link' : t.type;

// Telegram ждёт канал как "@name" (или числовой id)
function chatRef(target) {
    const t = String(target || CONFIG.CHANNEL_ID || '').trim().replace(/^https?:\/\/t\.me\//i, '');
    if (/^-?\d+$/.test(t)) return t;
    return t.startsWith('@') ? t : '@' + t;
}

function openUrl(t) {
    const type = effectiveType(t);
    if (type === 'channel_sub') return 'https://t.me/' + chatRef(t.target_value).replace(/^@/, '');
    if (type === 'link') return t.target_value;
    return '';
}

module.exports = (bot) => {
    // Список заданий (старые сверху, новые снизу — ничего не пропадает)
    router.post('/tasks/list', async (req, res) => {
        try {
            const uidStr = safeUid(req.body?.uid);
            if (!uidStr) return res.json({ tasks: [], err: "Не удалось определить Telegram ID. Откройте приложение через бота." });

            const user = await User.findOne({ uid: uidStr }).lean();
            const completed = new Set((user && user.tasks_completed) || []);
            const spins = (user && user.spins) || 0;

            const tasks = await Task.find({ is_active: true }).sort({ created_at: 1 }).lean();
            res.json({
                tasks: tasks.map(t => {
                    const type = effectiveType(t);
                    const item = {
                        code: t.code,
                        title: t.title || '',
                        description: t.description || '',
                        reward: t.reward,
                        type,
                        url: openUrl(t),
                        completed: completed.has(t.code)
                    };
                    if (type === 'play_games') { item.required = parseInt(t.target_value, 10) || 10; item.progress = spins; }
                    return item;
                })
            });
        } catch (e) {
            console.error('[tasks/list]', e.message);
            res.json({ tasks: [], err: "Не удалось загрузить задания. Попробуйте позже." });
        }
    });

    // Игрок открыл ссылку/канал — запоминаем момент (для ссылочных заданий)
    router.post('/tasks/start', async (req, res) => {
        try {
            const uidStr = safeUid(req.body?.uid);
            const code = String(req.body?.task_code || '');
            if (!uidStr || !code) return res.json({ err: "Ошибка данных" });
            const task = await Task.findOne({ code, is_active: true }).lean();
            if (!task) return res.json({ err: "Задание не найдено" });
            const key = `${uidStr}:${code}`;
            if (!linkStarted.has(key)) { cleanupStarted(); linkStarted.set(key, Date.now()); }
            // сколько ещё ждать (если ссылку уже открывали раньше — только остаток)
            const left = Math.max(0, LINK_MIN_WAIT_MS - (Date.now() - linkStarted.get(key)));
            res.json({ ok: true, wait_ms: effectiveType(task) === 'link' ? left : 0 });
        } catch (e) { console.error('[tasks/start]', e.message); res.json({ err: "Ошибка задания" }); }
    });

    // Проверить выполнение и выдать награду
    router.post('/tasks/complete', async (req, res) => {
        try {
            const uidStr = safeUid(req.body?.uid);
            const code = String(req.body?.task_code || '');
            if (!uidStr || !code) return res.json({ err: "Ошибка данных" });

            const user = await User.findOne({ uid: uidStr }).lean();
            if (!user) return res.json({ err: "Профиль не найден. Отправьте боту /start." });
            if ((user.tasks_completed || []).includes(code)) return res.json({ err: "✅ Вы уже выполнили это задание!" });

            const task = await Task.findOne({ code, is_active: true }).lean();
            if (!task) return res.json({ err: "❌ Задание не найдено" });
            const type = effectiveType(task);

            if (type === 'channel_sub') {
                try {
                    const m = await bot.getChatMember(chatRef(task.target_value), Number(uidStr));
                    const subscribed = ['creator', 'administrator', 'member'].includes(m.status) ||
                        (m.status === 'restricted' && m.is_member === true);
                    if (!subscribed) return res.json({ err: "❌ Вы ещё не подписаны на канал. Подпишитесь и нажмите «Проверить»." });
                } catch (e) {
                    console.error('[tasks/channel]', e.message);
                    // Чаще всего: бот не админ канала или указан неверный @канал
                    return res.json({ err: "❌ Не удалось проверить подписку. Сообщите администратору: бот должен быть админом канала." });
                }
            } else if (type === 'play_games') {
                const required = parseInt(task.target_value, 10) || 10;
                if ((user.spins || 0) < required) {
                    return res.json({ err: `❌ Нужно сыграть ${required} раз. Сыграно: ${user.spins || 0}` });
                }
            } else if (type === 'referral') {
                return res.json({ err: "⏳ Реферальная система в разработке" });
            } else if (type === 'link') {
                const ts = linkStarted.get(`${uidStr}:${code}`);
                const age = ts ? Date.now() - ts : null;
                if (age === null || age > LINK_MAX_AGE_MS) return res.json({ err: "Сначала откройте ссылку задания." });
                if (age < LINK_MIN_WAIT_MS) return res.json({ err: "Подождите несколько секунд и нажмите ещё раз." });
            }

            const reward = Math.floor(Number(task.reward) || 0);
            if (reward <= 0) return res.json({ err: "❌ У задания не задана награда" });

            // АТОМАРНО: награда выдаётся только если задание ещё не отмечено (защита от двойного нажатия)
            const updated = await User.findOneAndUpdate(
                { uid: uidStr, tasks_completed: { $ne: code } },
                {
                    $inc: { balance: reward },
                    $push: {
                        tasks_completed: code,
                        history: { $each: [{ text: `📢 Задание: ${task.title} +${reward} 💎`, amount: reward, createdAt: new Date() }], $position: 0, $slice: 20 }
                    }
                },
                { new: true }
            );
            if (!updated) return res.json({ err: "✅ Вы уже выполнили это задание!" });
            linkStarted.delete(`${uidStr}:${code}`);

            res.json({ success: true, msg: `✅ Задание выполнено! +${reward} 💎`, balance: Math.floor(updated.balance) });
        } catch (e) {
            console.error('[tasks/complete]', e);
            res.json({ err: "Не удалось выполнить задание. Попробуйте позже." });
        }
    });

    return router;
};
