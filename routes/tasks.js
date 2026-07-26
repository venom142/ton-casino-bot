const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { addHistory, safeUid } = require('../utils/helpers');
const { CONFIG } = require('../config');

module.exports = (bot) => {
    router.post('/tasks/check-subscription', async (req, res) => {
        try {
            const uidStr = safeUid(req.body?.uid);
            if (!uidStr) return res.json({ err: "Ошибка профиля" });

            const user = await User.findOne({ uid: uidStr });
            if (!user) return res.json({ err: "Ошибка профиля" });

            // Проверяем, выполнено ли уже задание (с учётом старых документов)
            const alreadyDone = user.tasks && user.tasks.subscribed_channel === true;
            if (alreadyDone) {
                return res.json({ err: "✅ Вы уже выполнили это задание!" });
            }

            try {
                const chatMember = await bot.getChatMember(CONFIG.CHANNEL_ID, uidStr);
                const status = chatMember.status;

                if (status === 'member' || status === 'administrator' || status === 'creator') {
                    const reward = 50;
                    user.balance = (user.balance || 0) + reward;

                    // Надёжное обновление вложенного поля
                    user.set('tasks.subscribed_channel', true);

                    addHistory(user, `📢 Задание: подписка на канал +${reward} 💎`, reward);
                    await user.save();

                    return res.json({ 
                        success: true, 
                        msg: `✅ Подписка подтверждена! +${reward} 💎`, 
                        balance: Math.floor(user.balance) 
                    });
                } else {
                    return res.json({ err: "❌ Вы не подписаны на канал. Подпишитесь и попробуйте снова!" });
                }
            } catch (e) {
                console.error("Task check error:", e.message);
                return res.json({ err: "❌ Не удалось проверить подписку. Убедитесь, что бот добавлен в канал как админ." });
            }
        } catch (e) { 
            console.error("Tasks route error:", e);
            res.json({ err: "Ошибка сервера" }); 
        }
    });

    return router;
};
