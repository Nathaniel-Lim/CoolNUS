# CoolNUS · Meridian Airport Simulator

A local airport simulator for Autonomous SG Challenge 2. Import airport parameters, preview flight CSV/TSV data, and inject **one selected flight occurrence** into a shared simulation. The dashboard, JSON observations, exported state and persisted snapshots use the same authoritative state.

**ATC, Pilot and Ground LLM agents are not implemented.** The role-specific views and manual command adapters are interfaces for future integration. Deterministic movement and specialist task dispatch remain the baseline.

## Run

Requires Node.js 20 or newer. No external runtime packages, API keys or build step.

```sh
npm start
npm test
```

Open http://127.0.0.1:3000. Use `PORT=3001 npm start` for another port. The server binds to loopback only.

## Browser workflow

1. Pause the simulation. Open **Airport configuration**.
2. Paste a header and airport rows, upload a `.csv`/`.tsv`/`.txt` file, or choose **Load supplied examples**.
3. Preview the table, choose an airport, choose the capacity interpretation, and click **Apply airport configuration**.
4. In **Scenario Control / Flight data**, paste or upload flight data, or load the supplied examples.
5. Preview the rows. A multi-row input requires explicit selection of **exactly one row**. Previewing never injects anything.
6. Check the route, service date, eligibility, times, assumptions and validation messages. The configured airport must match the flight's **origin**.
7. Optionally align the clock to the first imported flight's scheduled departure. The checkbox describes the clock change; only synthetic background plans shift with it.
8. Click **Inject selected flight**. Inspect the updated flight board, gate availability, disruption count and individual Pilot JSON context.
9. Run, pause, step 30 seconds or advance 30 minutes while paused. Export the complete state as JSON.

**DFW + AA5 example:** DFW loads 4 runways and 150 underlying gates, with 3 initially spare gates in addition to explicitly parked aircraft. Select AA5 (DFW → HNL, 2015-01-01). It qualifies through its 92-minute late-aircraft delay. The **total departure delay of 289 minutes** moves the replay's earliest off-block time from 13:05 to 17:54 America/Chicago, once. The spare count falls from 3 to 2 when this aircraft receives a stand. No runway closes and no mechanic or emergency task is generated.

The schematic groups large gate inventories into at most 12 cards. Select a group or open **Gate inventory** to inspect individual gates; search any ID, including G150. The full inventory is always in state.

Reset is explicit and clears flights/imported scenarios back to the demo seed, but retains the airport catalog so it can be reapplied. Switching airports or aligning the clock requires a paused simulation with no active surface movements or synthetic incidents. Changing airports after flight injection requires an explicit reset.

## Airport inputs

Required columns:

```text
IATA_CODE,AIRPORT,CITY,STATE,delayed_departures_in_flights_csv,size_class,active_runways,gates,max_runway_ops_per_hour,min_turnaround_min,spare_gates_at_any_time
```

Optional `TIMEZONE` (or `timezone`) accepts a valid IANA timezone. Source strings are retained in `rawRow`. The supplied screenshot's 20 complete visible airport rows are included in `examples/airports.csv`; airport names remain as supplied. This is not an assertion of current real-world airport capacity or naming.

- `delayed_departures_in_flights_csv` is descriptive metadata, never traffic demand or a spawn count.
- `gates` is total inventory. Unmodelled occupancy is explicitly marked `backgroundOccupied: true` and labelled synthetic, leaving the supplied spare pool free in addition to modelled parked aircraft. As modelled aircraft arrive/depart, availability changes normally.
- Runway capacity defaults to an **airport-wide assumption** selected visibly in the UI. The alternative is per-runway; both interpretation and provenance are stored. The simulator counts the start of arrivals and departures in a rolling 3,600-second window and never silently multiplies an airport-wide limit by runway count.
- Minimum turnaround applies from a known/simulated on-block timestamp. Existing synthetic aircraft use a labelled synthetic on-block time; subsequent synthetic arrivals record theirs. Already elapsed turnaround time is preserved when parameters change.
- Runway names, taxiway routes, gate groups and geometry are schematic. Imported tables do not supply real layouts. Two exclusive abstract taxiway routes remain.
- Validation allows 1–16 runways, 1–2,000 gates, nonnegative integer turnaround/spare counts and positive capacity; spare counts cannot exceed inventory. Parked aircraft plus spare inventory must fit.

## Flight inputs

The complete 31-column schema is in `examples/flights.csv`. It contains all 19 flight rows supplied in chat. `examples/flight-AA5.tsv` contains a header and one TSV row for upload/paste testing.

Inputs are bounded to **5 MiB and 10,000 data rows**. Export a subset of a larger `flights.csv` before uploading. CSV quoting, escaped quotes, embedded newlines, tabs, CRLF, BOMs, blank cells and leading-zero time strings are supported. Headers and row widths are validated. A malformed table is rejected; an individually invalid flight row is shown with its original fields and an explanation, while other rows remain selectable.

Eligibility uses strict OR:

```text
WEATHER_DELAY > 15 OR LATE_AIRCRAFT_DELAY > 20
```

15 and 20 exactly do not qualify. Missing values remain null. Signed departure/arrival delays are valid source values, but this replay convention requires a **nonnegative, present DEPARTURE_DELAY**, resolvable scheduled origin departure, and known non-cancelled/non-diverted status. Cancelled, diverted, ineligible and incomplete rows remain previewable with explicit reasons; they are not silently normalised into normal flights.

### Time semantics

HHMM is a local clock: `1305 → 13:05`, `648 → 06:48`, `24 → 00:24`, `3 → 00:03`. `2400` means midnight on the next date; 2401, 2360 and decimal-clock strings are invalid.

Origin departure/wheels-off clocks use the origin timezone; destination arrival/wheels-on clocks use the destination timezone. A curated IATA→IANA metadata map is explicit in `src/data.mjs`; an imported TIMEZONE column overrides it. Browser/host timezone is never used to infer a source time.

Dates for arrival and actual events are resolved using supplied duration/delay anchors in UTC, then checked against the source's local clock (minute precision). This handles cross-midnight flights and routes across timezones. Missing timezone metadata, missing anchors, inconsistent clocks, and ambiguous/nonexistent daylight-saving times remain explicitly unresolved, with raw local values preserved. Unknown destination timezones can coexist with a supported origin departure replay; unresolved origin scheduled departure blocks it.

### Replay convention

`DEPARTURE_DELAY` shifts scheduled gate departure to an earliest off-block eligibility once. Weather, late-aircraft, airline, air-system and security components are retained as explanations. They are neither added on top of total delay nor required to sum to it.

Scheduled times, historical actuals, revised plans and simulation-observed actual events are separate fields. Historical actual gate departure is not wheels-off; gate arrival is not wheels-on. Imported flights start parked or waiting for a spare stand in an **origin-airport departure replay**. Their eventual simulated off-block and wheels-off times are recorded independently. Destination revised arrival stays null until a future planner provides one; original scheduled and historical arrival stay in the source context.

A row does not provide remaining fuel or a preceding flight's on-block time. Imported aircraft use labelled synthetic fuel defaults and an explicitly assumed origin positioning/readiness state. No new minimum-turnaround countdown is fabricated from injection time. This phase cannot establish whether an unobserved preceding turnaround complied with the supplied minimum.

A weather delay does not imply a runway closure; late-aircraft delay does not imply a mechanical fault. Imported delay events live in `data.disruptions`, separately from manual synthetic incidents and specialist tasks.

## State, persistence and personnel

Schema 1.1 adds `data.airportCatalog`, `data.airportImport`, `data.flightImports`, `data.disruptions` and `data.activeFlightId`. A flight import separates the raw source row, normalised flight and import/injection provenance. Applied timing changes record before/after times, applied/unapplied minutes, application status and revision. A stable occurrence ID prevents accidental duplicate injection, including re-upload of an identical row.

Injection adds one aircraft/pilot to the existing relevant traffic. Synthetic backgrounds are retained and labelled. Rebase is opt-in and first-import only; it shifts synthetic plans and known on-block timestamps by the same offset, preserving elapsed simulation state. Existing audit events retain their original timestamps. Without rebase, the simulator retains its current epoch, even if a historical departure eligibility is already in the past.

Validation and changes are performed on a clone. Failed imports do not update state, revision, events or snapshots. Atomic file replacement completes before the live state is published. `.data/state.json` persists each update. Restart restores it **paused**; legacy schema 1.0 snapshots migrate without clearing personnel or traffic.

Ground remains a list of three lists, with multiple independent people in each:

```text
ground.crewTypeOrder = [emergency_response, mechanic, inspector]
ground.crews = [ [ER-1, ER-2, ...], [ME-1, ME-2, ...], [IN-1, IN-2, ...] ]
```

Each person has a stable ID, type, availability, location, current task and completion count. The original manual bird-strike, debris, aircraft-fault and staged disabled-aircraft scenarios remain under **Manual synthetic incidents**. Auto-dispatch is deterministic; specialty and prerequisite checks remain enforced.

## API

| Method / endpoint | Purpose |
| --- | --- |
| GET `/api/state` | Authoritative operator state; also used by JSON export |
| GET `/api/events` | Server-sent full-state updates |
| POST `/api/import/airports/preview` | `{text, capacityScope}` → validated catalog; no state change |
| POST `/api/import/airports/apply` | `{text?, airportCode, capacityScope, expectedRevision, sourceName?}`; absent text uses saved catalog |
| POST `/api/import/flights/preview` | `{text}` → selectable rows with original fields, normalised previews, warnings/errors |
| POST `/api/import/flights/inject` | `{text, rowIndex, expectedRevision, rebaseClock, sourceName?}` → one atomic injection |
| GET `/api/examples/airports.csv` | Supplied airport examples |
| GET `/api/examples/flights.csv` | All 19 supplied flight rows |
| GET `/api/agents` | Future identities and view URLs; `agentsImplemented: false` |
| GET `/api/views/atc` | Airport-wide observations, imported scenarios and delay events |
| GET `/api/views/pilots/:id` | Individual aircraft and its imported scenario/reference outcomes |
| GET `/api/views/ground/:id` | Individual person, assignments, airport config and delay summary |
| POST `/api/actions` | Existing validated manual role adapters, with actor and expectedRevision |
| POST `/api/control` | Play, pause, speed, step, reset |

`rowIndex` is zero-based. Import mutations require the current revision and a paused simulation. Stale revisions return HTTP 409; invalid inputs return 400. A fresh preview is advisable after a configuration change. Input is reparsed/validated on the server at apply/injection time; client previews are not trusted as authority.

Existing manual actions remain: ATC `set_plan`/`resource_status`; individual Pilot `hold`; individual Ground `assign_task`/`crew_availability`; Operator additionally `incident`/`auto_dispatch`. The local API validates scope, not authenticated identity; actor IDs are client-provided. No authentication, live agent, LLM call or consensus loop is implemented.

## Validation and limitations

The automated suite covers CSV/TSV parsing, all supplied rows, strict thresholds, missing/signed values, clock rollover/DST, airport lookup, resource inventories, spare gates, capacity, turnaround, atomic failures, duplicate protection, clock alignment, once-only delay application, scoped observations, HTTP responses, persistence/restart and legacy migration. Run `npm test` for the current count and results.

Browser checks cover airport import and selection, DFW's 4-runway/150-gate overview, selecting exactly one of 19 flights, AA5 injection, TSV upload, duplicate prevention, SFO's 3-runway/70-gate configuration and individual gate inspection. JSON is read from the same backend as the flight board.

Remaining challenge definitions: capacity scope is explicitly operator-selected; background gate occupancy and taxiway geometry are synthetic; fuel and wake-separation challenge workbooks are not part of this import task. Existing synthetic fuel burn/reserve and runway occupancy/reuse assumptions remain labelled in observations. No claim is made to simulate real airport safety or a complete multi-agent solution.

## Source layout

- `src/data.mjs`: CSV/TSV parsing, airport schemas, flight validation, HHMM/date/timezone normalisation.
- `src/scenario.mjs`: atomic airport application, selected-row injection, provenance and snapshot migration.
- `src/simulator.mjs`: authoritative state, resource transitions, capacity, personnel, scoped observations and invariants.
- `server.mjs`: local HTTP API, persistence and event stream.
- `public/`: existing dashboard design plus import forms, dynamic schematic, inventory and future-agent JSON panel.
- `examples/`: airport CSV, supplied flight CSV and AA5 TSV.
- `test/`: parser, replay, state, HTTP and persistence tests.
