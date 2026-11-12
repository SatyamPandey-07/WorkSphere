# Meeting Optimizer and Timezone Overlap Algorithms

This guide records the scheduling behavior implemented by `TimezoneOverlapMatrix` and `MeetingOptimizer`, including the recovery-buffer scoring extension associated with issue #7521. It distinguishes implemented behavior from limitations that callers should not assume are handled.

## 1. TimezoneOverlapMatrix

Source: `src/core/scheduling/TimezoneOverlapMatrix.ts`

### Inputs

Each team member has:

- `id`: participant identifier.
- `timezone`: IANA timezone identifier, such as `Asia/Kolkata` or `America/New_York`.
- `workingHours`: one or more `{ start, end }` hour ranges.

The values in `workingHours` may include fractional hours; for example, `9.5` represents 09:30.

### Overlap calculation

`calculateOverlaps(targetDate)` follows an event-sweep approach:

1. Normalize the target date to UTC midnight and calculate the next UTC midnight.
2. Build one availability interval for each member working-hour range.
3. Convert each interval to a start event and an end event.
4. Sort all events by timestamp. At equal timestamps, end events are ordered before start events.
5. Sweep the events while maintaining a set of active participant IDs.
6. For each non-empty interval between consecutive event timestamps, emit an `OverlapSlot` containing the active participant set and its count.
7. Remove slots shorter than 30 minutes.
8. Sort the remaining slots by participant count descending, then duration descending.

For `E` start/end events, event sorting is (O(E \log E)) and the sweep is (O(E)). If there are (M) members and (H) working-hour ranges per member, interval construction is (O(MH)). The overall cost is (O(MH + E \log E)), with (E = 2MH) for a full set of ranges.

### Sweep-line invariant

Immediately before processing an event at time (t), the active set represents members available in the interval from the previous event time up to (t). That set is emitted for the interval before the current event is applied. End events are processed before start events at the same instant so an interval ending at (t) does not overlap an interval beginning at (t).

### Selecting one overlap

`getOptimalMeetingTime(targetDate)` returns:

- The first slot where every registered member is available, when one exists.
- Otherwise, the first slot from the already-ranked overlap list.
- `null` when no qualifying slot exists.

The minimum overlap duration is currently a fixed 30 minutes.

## 2. Timezone and date-boundary limitations

The class accepts IANA timezone strings and uses `Intl.DateTimeFormat` to validate/format timezone values. However, the current `createLocalDate()` implementation constructs a timestamp by appending `Z` to the requested hour and minute. It then calls `formatToParts()` but does not apply the resulting timezone offset to the returned timestamp.

Consequently, the current implementation does **not** reliably convert local working hours into UTC instants. Its class-level comments should not be read as proof of full daylight-saving or international-date-line correctness.

Known limitations to keep in mind:

- Daylight-saving transitions can produce incorrect intervals because the offset is not applied.
- A team member in a timezone far ahead of or behind UTC can have a local calendar date different from the UTC date used to seed the interval.
- Overnight ranges where the end hour is earlier than the start hour are not explicitly rolled into the following local day.
- The `utcEnd` argument is currently not used to clip per-member intervals to the target UTC day.
- Invalid IANA timezone identifiers are caught and produce no availability intervals for that member's range.

A future timezone-correct implementation should convert each local wall-clock boundary to an instant using the IANA zone's offset at that boundary, validate DST gaps/ambiguous times, account for local-date shifts around UTC midnight, and explicitly model overnight working hours. Add tests around DST spring-forward/fall-back dates and extreme offsets such as UTC+14 and UTC-12 before claiming those cases are supported.

## 3. MeetingOptimizer candidate filtering and ranking

Source: `src/core/ai/MeetingOptimizer.ts`

### Duration filter

`optimizeMeeting(context, overlaps)` first removes candidates whose `durationMinutes` is shorter than `context.durationMinutes`. If no candidates remain, it returns an empty array.

### Recovery-buffer inputs

The #7521 scoring extension accepts:

- `bufferMinutes`: optional per-meeting override. The optimizer default is 15 minutes.
- `participantBusyIntervals`: existing calendar intervals keyed by participant ID. Each interval contains UTC `startUTC` and `endUTC` timestamps.
- `participantTimezones`: IANA timezone identifiers keyed by participant ID.

If a participant has no busy intervals, that participant contributes no recovery penalty. If no timezone is supplied for a participant with busy intervals, UTC is used as the deterministic fallback. Invalid timezone names use a neutral fatigue factor.

### Gap calculation

For candidate slot (s = [s_{start}, s_{end}]) and an existing interval (b = [b_{start}, b_{end}]), the gap is:

[
g(s,b)=
\begin{cases}
(s_{start}-b_{end})/60{,}000 & b_{end} \leq s_{start} \\
(b_{start}-s_{end})/60{,}000 & b_{start} \geq s_{end} \\
0 & \text{when the intervals overlap}
\end{cases}
]

For each participant, the optimizer uses the smallest non-negative gap among their existing intervals. Only gaps strictly less than the configured buffer are penalized. A gap equal to the buffer is sufficient.

### Local fatigue factor

The local hour is calculated from the candidate slot midpoint in that participant's IANA timezone.

| Local time | Factor |
| --- | ---: |
| 00:00–06:59 | 1.75 |
| 07:00–08:59 | 1.35 |
| 09:00–17:59 | 1.00 |
| 18:00–20:59 | 1.25 |
| 21:00–23:59 | 1.75 |

An invalid timezone uses factor 1.00 so a malformed preference does not discard an otherwise viable slot.

### Penalty and score

Let (B) be the recovery buffer in minutes, (g_i) the nearest gap for participant (i), and (f_i) that participant's local fatigue factor.

[
p_i =
\begin{cases}
\dfrac{B-\max(0,g_i)}{B}\,f_i & 0 \leq g_i < B \\
0 & g_i \geq B
\end{cases}
]

The total recovery penalty is:

[
P(s)=\sum_i p_i
]

The ranking score is:

[
\operatorname{score}(s)
=
\operatorname{participantCount}(s)\times 1{,}000{,}000
-
P(s)\times 1{,}000
]

The high participant-count weight preserves attendance as the primary priority for normal team sizes. The recovery penalty differentiates candidates with the same attendance, and equal scores are ordered chronologically by `startUTC`.

### Worked example

With a 15-minute buffer and two participants:

- Candidate A starts 5 minutes after each participant's previous meeting. Each participant has a shortfall of ((15-5)/15 = 0.667). At a neutral local hour, the total penalty is about 1.334.
- Candidate B starts exactly 15 minutes after the previous meetings. The gap meets the buffer, so its penalty is 0.
- If attendance and all other inputs are equal, Candidate B ranks ahead of Candidate A.

If the same shortfall occurs at 22:00 local time, the 1.75 fatigue factor makes that participant's penalty larger than it would be at 14:00.

## 4. Multi-agent rationale

`optimizeMeetingWithGovernor()` calls `optimizeMeeting()` first. It passes up to the first five sorted candidate summaries to the `MultiAgentOrchestrator` to obtain a natural-language rationale and telemetry.

The returned `selectedSlot` is the first locally ranked slot (`sortedSlots[0]`). The orchestrator response supplies the rationale; the current implementation does not parse the model response to override the locally selected slot.

## 5. Current scoring boundaries

The current optimizer does not define separate numeric weights for sleep-window penalties, mealtime penalties, or core-collaboration-hour bonuses. The only time-of-day adjustment in the recovery extension is the local fatigue multiplier documented above. Add any future scoring dimension as a named, configurable parameter with unit tests before documenting it as active behavior.

The overlap matrix's timezone conversion limitation also applies to candidate slots produced by that matrix. Recovery scoring can correctly read the local hour of a UTC candidate timestamp, but it cannot repair an incorrectly constructed candidate interval from the overlap matrix.
