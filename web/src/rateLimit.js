import { ApiError } from './routes/receipts.js';

/**
 * IP당 고정 창(windowMs) 요청 수 제한. 메모리에만 두므로 서버 1대 기준이다.
 * max가 0이면 아무것도 막지 않는다(로컬 기본).
 * 프록시 뒤(Hugging Face 등)에서는 app 'trust proxy' 를 켜야 req.ip 가 실제 사용자 IP가 된다.
 * @param {{ windowMs: number, max: number, message?: string, now?: () => number }} opts
 */
export function createRateLimiter({ windowMs, max, message = '요청이 너무 많습니다', now = Date.now }) {
  const hits = new Map(); // ip → { count, resetAt }
  return function rateLimit(req, res, next) {
    if (!max) return next();
    const t = now();
    // 만료된 항목 정리(메모리가 계속 늘지 않게)
    if (hits.size > 10_000) for (const [ip, h] of hits) if (h.resetAt <= t) hits.delete(ip);
    let h = hits.get(req.ip);
    if (!h || h.resetAt <= t) {
      h = { count: 0, resetAt: t + windowMs };
      hits.set(req.ip, h);
    }
    if (++h.count <= max) return next();
    const sec = Math.ceil((h.resetAt - t) / 1000);
    res.set('Retry-After', String(sec));
    next(new ApiError(429, 'RATE_LIMITED', `${message}. ${sec}초 뒤에 다시 시도하세요`));
  };
}
