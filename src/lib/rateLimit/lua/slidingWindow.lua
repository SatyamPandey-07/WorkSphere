local key = KEYS[1]
local limit = math.max(1, math.floor(tonumber(ARGV[1]) or 1))
local window_ms = math.max(1, math.floor(tonumber(ARGV[2]) or 60000))
local now = tonumber(ARGV[3]) or 0
local member = ARGV[4]
local cost = math.max(0, math.floor(tonumber(ARGV[5]) or 1))

if now <= 0 then
  now = tonumber(redis.call("TIME")[1]) * 1000
end

local window_start = now - window_ms
redis.call("ZREMRANGEBYSCORE", key, "-inf", window_start)
local count = tonumber(redis.call("ZCARD", key))

local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
local reset_time = now + window_ms
if oldest and #oldest >= 2 then
  reset_time = tonumber(oldest[2]) + window_ms
end

if cost == 0 then
  local remaining = math.max(0, limit - count)
  local retry_after = 0
  if count >= limit then
    retry_after = math.max(1, math.ceil((reset_time - now) / 1000))
  end
  return { count < limit and 1 or 0, remaining, math.ceil(reset_time / 1000), retry_after, count }
end

if count + cost <= limit then
  for i = 1, cost do
    redis.call("ZADD", key, now, member .. ":" .. i)
  end
  redis.call("PEXPIRE", key, window_ms)
  return { 1, math.max(0, limit - count - cost), math.ceil(reset_time / 1000), 0, count + cost }
end

local retry_after = math.max(1, math.ceil((reset_time - now) / 1000))
return { 0, 0, math.ceil(reset_time / 1000), retry_after, count }
