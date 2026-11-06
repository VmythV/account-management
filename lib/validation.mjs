export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function text(value, label, max = 150, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || value.includes('\0')) {
    throw new HttpError(400, `${label}${required ? '不能为空，且' : ''}不能超过 ${max} 个字符。`);
  }
  return value.trim();
}
export function fields(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !allowed.includes(k))) {
    throw new HttpError(400, '请求包含不支持的字段。');
  }
}
export function choice(value, allowed, label) {
  if (!allowed.includes(value)) throw new HttpError(400, `请选择有效的${label}。`);
  return value;
}
export function occurredAt(value) {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(time) || time < 0 || new Date(time).toISOString() !== value || time > Date.now()) {
    throw new HttpError(400, '操作时间必须是已经发生的有效时间。');
  }
  return value;
}
export function calendarDate(value) {
  if (value === '') return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, '请填写有效的注册日期，未知可以留空。');
  }
  return value;
}
export function website(value) {
  const address = text(value, '网站地址', 2048);
  if (!address) return '';
  let url;
  try { url = new URL(address); } catch {}
  if (!url || !/^https?:\/\//i.test(address) || !['http:', 'https:'].includes(url.protocol)
    || !url.hostname || url.username || url.password || /[\u0000-\u001f\u007f]/.test(address)) {
    throw new HttpError(400, '网站地址必须以 http:// 或 https:// 开头，且不能包含登录凭据。');
  }
  return text(url.href, '网站地址', 2048);
}
