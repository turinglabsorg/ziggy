// Send a text to the operator's Telegram (the container's TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID).
// Runs in the container: node ops/round/notify.mjs "<text>"   (or the text on stdin)
import { readFileSync } from "node:fs";
const text = process.argv[2] || readFileSync(0, "utf8");
const token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID;
if (!token || !chatId || !text.trim()) { console.error("notify: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID and a text are required"); process.exit(1); }
const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }) });
if (!res.ok) { console.error(`notify: Bot API → ${res.status}`); process.exit(1); }
console.log(`notify: sent (${text.length} chars)`);
