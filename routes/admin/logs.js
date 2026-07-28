const express = require('express');
const router = express.Router();
const AdminLog = require('../../models/AdminLog');

module.exports = () => {
    router.get('/admin/logs', async (req, res) => {
        try {
            const logs = await AdminLog.find().sort({ created_at: -1 }).limit(100);
            res.json(logs);
        } catch(e) { res.json([]); }
    });

    router.post('/admin/logs/clear', async (req, res) => {
        try {
            await AdminLog.deleteMany({});
            res.json({ success: true });
        } catch(e) { res.json({ err: "Ошибка" }); }
    });

    return router;
};
