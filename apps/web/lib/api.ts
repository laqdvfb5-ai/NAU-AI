export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes((options.method || 'GET').toUpperCase());
  const body = options.body ?? (mutation ? '{}' : undefined);
  const res = await fetch('/api/v1' + path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...options,
    body,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const data = await res.json().catch(() => ({ message: 'Không đọc được phản hồi từ máy chủ.' }));
  if (!res.ok) throw new Error(data.message || 'Yêu cầu không thành công.');
  return data;
}
export const post = <T = any>(path: string, body: unknown = {}) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const money = (n: number) =>
  new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(n);
export const date = (s: string) => new Date(s).toLocaleDateString('vi-VN');
