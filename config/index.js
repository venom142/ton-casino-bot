require('dotenv').config();

const CONFIG = {
    ADMIN_ID: 8475323865, 
    WALLET: "UQDoTj0hCwJbI-9fziRCyUZzO2XHmtcDzuiAiGjxG21G3dIX", 
    TON_KEY: process.env.TON_KEY, 
    START_BALANCE: 100, 
    HOTTAP_RATE: 10000,
    BG_VIDEO: "https://raw.githubusercontent.com/venom142/ton-casino-bot/main/gemini_generated_video_9fc75b5d.mp4", 
    BGM_URL: "https://files.catbox.moe/ef3c37.mp3",
    // Канал для задания на подписку
    CHANNEL_ID: "@XotTap_SanSanik"
};

module.exports = { CONFIG };
