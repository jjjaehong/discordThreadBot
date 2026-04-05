const { Client, GatewayIntentBits, ChannelType } = require("discord.js");

// 로컬: config.json 사용 / Railway 배포: 환경변수 사용
let config = {};
try {
  config = require("./config.json");
} catch {
  // config.json 없을 때 환경변수로 대체
}

// 환경변수가 있으면 우선 사용
if (process.env.DISCORD_TOKEN) config.token = process.env.DISCORD_TOKEN;
if (process.env.CHANNEL_ID) config.weeklyScrumChannelId = process.env.CHANNEL_ID;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

// 한국 시간 기준으로 Date 반환
function nowKST() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
}

function getNextFridayAtSeven(now) {
  const targetDay = 5; // 금요일
  const next = new Date(now);
  const daysUntil = (targetDay - now.getDay() + 7) % 7;
  next.setDate(now.getDate() + daysUntil);
  next.setHours(19, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 7);
  }
  return next;
}

function getWeekStart(date) {
  const d = new Date(date);
  const diff = (d.getDay() + 6) % 7; // 월요일=0
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
    thisWeekItems.length > 0 ? thisWeekItems.map((item) => `- ${item}`).join("\n") : "-";
  const nextWeekLines =
    nextWeekItems.length > 0 ? nextWeekItems.map((item) => `- ${item}`).join("\n") : "-";

  return (
    `예시)\n${info.month}월 ${info.ordinal}주 ${groupName} 위클리스크럼\n` +
    "이번 주 할 일\n" +
    `${thisWeekLines}\n\n` +
    "다음 주 할 일\n" +
    `${nextWeekLines}`
  );
}

function buildWeeklyScrumParentMessage(info) {
  return `**${info.month}월 ${info.ordinal}주 위클리스크럼입니다.**`;
}

// 이번 주 스레드가 이미 존재하는지 확인
async function isThreadAlreadyCreatedThisWeek(channel, threadName) {
  try {
    if (channel.type === ChannelType.GuildForum) {
      const threads = await channel.threads.fetchActive();
      const archived = await channel.threads.fetchArchived({ limit: 10 });
      const allThreads = [...threads.threads.values(), ...archived.threads.values()];
      return allThreads.some((t) => t.name === threadName);
    } else {
      const threads = await channel.threads.fetchActive();
      const archived = await channel.threads.fetchArchived({ limit: 10 });
      const allThreads = [...threads.threads.values(), ...archived.threads.values()];
      return allThreads.some((t) => t.name === threadName);
    }
  } catch (err) {
    console.warn("스레드 중복 확인 실패 (계속 진행):", err.message);
    return false;
  }
}

async function createWeeklyScrumThread() {
  const channelId = config.weeklyScrumChannelId;
  if (!channelId) {
    console.warn("weeklyScrumChannelId가 config.json에 없습니다.");
    return;
  }

  const now = nowKST();
  const info = buildWeeklyScrumInfo(now);
  const defaultThreadName = `${info.month}월 ${info.ordinal}주 위클리스크럼(${info.range})`;
  const threadName = config.weeklyScrumThreadName || defaultThreadName;
  const messageContent = config.weeklyScrumMessage || buildWeeklyScrumMessage(info);
  const hideParentMessage = config.weeklyScrumHideParentMessage === true;
  const parentMessageContent = buildWeeklyScrumParentMessage(info);

  const channel = await client.channels.fetch(channelId);
  if (!channel) {
    console.warn(`채널을 찾을 수 없습니다: ${channelId}`);
    return;
  }

  // 중복 생성 방지
  const alreadyExists = await isThreadAlreadyCreatedThisWeek(channel, threadName);
  if (alreadyExists) {
    console.log(`이번 주 스레드가 이미 존재합니다: "${threadName}" — 건너뜁니다.`);
    return;
  }

  if (channel.type === ChannelType.GuildForum) {
    await channel.threads.create({
      name: threadName,
      message: { content: messageContent },
    });
    console.log(`포럼 스레드 생성 완료: "${threadName}"`);
    return;
  }

  if (!channel.isTextBased()) {
    console.warn("대상 채널이 텍스트 채널이 아닙니다.");
    return;
  }

  const message = await channel.send(parentMessageContent);
  const thread = await message.startThread({ name: threadName });
  await thread.send(messageContent);
  console.log(`스레드 생성 완료: "${threadName}"`);

  if (hideParentMessage) {
    try {
      await message.delete();
    } catch (error) {
      console.warn("부모 메시지 삭제 실패:", error.message);
    }
  }
}

function scheduleNextRun() {
  const now = nowKST();
  const next = getNextFridayAtSeven(now);
  const delay = Math.max(0, next.getTime() - now.getTime());

  console.log(`다음 위클리스크럼 예약: ${next.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`);

  setTimeout(async () => {
    try {
      await createWeeklyScrumThread();
    } catch (error) {
      console.error("스레드 생성 실패:", error);
    } finally {
      scheduleNextRun();
    }
  }, delay);
}

client.once("ready", () => {
  console.log(`로그인 완료: ${client.user.tag}`);

  if (config.weeklyScrumRunOnceNow) {
    createWeeklyScrumThread().catch((error) => {
      console.error("즉시 실행 실패:", error);
    });
  }

  scheduleNextRun();
});

// 예상치 못한 오류로 봇이 꺼지지 않도록 처리
process.on("unhandledRejection", (error) => {
  console.error("처리되지 않은 Promise 오류:", error);
});

process.on("uncaughtException", (error) => {
  console.error("예상치 못한 오류:", error);
});

client.login(config.token);
