const { Client, GatewayIntentBits, ChannelType } = require("discord.js");

let config = {};
try {
  config = require("./config.json");
} catch {}

if (process.env.DISCORD_TOKEN) config.token = process.env.DISCORD_TOKEN;
if (process.env.CHANNEL_ID) config.weeklyScrumChannelId = process.env.CHANNEL_ID;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

function nowKST() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
}

function getWeekStart(date) {
  const d = new Date(date);
  const diff = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekEnd(weekStart) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}

function getWeekOfMonth(date) {
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
  const firstWeekStart = getWeekStart(monthStart);
  const weekStart = getWeekStart(date);
  const diffDays = Math.floor((weekStart - firstWeekStart) / (1000 * 60 * 60 * 24));
  return Math.floor(diffDays / 7) + 1;
}

function formatWeekOrdinal(n) {
  const map = ["첫째", "둘째", "셋째", "넷째", "다섯째", "여섯째"];
  return map[n - 1] || `${n}째`;
}

function formatMonthDay(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function buildWeeklyScrumInfo(baseDate) {
  const weekStart = getWeekStart(baseDate);
  const weekEnd = getWeekEnd(weekStart);
  const weekOfMonth = getWeekOfMonth(baseDate);
  const month = baseDate.getMonth() + 1;
  const ordinal = formatWeekOrdinal(weekOfMonth);
  const range = `${formatMonthDay(weekStart)}~${formatMonthDay(weekEnd)}`;
  return { month, ordinal, range };
}

function buildWeeklyScrumMessage(info) {
  const groupName = config.weeklyScrumGroupName || "회장단";
  const thisWeekItems = Array.isArray(config.weeklyScrumThisWeekItems)
    ? config.weeklyScrumThisWeekItems
    : [];
  const nextWeekItems = Array.isArray(config.weeklyScrumNextWeekItems)
    ? config.weeklyScrumNextWeekItems
    : [];

  const thisWeekLines =
    thisWeekItems.length > 0 ? thisWeekItems.map((i) => `- ${i}`).join("\n") : "-";
  const nextWeekLines =
    nextWeekItems.length > 0 ? nextWeekItems.map((i) => `- ${i}`).join("\n") : "-";

  return (
    `예시)\n${info.month}월 ${info.ordinal}주 ${groupName} 위클리스크럼\n` +
    `이번 주 할 일\n${thisWeekLines}\n\n다음 주 할 일\n${nextWeekLines}`
  );
}

async function isThreadAlreadyCreatedThisWeek(channel, threadName) {
  try {
    const active = await channel.threads.fetchActive();
    const archived = await channel.threads.fetchArchived({ limit: 10 });
    const all = [...active.threads.values(), ...archived.threads.values()];
    return all.some((t) => t.name === threadName);
  } catch {
    return false;
  }
}

async function run() {
  const channelId = config.weeklyScrumChannelId;
  if (!channelId) throw new Error("weeklyScrumChannelId가 없습니다.");

  const now = nowKST();
  const info = buildWeeklyScrumInfo(now);
  const defaultThreadName = `${info.month}월 ${info.ordinal}주 위클리스크럼(${info.range})`;
  const threadName = config.weeklyScrumThreadName || defaultThreadName;
  const messageContent = config.weeklyScrumMessage || buildWeeklyScrumMessage(info);
  const hideParentMessage = config.weeklyScrumHideParentMessage === true;
  const parentMessageContent = `**${info.month}월 ${info.ordinal}주 위클리스크럼입니다.**`;

  const channel = await client.channels.fetch(channelId);
  if (!channel) throw new Error(`채널을 찾을 수 없습니다: ${channelId}`);

  const alreadyExists = await isThreadAlreadyCreatedThisWeek(channel, threadName);
  if (alreadyExists) {
    console.log(`이미 스레드가 존재합니다: "${threadName}" — 종료합니다.`);
    return;
  }

  if (channel.type === ChannelType.GuildForum) {
    await channel.threads.create({
      name: threadName,
      message: { content: messageContent },
    });
  } else {
    if (!channel.isTextBased()) throw new Error("텍스트 채널이 아닙니다.");
    const message = await channel.send(parentMessageContent);
    const thread = await message.startThread({ name: threadName });
    await thread.send(messageContent);
    if (hideParentMessage) {
      try { await message.delete(); } catch {}
    }
  }

  console.log(`스레드 생성 완료: "${threadName}"`);
}

client.once("ready", async () => {
  console.log(`로그인: ${client.user.tag}`);
  try {
    await run();
  } catch (err) {
    console.error("오류:", err);
    process.exit(1);
  } finally {
    client.destroy();
    process.exit(0);
  }
});

client.login(config.token);
