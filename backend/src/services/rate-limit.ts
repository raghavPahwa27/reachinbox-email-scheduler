import type { Redis } from "ioredis";

// All decisions use Redis TIME. A lease serializes SMTP per sender across processes.
export const reserveScript = `
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return {-1, now, 0, 0} end
local window = math.floor(now / 3600000)
local boundary = (window + 1) * 3600000
local counterKey = KEYS[2] .. ':' .. window
local count = tonumber(redis.call('GET', counterKey) or '0')
local limit = tonumber(ARGV[2])
local delay = tonumber(ARGV[3])
local nextSend = tonumber(redis.call('GET', KEYS[3]) or '0')
if count >= limit then return {0, math.max(boundary, nextSend), count, window} end
if nextSend > now then return {0, nextSend, count, window} end
if redis.call('SET', KEYS[4] .. ':' .. window, '1', 'NX', 'PX', 7200000) then
  count = redis.call('INCR', counterKey)
  redis.call('PEXPIREAT', counterKey, boundary + 3600000)
end
redis.call('SET', KEYS[3], now + delay, 'PX', math.max(delay + 3600000, 7200000))
if count >= limit then
  local eventId = ARGV[4] .. '-' .. window
  redis.call('HSETNX', KEYS[5], eventId, cjson.encode({senderId=ARGV[4],userId=ARGV[5],senderEmail=ARGV[6],limit=limit,nextAvailable=boundary,window=window,eventId=eventId}))
end
return {1, boundary, count, window}
`;

export const releaseScript = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  local clock = redis.call('TIME')
  local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
  local nextSend = tonumber(redis.call('GET', KEYS[2]) or '0')
  redis.call('SET', KEYS[2], math.max(nextSend, now + tonumber(ARGV[2])), 'PX', math.max(7200000, tonumber(ARGV[2]) + 3600000))
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`;
export const renewScript = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end`;
export const SLACK_OUTBOX = "reachinbox:slack-outbox";
export const leaseKey = (senderId: string) =>
  `reachinbox:sender:${senderId}:lease`;
const nextKey = (senderId: string) => `reachinbox:sender:${senderId}:next`;
export interface RateEvent {
  senderId: string;
  userId: string;
  senderEmail: string;
  limit: number;
  nextAvailable: number;
  window: number;
  eventId: string;
}
export async function reserveSend(
  redis: Redis,
  input: {
    senderId: string;
    userId: string;
    senderEmail: string;
    token: string;
    attemptId: string;
    limit: number;
    delayMs: number;
  },
) {
  const result = (await redis.eval(
    reserveScript,
    5,
    leaseKey(input.senderId),
    `reachinbox:sender:${input.senderId}:hour`,
    nextKey(input.senderId),
    `reachinbox:attempt:${input.attemptId}`,
    SLACK_OUTBOX,
    input.token,
    input.limit,
    input.delayMs,
    input.senderId,
    input.userId,
    input.senderEmail,
  )) as number[];
  return {
    allowed: result[0] === 1,
    leaseLost: result[0] === -1,
    nextAvailable: result[1]!,
    count: result[2]!,
    window: result[3]!,
  };
}
export async function releaseSender(
  redis: Redis,
  senderId: string,
  token: string,
  delayMs: number,
) {
  return redis.eval(
    releaseScript,
    2,
    leaseKey(senderId),
    nextKey(senderId),
    token,
    delayMs,
  );
}
