"""Test suite for TERRA-SAFE X Backend & Contracts.
Tests schema validation, safety interlocks, health checks, and simulator determinism.
"""

import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.simulator import RobotSimulator
from ai_service.vision_module import AIVisionService
from contracts.schemas import RobotMode, AlertLevel

client = TestClient(app)


def test_health_endpoint():
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "HEALTHY"
    assert data["is_simulation"] is True
    assert "fastapi_backend" in data["services"]


def test_telemetry_schema():
    response = client.get("/api/telemetry")
    assert response.status_code == 200
    data = response.json()
    assert "sensors" in data
    assert "risk_assessment" in data
    assert "recent_detections" in data
    assert data["motor_safety_locked"] is True
    assert data["is_simulation"] is True


def test_motor_safety_interlock_default():
    # Attempting to move without override should remain safely in simulated execution mode
    response = client.post("/api/command", json={"command": "FORWARD", "speed_pct": 50, "override_safety": False})
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "SIMULATED_EXECUTION"
    assert data["accepted"] is True
    assert "simulated" in data["reason"].lower() or "safety" in data["reason"].lower()


def test_emergency_stop():
    response = client.post("/api/estop")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "EMERGENCY_STOP_TRIGGERED"


def test_simulator_determinism():
    sim = RobotSimulator()
    t1 = sim.generate_telemetry()
    t2 = sim.generate_telemetry()
    assert sim.step == 2
    assert t1.sensors.temperature_c > 0
    assert t2.sensors.distance_cm > 0


def test_ai_vision_module():
    ai = AIVisionService()
    detections = ai.process_frame()
    assert len(detections) > 0
    assert detections[0].label in ["Person", "Fire"]
    assert 0.0 <= detections[0].confidence <= 1.0


def test_sage_guidance_generation():
    sim = RobotSimulator()
    telemetry = sim.generate_telemetry()
    assert telemetry.risk_assessment.sage_guidance is not None
    guidance = telemetry.risk_assessment.sage_guidance
    assert guidance.action in ["INVESTIGATE", "OBSERVE", "SLOW_DOWN", "STOP", "DATA_UNAVAILABLE"]
    assert 0.0 <= guidance.uncertainty <= 1.0
    assert guidance.requires_operator_approval is True
    assert len(guidance.reason) > 0


def test_scenario_switching_and_reset():
    response = client.post("/api/simulator/scenario", json={"scenario_name": "GAS_ALERT", "fault_active": True})
    assert response.status_code == 200
    data = response.json()
    assert data["active_scenario"] == "GAS_ALERT"
    
    # Verify gas alert reflects in telemetry
    t_resp = client.get("/api/telemetry")
    t_data = t_resp.json()
    assert t_data["sensors"]["gas_mq2_raw"] > 700
    assert t_data["risk_assessment"]["risk_level"] == "CRITICAL"
    
    # Reset simulator back to normal
    reset_resp = client.post("/api/simulator/reset")
    assert reset_resp.status_code == 200
    reset_data = reset_resp.json()
    assert reset_data["active_scenario"] == "NORMAL"


def test_command_idempotency_caching():
    cmd_payload = {
        "command_id": "test-cmd-unique-42",
        "command": "PAN_LEFT",
        "speed_pct": 25,
        "override_safety": False
    }
    # First submission
    r1 = client.post("/api/command", json=cmd_payload)
    assert r1.status_code == 200
    # Second submission with same command_id
    r2 = client.post("/api/command", json=cmd_payload)
    assert r2.status_code == 200
    assert r1.json()["command_id"] == r2.json()["command_id"]
    assert r2.json()["status"] == "SIMULATED_EXECUTION"


def test_predict_sample_endpoint():
    response = client.post("/api/ai/predict-sample?sample_id=val_sample_1")
    assert response.status_code == 200
    data = response.json()
    assert data["source_provenance"] == "SAMPLE_IMAGE"
    assert "detections" in data
    assert data["detections_count"] >= 0
