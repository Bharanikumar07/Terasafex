"""TERRA-SAFE X - FastAPI Mission Control Backend.
REST for commands and configurations, WebSocket for live telemetry & bidirectional command streaming.
ESP32-CAM stream handled as a distinct dedicated route / proxy.
Includes command acknowledgements, idempotency caching, non-blocking AI inference,
repeatable simulation scenario controls, and SAGE guidance.
"""

import sys
import os
import asyncio
import time
import uuid
from typing import List, Set, Dict, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Ensure root contracts and modules can be resolved
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from contracts.schemas import (
    RobotTelemetry,
    MotorCommand,
    CommandAcknowledgement,
    CommandExecutionState,
    SystemHealth,
    RobotMode,
    ConnectionState,
    SimulationScenarioConfig,
    MissionEvent,
    AlertLevel
)
from backend.simulator import RobotSimulator
from ai_service.vision_module import AIVisionService
from ai_service.sage_engine import SAGEEngine

app = FastAPI(
    title="TERRA-SAFE X Mission Control API",
    version="1.1.0",
    description="Backend service for disaster reconnaissance robot with REST controls & WebSocket telemetry."
)

# CORS configuration for local React Vite frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Services
simulator = RobotSimulator(robot_id="TERRA-01")
ai_service = AIVisionService()
active_websockets: Set[WebSocket] = set()

# Physical motor lock: strictly disabled by default
PHYSICAL_MOTORS_LOCKED = True

# Idempotency cache for commands: {command_id: CommandAcknowledgement}
command_history: Dict[str, CommandAcknowledgement] = {}
MAX_COMMAND_HISTORY = 100


def process_motor_command(cmd: MotorCommand) -> CommandAcknowledgement:
    """Validates and executes operator command with formal state tracking and safety rules."""
    cmd_id = cmd.command_id or f"cmd-{int(time.time()*1000)}-{uuid.uuid4().hex[:6]}"
    now_str = time.strftime("%H:%M:%S")

    # 1. Idempotency check: prevent duplicate execution on network retry
    if cmd_id in command_history:
        cached = command_history[cmd_id]
        return cached

    cmd_type = cmd.command.upper()

    # 2. Movement handling with safety locks
    if cmd_type in ["FORWARD", "BACKWARD", "LEFT", "RIGHT"]:
        if not cmd.override_safety and PHYSICAL_MOTORS_LOCKED:
            # Safe simulated execution: updates simulator dead reckoning
            if cmd_type == "FORWARD":
                simulator.x += 0.2
            elif cmd_type == "BACKWARD":
                simulator.x = max(0.0, simulator.x - 0.2)
            elif cmd_type == "LEFT":
                simulator.heading = (simulator.heading - 15) % 360
            elif cmd_type == "RIGHT":
                simulator.heading = (simulator.heading + 15) % 360

            ack = CommandAcknowledgement(
                command_id=cmd_id,
                command=cmd_type,
                status=CommandExecutionState.SIMULATED_EXECUTION,
                accepted=True,
                reason="Executed in simulation environment. Physical actuators remain inhibited by safety interlock.",
                timestamp=now_str,
                speed_pct=cmd.speed_pct,
                override_active=False,
                is_simulation=True
            )
        else:
            ack = CommandAcknowledgement(
                command_id=cmd_id,
                command=cmd_type,
                status=CommandExecutionState.ACCEPTED,
                accepted=True,
                reason=f"Dispatched with override_safety=True at speed {cmd.speed_pct}%.",
                timestamp=now_str,
                speed_pct=cmd.speed_pct,
                override_active=True,
                is_simulation=False
            )

    elif cmd_type in ["PAN_LEFT", "PAN_RIGHT", "TILT_UP", "TILT_DOWN"]:
        # Gimbal commands are simulated
        ack = CommandAcknowledgement(
            command_id=cmd_id,
            command=cmd_type,
            status=CommandExecutionState.SIMULATED_EXECUTION,
            accepted=True,
            reason=f"Gimbal camera adjustment [{cmd_type}] executed in simulation.",
            timestamp=now_str,
            speed_pct=cmd.speed_pct,
            override_active=False,
            is_simulation=True
        )

    elif cmd_type == "STOP":
        simulator.mode = RobotMode.SIMULATION
        ack = CommandAcknowledgement(
            command_id=cmd_id,
            command=cmd_type,
            status=CommandExecutionState.COMPLETED,
            accepted=True,
            reason="Locomotion halted. Robot in station-keeping mode.",
            timestamp=now_str,
            speed_pct=0,
            override_active=False,
            is_simulation=True
        )

    elif cmd_type == "MISSION_START":
        simulator.mode = RobotMode.SIMULATION
        simulator.resume()
        ack = CommandAcknowledgement(
            command_id=cmd_id,
            command=cmd_type,
            status=CommandExecutionState.COMPLETED,
            accepted=True,
            reason="Reconnaissance mission resumed.",
            timestamp=now_str,
            speed_pct=cmd.speed_pct,
            override_active=False,
            is_simulation=True
        )

    elif cmd_type == "MISSION_PAUSE":
        simulator.pause()
        ack = CommandAcknowledgement(
            command_id=cmd_id,
            command=cmd_type,
            status=CommandExecutionState.COMPLETED,
            accepted=True,
            reason="Reconnaissance mission paused.",
            timestamp=now_str,
            speed_pct=0,
            override_active=False,
            is_simulation=True
        )

    else:
        ack = CommandAcknowledgement(
            command_id=cmd_id,
            command=cmd_type,
            status=CommandExecutionState.REJECTED,
            accepted=False,
            reason=f"Unsupported command action '{cmd_type}'.",
            timestamp=now_str,
            speed_pct=0,
            override_active=False,
            is_simulation=True
        )

    # Store in bounded command history
    command_history[cmd_id] = ack
    if len(command_history) > MAX_COMMAND_HISTORY:
        oldest_key = next(iter(command_history))
        del command_history[oldest_key]

    return ack


@app.get("/api/health", response_model=SystemHealth)
async def get_health():
    """Health check endpoint exposing system module status."""
    return SystemHealth(
        status="HEALTHY",
        version="1.1.0",
        is_simulation=True,
        active_connections=len(active_websockets),
        services={
            "fastapi_backend": "UP",
            "ai_vision_module": "READY (LIGHTWEIGHT)",
            "sage_engine": "ACTIVE (RULE-BASED EXPLAINABLE)",
            "telemetry_stream": "ACTIVE",
            "esp32_firmware_bridge": "MOCK_SIMULATION_MODE",
            "motor_safety_interlock": "LOCKED (SAFETY SECURED)"
        }
    )


@app.get("/api/telemetry", response_model=RobotTelemetry)
async def get_telemetry():
    """Retrieve current snapshot of telemetry."""
    return simulator.generate_telemetry()


@app.post("/api/command", response_model=CommandAcknowledgement)
async def send_command(cmd: MotorCommand):
    """Dispatch teleoperation or gimbal command with formal acknowledgement."""
    return process_motor_command(cmd)


@app.get("/api/commands/history")
async def get_command_history():
    """Retrieve bounded history of command acknowledgements."""
    return list(command_history.values())


@app.post("/api/estop")
async def emergency_stop():
    """Emergency Stop trigger. Immediately inhibits all movement."""
    global PHYSICAL_MOTORS_LOCKED
    PHYSICAL_MOTORS_LOCKED = True
    simulator.mode = RobotMode.EMERGENCY_STOP
    cmd = MotorCommand(command="STOP", speed_pct=0, override_safety=False)
    ack = process_motor_command(cmd)
    return {
        "status": "EMERGENCY_STOP_TRIGGERED",
        "detail": "All motor commands halted. Safety interlock engaged.",
        "acknowledgement": ack.model_dump()
    }


# Scenario & Simulation Control Endpoints
@app.post("/api/simulator/scenario")
async def set_simulation_scenario(config: SimulationScenarioConfig):
    """Activates a specific simulation scenario reversibly."""
    simulator.set_scenario(config.scenario_name, config.custom_params)
    return {
        "status": "SCENARIO_UPDATED",
        "active_scenario": simulator.active_scenario,
        "fault_active": simulator.fault_active
    }


@app.post("/api/simulator/fault/gas")
async def inject_gas_fault():
    simulator.trigger_gas_spike()
    return {"status": "FAULT_INJECTED", "type": "GAS_ALERT"}


@app.post("/api/simulator/fault/obstacle")
async def inject_obstacle_fault():
    simulator.trigger_obstacle_proximity()
    return {"status": "FAULT_INJECTED", "type": "OBSTACLE_PROXIMITY"}


@app.post("/api/simulator/fault/battery")
async def inject_battery_fault():
    simulator.trigger_low_battery()
    return {"status": "FAULT_INJECTED", "type": "LOW_BATTERY"}


@app.post("/api/simulator/fault/comm_loss")
async def inject_comm_loss_fault():
    simulator.trigger_comm_loss()
    return {"status": "FAULT_INJECTED", "type": "COMM_LOSS"}


@app.post("/api/simulator/fault/invalid_sensor")
async def inject_invalid_sensor_fault():
    simulator.trigger_invalid_sensor()
    return {"status": "FAULT_INJECTED", "type": "INVALID_SENSOR"}


@app.post("/api/simulator/reset")
async def reset_simulator():
    simulator.reset_state()
    return {"status": "SIMULATOR_RESET", "active_scenario": "NORMAL"}


@app.post("/api/simulator/pause")
async def pause_simulator():
    simulator.pause()
    return {"status": "SIMULATOR_PAUSED"}


@app.post("/api/simulator/resume")
async def resume_simulator():
    simulator.resume()
    return {"status": "SIMULATOR_RESUMED"}


# AI Inference Endpoints
@app.get("/api/ai/status")
async def get_ai_status():
    return ai_service.get_service_status()


@app.post("/api/ai/predict-sample")
async def run_sample_prediction():
    """Execute live real inference on actual disaster test image off-thread to avoid blocking event loop."""
    sample_path = os.path.join(
        os.path.dirname(__file__),
        "..",
        "ai_service",
        "datasets",
        "coco_person",
        "images",
        "val",
        "000000000036.jpg"
    )
    if not os.path.exists(sample_path):
        sample_path = "ai_service/datasets/coco_person/images/val/000000001000.jpg"

    start_t = time.time()
    # Run CPU vision inference in thread pool to prevent blocking WebSocket telemetry loop
    detections = await asyncio.to_thread(ai_service.process_frame, sample_path)
    elapsed_ms = round((time.time() - start_t) * 1000, 2)

    return {
        "sample_image": sample_path,
        "inference_latency_ms": elapsed_ms,
        "source_provenance": "SAMPLE_IMAGE",
        "detections_count": len(detections),
        "detections": [d.model_dump() for d in detections],
        "model_status": ai_service.get_service_status()
    }


@app.get("/api/camera/stream")
async def camera_stream_placeholder():
    return JSONResponse(
        content={
            "stream_protocol": "MJPEG_OVER_HTTP",
            "default_esp32_cam_url": "http://192.168.1.46:81/stream",
            "resolution": "320x240 QVGA",
            "status": "MOCK_STREAM_AVAILABLE_IN_DASHBOARD",
            "note": "Hardware integration requires active ESP32-CAM on matching subnet."
        }
    )


@app.websocket("/ws/telemetry")
async def websocket_telemetry(websocket: WebSocket):
    """Bi-directional WebSocket channel for live telemetry broadcasting & inbound commands."""
    await websocket.accept()
    active_websockets.add(websocket)

    async def sender_loop():
        try:
            while True:
                telemetry_data = simulator.generate_telemetry()
                await websocket.send_text(telemetry_data.model_dump_json())
                await asyncio.sleep(0.5)  # 2Hz deterministic cycle
        except asyncio.CancelledError:
            pass
        except Exception:
            pass

    async def receiver_loop():
        try:
            while True:
                msg_text = await websocket.receive_text()
                try:
                    import json
                    data = json.loads(msg_text)
                    if data.get("type") == "PING":
                        await websocket.send_text(json.dumps({"type": "PONG", "timestamp": time.strftime("%H:%M:%S")}))
                    elif "command" in data:
                        cmd = MotorCommand(**data)
                        ack = process_motor_command(cmd)
                        await websocket.send_text(json.dumps({
                            "type": "COMMAND_ACK",
                            "acknowledgement": ack.model_dump()
                        }))
                except Exception as parse_err:
                    await websocket.send_text(json.dumps({
                        "type": "ERROR",
                        "detail": f"Malformed client payload: {parse_err}"
                    }))
        except asyncio.CancelledError:
            pass
        except WebSocketDisconnect:
            pass
        except Exception:
            pass

    sender_task = asyncio.create_task(sender_loop())
    receiver_task = asyncio.create_task(receiver_loop())

    try:
        # Wait until either sender or receiver disconnects
        done, pending = await asyncio.wait(
            [sender_task, receiver_task],
            return_when=asyncio.FIRST_COMPLETED
        )
        for task in pending:
            task.cancel()
    finally:
        active_websockets.discard(websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
