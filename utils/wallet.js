const User = require('../models/User');
const Transaction = require('../models/Transaction');

// Объект для атомарного добавления записи в историю игрока (последние 20, как addHistory)
const histEntry = (text, amount) => ({ $each: [{ text, amount: Math.floor(Number(amount) || 0), createdAt: new Date() }], $position: 0, $slice: 20 });

// Атомарное списание: true только если хватило баланса. Возвращает обновлённого игрока или null.
function debit(uid, amount, text, extraInc = {}) {
    return User.findOneAndUpdate(
        { uid, balance: { $gte: amount } },
        { $inc: { balance: -amount, ...extraInc }, $push: { history: histEntry(text, -amount) } },
        { new: true }
    );
}
// Атомарное начисление
function credit(uid, amount, text, extraInc = {}) {
    const upd = { $inc: { balance: amount, ...extraInc } };
    if (text) upd.$push = { history: histEntry(text, amount) };
    return User.findOneAndUpdate({ uid }, upd, { new: true });
}

// Подтверждение вывода. Статус pending -> completed переходит ровно один раз (повторное нажатие ничего не делает).
async function approveWithdraw(txId) {
    const tx = await Transaction.findOneAndUpdate({ _id: txId, type: 'withdraw', status: 'pending' }, { status: 'completed' }, { new: false });
    if (!tx) return { err: 'Заявка не найдена или уже обработана' };
    if (tx.reserved) {
        // сумма уже была заморожена при создании заявки
        await User.updateOne({ uid: tx.uid }, { $inc: { total_withdrawn: tx.amount } });
    } else {
        // старая заявка (до заморозки): списываем сейчас, но только если хватает баланса
        const u = await debit(tx.uid, tx.amount, `🏦 Вывод -${tx.amount} 💎`, { total_withdrawn: tx.amount });
        if (!u) {
            await Transaction.updateOne({ _id: tx._id }, { status: 'pending' }); // откат статуса
            return { err: 'Недостаточно средств у игрока' };
        }
    }
    return { ok: true, tx };
}

// Отклонение вывода: замороженная сумма возвращается игроку (один раз).
async function rejectWithdraw(txId) {
    const tx = await Transaction.findOneAndUpdate({ _id: txId, type: 'withdraw', status: 'pending' }, { status: 'rejected' }, { new: false });
    if (!tx) return { err: 'Заявка не найдена или уже обработана' };
    if (tx.reserved) await credit(tx.uid, tx.amount, `↩️ Возврат вывода +${tx.amount} 💎`);
    return { ok: true, tx };
}

module.exports = { histEntry, debit, credit, approveWithdraw, rejectWithdraw };
