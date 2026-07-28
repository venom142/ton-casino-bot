const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Task = require('../models/Task');
const { addHistory, safeUid } = require('../utils/helpers');
const { CONFIG } = require('../config');

module.exports = (bot) => {
    // Получить список заданий для пользователя
    router.post('/tasks/list', async (req, res) => {
        try {
            const uidStr = safeUid(req.body?.uid);
            if (!uidStr) return res.json({ tasks: [] });

            const user = await User.findOne({ uid: uidStr });
            const completed = user?.tasks_completed || [];

            const tasks = await Task.find({ is_active: true }).sort({ created_at: -1 });
            const result = tasks.map(t => ({
                code: t.code,
                title: t.title,
                description: t.description,
                reward: t.reward,
                type: t.type,
                completed: completed.includes(t.code)
            }));

            res.json({ tasks: result });
        } catch (e) { res.json({ tasks: [] }); }
    });

    // Проверить выполнение задания
    router.post('/tasks/complete', async (req, res) => {
        try {
            const { uid, task_code } = req.body;
            const uidStr = safeUid(uid);
            if (!uidStr || !task_code) return res.json({ err: "Ошибка данных" });

            const user = await User.findOne({ uid: uidStr });
            if (!user) return res.json({ err: "Ошибка профиля" });

            if (!Array.isArray(user.tasks_completed)) user.tasks_completed = [];
            if (user.tasks_completed.includes(task_code)) {
                return res.json({ err: "✅ Вы уже выполнили это задание!" });
            }

            const task = await Task.findOne({ code: task_code, is_active: true });
            if (!task) return res.json({ err: "❌ Задание не найдено" });

            // Проверка по типу
            if (task.type === 'channel_sub') {
                try {
                    const chatMember = await bot.getChatMember(task.target_value || CONFIG.CHANNEL_ID, uidStr);
                    const status = chatMember.status;
                    if (status !== 'member' && status !== 'administrator' && status !== 'creator') {
                        return res.json({ err: "❌ Вы не подписаны на канал" });
                    }
                } catch (e) {
                    return res.json({ err: "❌ Не удалось проверить подписку" });
                }
            }
            else if (task.type === 'play_games') {
                const required = parseInt(task.target_value) || 10;
                if ((user.spins || 0) < required) {
                    return res.json({ err: `❌ Нужно сыграть ${required} раз. Сыграно: ${user.spins || 0}` });
                }
            }
            else if (task.type === 'referral') {
                // Пока заглушка — реферальная система отдельно
                return res.json({ err: "⏳ Реферальная система в разработке" });
            }

            // Начисляем награду
            user.balance = (user.balance || 0) + task.reward;
            user.tasks_completed.push(task_code);
            addHistory(user, `📢 Задание: ${task.title} +${task.reward} 💎`, task.reward);
            await user.save();

            res.json({ 
                success: true, 
                msg: `✅ Задание выполнено! +${task.reward} 💎`, 
                balance: Math.floor(user.balance) 
            });
        } catch (e) { 
            console.error("Tasks complete error:", e);
            res.json({ err: "Ошибка сервера" }); 
        }
    });

    return router;
};
