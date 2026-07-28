const express = require('express');
const router = express.Router();
const User = require('../../models/User');
const state = require('../../state');

module.exports = (bot) => {
    // Текстовая рассылка
    router.post('/admin/broadcast/text', async (req, res) => {
        try {
            const { text, filter } = req.body;
            if (!text) return res.json({ err: "Введите текст" });

            let query = {};
            if (filter === 'vip') query.is_vip = true;
            if (filter === 'new') query.created_at = { $gte: new Date(Date.now() - 86400000 * 7) };
            if (filter === 'active') query.last_active = { $gte: new Date(Date.now() - 86400000 * 3) };

            const users = await User.find(query);
            let sent = 0, failed = 0;
            for (const u of users) {
                try { await bot.sendMessage(u.uid, text); sent++; }
                catch(e) { failed++; }
            }
            res.json({ success: true, sent, failed, total: users.length });
        } catch(e) { res.json({ err: "Ошибка рассылки" }); }
    });

    // Рассылка с фото
    router.post('/admin/broadcast/photo', async (req, res) => {
        try {
            const { photo_url, caption, filter } = req.body;
            let query = {};
            if (filter === 'vip') query.is_vip = true;
            const users = await User.find(query);
            let sent = 0;
            for (const u of users) {
                try { await bot.sendPhoto(u.uid, photo_url, { caption }); sent++; }
                catch(e) {}
            }
            res.json({ success: true, sent });
        } catch(e) { res.json({ err: "Ошибка" }); }
    });

    // Рассылка с кнопками
    router.post('/admin/broadcast/buttons', async (req, res) => {
        try {
            const { text, button_text, button_url, filter } = req.body;
            let query = {};
            if (filter === 'vip') query.is_vip = true;
            const users = await User.find(query);
            let sent = 0;
            for (const u of users) {
                try {
                    await bot.sendMessage(u.uid, text, {
                        reply_markup: { inline_keyboard: [[{ text: button_text, url: button_url }]] }
                    });
                    sent++;
                } catch(e) {}
            }
            res.json({ success: true, sent });
        } catch(e) { res.json({ err: "Ошибка" }); }
    });

    // Отложенная рассылка
    router.post('/admin/broadcast/schedule', async (req, res) => {
        try {
            const { text, delay_minutes, filter } = req.body;
            const delay = Math.floor(Number(delay_minutes));
            if (!text || !delay || delay < 1) return res.json({ err: "Некорректные данные" });

            const id = Date.now().toString();
            state.BROADCAST_QUEUE.push({ id, text, filter, fireAt: Date.now() + delay * 60000 });

            setTimeout(async () => {
                const idx = state.BROADCAST_QUEUE.findIndex(x => x.id === id);
                if (idx >= 0) state.BROADCAST_QUEUE.splice(idx, 1);

                let query = {};
                if (filter === 'vip') query.is_vip = true;
                const users = await User.find(query);
                for (const u of users) {
                    try { await bot.sendMessage(u.uid, text); } catch(e) {}
                }
            }, delay * 60000);

            res.json({ success: true, msg: `Рассылка запланирована через ${delay} мин.` });
        } catch(e) { res.json({ err: "Ошибка" }); }
    });

    return router;
};
