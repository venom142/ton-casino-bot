const crypto = require('crypto');

// Проверка подписи Telegram WebApp initData (HMAC-SHA256, https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
const MAX_AGE_SEC = 24 * 60 * 60;

function verifyInitData(initData, botToken, maxAgeSec = MAX_AGE_SEC) {
    if (!initData || typeof initData !== 'string' || initData.length > 4096 || !botToken) return null;
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
    params.delete('hash');
    const dataCheckString = [...params.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calc = crypto.createHmac('sha256', secret).update(dataCheckString).digest();
    const given = Buffer.from(hash, 'hex');
    if (given.length !== calc.length || !crypto.timingSafeEqual(calc, given)) return null;
    const authDate = parseInt(params.get('auth_date'), 10);
    if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;
    try {
        const user = JSON.parse(params.get('user') || 'null');
        if (!user || !user.id) return null;
        return user;
    } catch (e) { return null; }
}

module.exports = { verifyInitData };
