// Telegram report hook for the container (ZIGGY_REPORT_HOOK calls it for every report cycle).
// Reads the bot token and chat id from the environment and posts $ZIGGY_REPORT_TEXT —
// a secret is never printed, logged or read from a file.
const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const text = process.env.ZIGGY_REPORT_TEXT;
if (!token || !chatId || !text) {
  console.error("telegram-notify: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID and ZIGGY_REPORT_TEXT are required");
  process.exit(1);
}
const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
});
if (!res.ok) {
  console.error(`telegram-notify: Bot API → ${res.status} ${await res.text()}`);
  process.exit(1);
}
console.error(`telegram-notify: sent (${text.length} chars)`);
