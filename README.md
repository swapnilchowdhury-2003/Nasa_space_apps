# AstraGuard AI: Front-end Prototype
Team **Levi Squad** · NASA Space Apps Challenge 2026

Offline-first astronaut health console. Front end only: all data is simulated in the browser.

## Run
Open `index.html` in any modern browser. No server, no internet needed (Bootstrap and Chart.js are bundled in `vendor/`).

## Demo flow (for the pitch)
1. Show the live vitals for the focused crew member (Vega).
2. Click **Cardiovascular stress**, **Radiation event** or **Fatigue** in the Scenario simulator.
3. Watch tiles turn amber/red, the anomaly score rise, and the alert feed fill.
4. A protocol pop-up appears with step-by-step actions. Tick the steps and mark completed.
5. Toggle **Earth uplink** off to show the system keeps working with no Mission Control link.
6. Point at the 48-hour risk forecast and the Vitality index.

## Structure
- `index.html`: layout
- `css/style.css`: dark HUD theme
- `js/sim.js`: simulated telemetry, baseline-deviation score, forecast, placeholder protocols
- `js/app.js`: charts, alerts, modal, UI logic
- `vendor/`: Bootstrap 5.3.3, Chart.js 4.4.4

## What is simulated (be honest with judges)
- Vitals and habitat data are generated random walks around each crew member's baseline.
- "Anomaly score" is a simple z-score deviation, a stand-in for the planned Isolation Forest model.
- 48-hour forecast is a mock curve, a stand-in for Prophet / XGBoost.
- Protocol text is placeholder content, not official NASA guidance.

## Next steps
FastAPI + WebSocket backend, PostgreSQL storage, real ML models, BLE wearable input, NASA analog mission datasets.
