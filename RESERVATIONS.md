# Stations & Reservations

## Station types
Every gaming station (the `PC` model) now has a `type`: `"pc"` (default) or `"playstation"`.
PlayStations are created, started, ended and billed exactly like PCs (same sessions, same reports).
Existing stations are back-filled as `"pc"` on server start.

- `POST /gaming/pcs` / `PATCH /gaming/pcs/:id` accept `type`.
- `GET /gaming/pcs?type=playstation` filters by type. Each station includes `upcomingReservation`
  (next booking in the next 12h) so the POS can show a badge.
- `GET /gaming/pcs/status` (public) now returns `type`, `nextReservation` (time slot only, never customer
  data) and `statsByType: { pc, playstation }`. `stats` still means PCs only.

## Booking rules (editable from the POS)
Stored in a single `ReservationSettings` document (`GET/PUT /reservations/settings`, admin/manager to edit):

| Setting | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Website bookings on/off (staff can always book) |
| `timezone` | `Asia/Beirut` | All times are interpreted in this timezone |
| `schedule` | every day 16:00–04:00 | Per weekday `open` / `close` (close ≤ open = next morning), `closed` |
| `slotMinutes` | 30 | Start-time granularity (15/30/60) |
| `minDurationMinutes` / `maxDurationMinutes` | 60 / 300 | Website booking length limits |
| `maxAdvanceDays` | 14 | How far ahead customers can book |
| `minLeadMinutes` | 30 | Earliest start = now + this |
| `noShowGraceMinutes` | 15 | Confirmed bookings not checked in by start + grace become `no_show` |
| `bufferMinutes` | 0 | Gap kept free between bookings on the same station |
| `maxStationsPerBooking` | 6 | Group size limit for website bookings |
| `bookableTypes` | pc, playstation | Which station types the website can book |

## Availability
A station is free for `[start, end)` when it is active, not in maintenance, has no overlapping
`confirmed`/`checked_in` booking (± buffer), and — for slots starting within the next hour — is not
currently occupied.

## Public endpoints (website)
- `GET /reservations/public/config`
- `GET /reservations/public/availability?type=pc&date=YYYY-MM-DD&duration=120`
  → `slots[]` with `start`, `end`, `label`, `status` (`available`|`full`|`past`), `availableCount`,
  `availableStationIds`, plus `stations[]`.
- `POST /reservations/public` `{ type, start, durationMinutes, stationIds? | stationCount?, customerName, customerPhone, customerEmail?, notes? }`
  → auto-confirmed booking with a 6-character `code`. Rate-limited (10/hour/IP), max 3 upcoming bookings
  per phone, hidden `website` honeypot field rejects bots, double-booking races are resolved (first wins).
- `POST /reservations/public/lookup` / `POST /reservations/public/cancel` `{ code, phone }`.

## Staff endpoints (POS, authenticated)
- `GET /reservations?date=YYYY-MM-DD&status=confirmed,checked_in&type=&search=`
- `GET /reservations/availability?…` (same as public, without lead-time / booking-window limits)
- `POST /reservations` (phone/walk-in bookings, source `pos`)
- `PATCH /reservations/:id` (move time, change length/stations/customer details)
- `POST /reservations/:id/check-in` `{ createSale? }` → starts a gaming session on every reserved station
  (from 30 min before the start time)
- `PATCH /reservations/:id/cancel` `{ reason? }`, `PATCH /reservations/:id/no-show`

Statuses: `confirmed` → `checked_in` | `cancelled` | `no_show`.
