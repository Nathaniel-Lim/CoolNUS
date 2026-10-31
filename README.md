# CoolNUS · Meridian Airport Simulator

A local airport simulator for Autonomous SG Challenge 2. The UML entities are the source of the model: Airport contains gates, runways and taxiways; each Pilot has aircraft state, fuel remaining, expected arrival and expected departure; Ground contains **three lists of personnel**. There is exactly one ATC identity.

## Run

Requires Node.js 20 or newer. No external runtime packages, API keys, or build step.

```sh
npm start
```

Open http://127.0.0.1:3000. Use `PORT=3001 npm start` if needed. Run checks with `npm test`.

## What the simulator does

- Six synthetic flights transition through approach, holding, landing, taxi-in, turnaround, ready, taxi-out, holding-short, takeoff and departure.
- Fuel and expected timings are visible per pilot. Expected times remain plans, while actual departure is recorded separately. Waiting does not silently overwrite the original plan.
- Two physical runways, two exclusive taxiway resources and six stands have explicit open/closed status and aircraft reservations.
- A route and stand are reserved before landing. Resources cannot be closed in the middle of a reserved movement. This intentionally conservative model prevents conflicting reservations rather than modelling exact separation geometry.
- Three nested ground personnel lists start with two people each. The engine iterates over the full lists, so additional members can be added in `initialState()` without changing dispatch logic.
- Each person has an ID, type, availability, location, current task and completed task count. An individual can have only one active task.
- Bird strikes generate inspection tasks; aircraft faults generate mechanic tasks; a synthetic disabled-aircraft incident requires emergency response, mechanical recovery, then inspection. These are demo workflows, not actual incident checklists.
- Auto-dispatch can be switched off so crew agents can claim eligible tasks themselves. Completed prerequisite tasks unlock later stages.
- Pause, run at 1×/5×/15×/60×, step 30 seconds, inject disruptions, temporarily close free resources, export JSON and inspect scoped agent observations.
- Atomic JSON snapshots persist to `.data/state.json` after each state update. Restart restores the latest state **paused**. Reset starts the seeded scenario while retaining a monotonic revision number.

## State shape: a list of lists

```json
{
  "atc": { "id": "ATC-1" },
  "ground": {
    "crewTypeOrder": ["emergency_response", "mechanic", "inspector"],
    "crews": [
      [{ "id": "ER-1", "type": "emergency_response" }, { "id": "ER-2", "type": "emergency_response" }],
      [{ "id": "ME-1", "type": "mechanic" }, { "id": "ME-2", "type": "mechanic" }],
      [{ "id": "IN-1", "type": "inspector" }, { "id": "IN-2", "type": "inspector" }]
    ]
  }
}
```

The full state has `airport`, `pilots`, `ground`, `atc`, `incidents`, `tasks`, `events`, `revision`, elapsed simulation seconds and explicit units. Times are ISO-8601 UTC; the UI displays Singapore time. IDs are stable across observations. `ground.crews[0]` is all emergency responders, `[1]` all mechanics, `[2]` all inspectors. Neither a group nor an individual is implicitly collapsed into one agent.

## Connecting future agents

| Endpoint | Observation |
| --- | --- |
| `GET /api/state` | Entire operator/debug state |
| `GET /api/agents` | One ATC identity, all pilot IDs, nested personnel lists and their view URLs |
| `GET /api/views/atc` | One canonical airport-wide context: all aircraft, surfaces, nested crews, tasks and incidents |
| `GET /api/views/pilots/P-3` | Only this pilot's aircraft, fuel, plan, assigned resources, own incidents and surface restrictions |
| `GET /api/views/ground/ME-2` | This person, current assignment, associated incident, completed tasks and eligible jobs of the same specialty |
| `GET /api/events` | Server-sent full-state updates for the operator dashboard |
| `POST /api/actions` | Validated role-specific action with expected revision |
| `POST /api/control` | Operator-only development controls: play, pause, speed, step, reset |

Every observation has schema version, revision, simulation time, units, assumptions, role and actor ID. Feed its JSON directly into the relevant LLM's context. Fetch a fresh observation after a `409` stale revision response; do not retry an old plan blindly.

Example pilot action (replace `12` with the observation's current revision):

```sh
curl -X POST http://127.0.0.1:3000/api/actions \
  -H 'Content-Type: application/json' \
  -d '{"actor":{"role":"pilot","id":"P-3"},"expectedRevision":12,"command":{"type":"hold","pilotId":"P-3","seconds":60}}'
```

Actions by role:

- ATC (`ATC-1`): `set_plan` with `pilotId` and optional `gateId`, `runwayId`, `expectedArrival`, `expectedDeparture`; `resource_status` with `targetId` and `status`. Gate changes are allowed before landing; active movements are immutable.
- Pilot (`P-*`): `hold` with own `pilotId` and `seconds` (0–900). Zero clears a requested hold. The numerical reserve fallback remains mandatory.
- Ground (`ER-*`, `ME-*`, `IN-*`): `assign_task` with own `crewId` and `taskId`; `crew_availability` with own `crewId` and boolean `available`. Specialty, availability and prerequisites are checked.
- Operator: the above plus `auto_dispatch` with boolean `enabled`, and `incident` with `kind` (`bird_strike`, `disabled_aircraft`, `surface_debris`, `aircraft_fault`) and `targetId`. Aircraft faults target a pilot ID at a stand; other incidents target free surface resources.

The local API checks command scope, not user identity: actor IDs are client-provided. Bind is localhost and the app is a single-user development simulator. Add authentication and scoped transport before exposing it to untrusted clients. No LLM integration or negotiation loop is connected yet; deterministic movement and dispatch provide a working baseline.

## Numerical assumptions and limits

All flights, fuel rates, durations and layout are synthetic. Landing occupies a runway for 60 seconds, departure 45 seconds, followed by a 30-second reuse gap. Taxi movements take 90 seconds. At-gate turnaround takes 180 seconds. Airborne burn is 0.7 kg/s; active ground movement burn is 0.15 kg/s; parked aircraft do not burn simulated fuel. Inbound aircraft reaching 900 kg are marked diverted by an abstract reserve fallback, which does not simulate a real diversion flight. Runways are exclusive resources, not an aircraft-category wake-separation model. Taxiway occupancy covers an entire route, not individual segments. The diagram is schematic, not a real airport map.

Expected arrival denotes eligibility for the arrival queue; expected departure denotes earliest planned pushback eligibility. The dashboard labels these planned times. Specialist release is represented by completion of configured tasks, not an AI assessment of airworthiness or runway safety. Incident injection requires an unoccupied resource so it cannot silently invalidate an active clearance.

## Source layout

- `src/simulator.mjs`: state, clock transitions, personnel dispatch, invariant checks, scoped observations, action validation.
- `server.mjs`: local HTTP server, JSON persistence, API and event stream.
- `public/`: responsive operator dashboard, schematic, flight board, three crew lists and JSON inspector.
- `test/simulator.test.mjs`: deterministic transitions, closures, staged specialist response, multiple personnel, role isolation, API and persistence checks.

The original repository README contained only its name and event description; those are preserved here in this expanded project documentation.
