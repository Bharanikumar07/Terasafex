# TERRA-SAFE X: AI-Assisted Disaster Reconnaissance Robot System

TERRA-SAFE X is an operational reconnaissance system engineered for search-and-rescue situational awareness in collapsed structures and hazardous disaster zones.

---

## 🏛️ System Architecture

```text
┌────────────────────────────────────────────────────────┐
│             React + TypeScript + Vite UI               │
│   (Warm Swiss/Editorial Theme, Times Serif, Lucide)    │
└───────────────────────────▲────────────────────────────┘
                            │
               WebSocket    │    REST (Control & Config)
             (Telemetry/2Hz)│    (Safe / Non-physical)
                            │
┌───────────────────────────┴────────────────────────────┐
│                  Python FastAPI Backend                │
│    (/api/health, /api/command, /ws/telemetry, etc.)    │
└───────────────▲────────────────────────▲───────────────┘
                │                        │
┌───────────────┴───────────────┐ ┌──────┴───────────────┐
│     Separate AI Vision        │ │ Deterministic Sensor │
│  Lightweight Inference Layer  │ │  & Physics Simulator │
└───────────────────────────────┘ └──────────────────────┘
                ▲
                │ (Independent Hardware Layer)
┌───────────────┴───────────────┐
│  Arduino ESP32 / ESP32-CAM    │
│  (Pins & Code Preserved)      │
└───────────────────────────────┘
```

---

## 🧠 Real AI Computer Vision Model (TERA X)

- **Model Architecture**: Ultralytics YOLOv8-Nano (`yolov8n.pt`) fine-tuned for disaster reconnaissance person detection.
- **Hardware Profile**: Evaluated and run on **8 GB RAM, AMD Ryzen CPU + AMD Radeon Graphics (DirectX/Vulkan)** using optimized CPU inference.
- **Training Dataset**: COCO Person Dataset subset (`ai_service/datasets/coco_person/`) with train/val splits and normalized YOLO coordinates.
- **Trained Checkpoint Artifact**: `ai_service/runs/tera_person_exp1/weights/best.pt` (6.5 MB).
- **Evaluation Performance**:
  - Precision: **0.1926**
  - Recall: **0.1429**
  - mAP@0.5: **0.0775**
  - mAP@0.5:0.95: **0.0435**
  - Inference Latency: **~48–70 ms per image** on standard AMD CPU.
- **Search-and-Rescue Semantic Rule**: Detections are labeled strictly as **"Possible Person"** (unverified trapped status). The system never fabricates thermal infrared signatures from RGB cameras.

---

## 📂 Project Structure

```
TERA/
├── frontend/                     # React + TypeScript + Vite UI
│   ├── src/
│   │   ├── types/contracts.ts    # TypeScript schemas mirroring Pydantic
│   │   ├── App.tsx               # Mission control dashboard
│   │   ├── index.css             # Warm Swiss/Editorial Times Serif styling
│   │   └── main.tsx
│   ├── package.json
│   └── vite.config.ts
├── backend/                      # Python FastAPI Service
│   ├── main.py                   # REST endpoints & WebSocket telemetry broadcast
│   ├── simulator.py              # Deterministic environmental & physics simulator
│   └── requirements.txt
├── ai_service/                   # Separate AI Reconnaissance Service
│   └── vision_module.py          # Frame detection handler & bounding box formatter
├── firmware/                     # Independent Embedded Code
│   └── esp32_firmware.ino        # Preserved Arduino ESP32 reference firmware
├── contracts/                    # Shared Versioned Contracts (v1.0.0)
│   ├── schemas.py                # Pydantic models (Single source of truth)
│   └── contracts.ts              # Exported TypeScript interfaces
├── tests/                        # Backend and integration tests
│   └── test_backend.py           # Pytest suite for API and determinism
└── README.md                     # Comprehensive system guide
```

---

## 🚀 Quickstart & Setup Guide

### 1. Backend (FastAPI) Setup
```bash
# In the root repository directory
pip install -r backend/requirements.txt

# Start backend server
python backend/main.py
# Server runs on http://localhost:8000
# API docs available at http://localhost:8000/docs
```

### 2. Frontend (React + TypeScript + Vite) Setup
```bash
cd frontend
npm install
npm run build   # Production bundle verification
npm run dev     # Development dashboard on http://localhost:5173
```

### 3. Running Automated Test Suite
```bash
# Run pytest across contracts, SAGE, simulator, and vision inference
c:\tera_env\Scripts\python.exe -m pytest tests/ -v
```

### 4. Communication & API Architecture
- **Bidirectional WebSocket**: `ws://localhost:8000/ws/telemetry`
  - Downlink: Real-time 2Hz robot telemetry stream with multi-sensor readings, calculated risk, and SAGE guidance.
  - Uplink: Real-time motor and teleoperation commands with immediate formal JSON acknowledgement (`COMMAND_ACK`).
  - Liveness: Bidirectional `PING`/`PONG` heartbeat with timestamp freshness tracking.
- **REST Endpoints**:
  - `GET /api/health` - Comprehensive microservices and simulation health check.
  - `GET /api/telemetry` - Point-in-time telemetry snapshot.
  - `POST /api/command` - Safe teleoperation dispatch with idempotency caching (`command_id`).
  - `GET /api/commands/history` - Bounded log of past command executions and outcomes.
  - `POST /api/estop` - Hardware-safe Emergency Stop triggering full safety interlock.
  - `POST /api/simulator/scenario` - Switch repeatable scenarios (`NORMAL`, `GAS_ALERT`, `OBSTACLE_PROXIMITY`, `LOW_BATTERY`, `COMM_LOSS`, `INVALID_SENSOR`, `STALE_TELEMETRY`).
  - `POST /api/simulator/reset` - Reversibly restore simulator state to baseline.
  - `POST /api/ai/predict-sample` - Thread-pooled non-blocking real YOLO inference on disaster test images.

### 5. SAGE AI (Sensor-Aware Guidance Engine)
SAGE fuses visual detections with environmental telemetry to generate explainable tactical guidance:
- **Available Actions**: `INVESTIGATE`, `OBSERVE`, `SLOW_DOWN`, `STOP`, `DATA_UNAVAILABLE`.
- **Operator-in-the-Loop**: All recommendations require explicit operator consent before execution.
- **Uncertainty Quantification**: Calculates confidence penalties based on missing evidence (e.g. absent thermal validation or sensor faults).
- **Zero Fabrication**: Clear provenance labeling (`SIMULATION`, `SAMPLE_IMAGE`, `HARDWARE`). Physical motors remain safety-locked by default.
