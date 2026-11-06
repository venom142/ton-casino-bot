const axios = require('axios');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { credit } = require('./wallet');

let scanning = false; // защита от наложения двух сканов друг на друга

// Обработка одной транзакции из toncenter. Возвращает true, если пополнение начислено.
async function processDeposit(tx, CONFIG, bot) {
    const msg = tx && tx.in_msg;
    if (!msg || !msg.source) return false;                       // только входящие переводы от кошельков
    const comment = (msg.message || '').trim();
    if (!/^\d{5,15}$/.test(comment)) return false;               // memo = Telegram ID, только цифры
    const val = parseFloat(msg.value || 0) / 1e9;
    if (!(val > 0)) return false;
    const lt = String(tx.transaction_id && tx.transaction_id.lt || '');
    const hash = tx.transaction_id && tx.transaction_id.hash;
    if (!/^\d+$/.test(lt) || !hash) return false;

    // 1) Повтор: эта транзакция уже записана
    if (await Transaction.findOne({ type: 'deposit', tx_hash: hash }).lean()) return false;

    const user = await User.findOne({ uid: comment }).lean();
    if (!user) return false;
    // 2) Старый защитный порог (чтобы не начислить повторно то, что было до появления учёта по hash)
    if (BigInt(lt) <= BigInt(user.last_lt || '0')) return false;

    const added = Math.floor(val * CONFIG.HOTTAP_RATE);
    if (added <= 0) return false;
    // Сначала фиксируем транзакцию (по ней идёт защита от повтора), затем начисляем
    await Transaction.create({ uid: comment, type: 'deposit', ton_amount: val, amount: added, status: 'completed', tx_hash: hash });
    await credit(comment, added, `💰 Донат +${added} 💎`, { total_deposited: val });
    await User.updateOne({ uid: comment }, { $set: { last_lt: lt } });
    if (bot) bot.sendMessage(comment, `💎 <b>ДОНАТ ХОТ ТАП!</b>\n+${added} 💎`, { parse_mode: 'HTML' }).catch(() => {});
    return true;
}

async function scanDeposits(CONFIG, bot) {
    if (scanning) return 0;
    scanning = true;
    let n = 0;
    try {
        const params = { address: CONFIG.WALLET, limit: 20 };
        if (CONFIG.TON_KEY) params.api_key = CONFIG.TON_KEY;
        const res = await axios.get('https://toncenter.com/api/v2/getTransactions', { params, timeout: 10000 });
        if (!res.data || !res.data.ok) return 0;
        // от старых к новым: last_lt растёт монотонно, ничего не пропускается
        const list = [...res.data.result].reverse();
        for (const tx of list) {
            try { if (await processDeposit(tx, CONFIG, bot)) n++; }
            catch (e) { console.error('[deposit] tx error:', e.message); }
        }
    } catch (e) {
        console.error('[deposit] scan error:', e.message);
    } finally { scanning = false; }
    return n;
}

module.exports = { scanDeposits, processDeposit };
