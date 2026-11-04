export const STATUSES = {
  active: '订阅中',
  trial: '试用中',
  paused: '已暂停',
  cancelled: '已取消',
  expired: '已到期',
  banned: '被封禁',
};

export function renewalRule(event) {
  if (event?.renewalCycle === 'monthly') return `每月 ${event.renewalDay} 日`;
  if (event?.renewalCycle === 'yearly') return `每年 ${event.renewalMonth} 月 ${event.renewalDay} 日`;
  return '未设置';
}

export function nextRenewal(event, now = Date.now()) {
  if (!event || !['active', 'trial'].includes(event.status) || !['monthly', 'yearly'].includes(event.renewalCycle)) return null;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const year = today.getFullYear();
  const month = event.renewalCycle === 'yearly' ? event.renewalMonth - 1 : today.getMonth();
  const occurrence = (year, month) => new Date(year, month, Math.min(event.renewalDay, new Date(year, month + 1, 0).getDate()));
  let date = occurrence(year, month);
  if (date < today) date = event.renewalCycle === 'yearly' ? occurrence(year + 1, month) : occurrence(year, month + 1);
  // Calendar days stay whole across daylight-saving changes.
  const dayNumber = value => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / 86_400_000;
  return { date, days: dayNumber(date) - dayNumber(today) };
}

export function summarize(events, now = Date.now()) {
  const ordered = [...events].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  let activeMs = 0;
  const timeline = ordered.map((event, index) => {
    const start = Date.parse(event.occurredAt);
    const end = Math.min(now, ordered[index + 1] ? Date.parse(ordered[index + 1].occurredAt) : now);
    if (event.status === 'active' || event.status === 'trial') activeMs += Math.max(0, end - start);
    return {
      ...event,
      gapMs: index ? start - Date.parse(ordered[index - 1].occurredAt) : null,
    };
  });
  const current = ordered.at(-1) ?? null;
  return {
    current,
    timeline: timeline.reverse(),
    activeMs,
    startedAt: ordered[0]?.occurredAt ?? null,
    sinceLastMs: current ? Math.max(0, now - Date.parse(current.occurredAt)) : 0,
  };
}

export function formatDuration(milliseconds) {
  const minutes = Math.floor(Math.max(0, milliseconds) / 60_000);
  if (minutes === 0) return '不足 1 分钟';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainder = minutes % 60;
  return [days && `${days} 天`, hours && `${hours} 小时`, remainder && `${remainder} 分钟`].filter(Boolean).join(' ');
}
