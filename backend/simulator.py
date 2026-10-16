"""Deterministic Environmental, Sensor, and Physics Simulator for TERRA-SAFE X.
Provides baseline, faulted, degraded, and custom telemetry streams for software validation.
Supports reversible fault injection, repeatable scenarios, and strict provenance labeling.
"""

import time
import math
from typing import Dict, Any, List, Optional
from contracts.schemas import (
    RobotTelemetry,
    SensorReadings,
    RiskAssessment,
    AIDetection,
    RobotMode,
    ConnectionState,
    MissionEvent,
    AlertLevel
)
from ai_service.sage_engine import SAGEEngine


class RobotSimulator:
    """Advanced deterministic robot simulator with multi-scenario fault injection."""

    def __init__(self, robot_id: str = "TERRA-01"):
        self.robot_id = robot_id
        self.step = 0
        self.mode = RobotMode.SIMULATION
        self.connection = ConnectionState.SIMULATED
        self.safety_locked = True
        self.x = 4.8
        self.y = 3.2
        self.heading = 182.5
        self.active_scenario = "NORMAL"
        self.paused = False
        self.events: List[MissionEvent] = []
        self.sage = SAGEEngine()

        # Configurable fault state
        self.fault_active = False
        self.custom_overrides: Dict[str, Any] = {}
        self._init_baseline_events()

    def _init_baseline_events(self):
        self.events = [
            MissionEvent(
                event_id="evt-sim-init",
                timestamp=time.strftime("%H:%M:%S"),
                level=AlertLevel.INFO,
                category="SYSTEM",
                title="Simulation Engine Initialized",
                detail="Deterministic physics & environmental simulator running on v1.1.0 contracts.",
                source_provenance="SIMULATION",
                acknowledged=True
            )
        ]

    def set_scenario(self, scenario_name: str, params: Optional[Dict[str, Any]] = None):
        """Switches active simulation scenario reversibly."""
        self.active_scenario = scenario_name.upper()
        self.fault_active = (self.active_scenario != "NORMAL")
        self.custom_overrides = params or {}

        # Log event for scenario transition
        event_level = AlertLevel.WARNING if self.fault_active else AlertLevel.INFO
        self.events.insert(
            0,
            MissionEvent(
                event_id=f"evt-scen-{int(time.time()*1000)}",
                timestamp=time.strftime("%H:%M:%S"),
                level=event_level,
                category="SYSTEM",
                title=f"Scenario Activated: {self.active_scenario}",
                detail=f"Simulation environment transition to {self.active_scenario}. Provenance: SIMULATION.",
                source_provenance="SIMULATION",
                acknowledged=False
            )
        )
        if len(self.events) > 50:
            self.events.pop()

    def reset_state(self):
        """Restores simulator to nominal baseline parameters."""
        self.active_scenario = "NORMAL"
        self.fault_active = False
        self.custom_overrides = {}
        self.connection = ConnectionState.SIMULATED
        self.step = 0
        self.x = 4.8
        self.y = 3.2
        self.heading = 182.5
        self.paused = False
        self._init_baseline_events()

    def pause(self):
        self.paused = True

    def resume(self):
        self.paused = False

    def trigger_gas_spike(self):
        self.set_scenario("GAS_ALERT", {"gas_mq2_raw": 890, "temperature_c": 56.5})

    def trigger_obstacle_proximity(self):
        self.set_scenario("OBSTACLE_PROXIMITY", {"distance_cm": 9.4})

    def trigger_low_battery(self):
        self.set_scenario("LOW_BATTERY", {"battery_pct": 12, "battery_volts": 9.9})

    def trigger_comm_loss(self):
        self.set_scenario("COMM_LOSS")

    def trigger_invalid_sensor(self):
        self.set_scenario("INVALID_SENSOR")

    def generate_telemetry(self) -> RobotTelemetry:
        """Generates predictable, deterministic telemetry step with SAGE reasoning."""
        if not self.paused:
            self.step += 1

        t = self.step * 0.5
        current_time = time.strftime("%H:%M:%S")

        # Baseline harmonic variations
        base_temp = 34.0 + 1.2 * math.sin(t * 0.1)
        base_humidity = 58.0 + 2.0 * math.sin(t * 0.05)
        base_gas = 280 + int(25 * math.sin(t * 0.2))
        base_dist = 42.0 + 5.0 * math.cos(t * 0.15)
        base_roll = 2.0 * math.sin(t * 0.3)
        base_pitch = 1.5 * math.cos(t * 0.25)
        base_yaw = (self.heading + math.sin(t * 0.05) * 5) % 360
        base_batt = max(15, 78 - int(self.step * 0.02))
        base_volts = 11.8 - (self.step * 0.002)
        base_wifi = -56 + int(3 * math.sin(t * 0.4))

        validity = {
            "temperature": True,
            "humidity": True,
            "distance": True,
            "gas": True,
            "flame": True,
            "motion": True,
            "imu": True,
            "battery": True
        }

        flame_detected = (self.step % 20 < 4) if self.active_scenario != "NORMAL" else False
        motion_pir = True
        conn_state = ConnectionState.SIMULATED
        is_stale = False

        # Apply Scenario specific modifications
        if self.active_scenario == "GAS_ALERT":
            base_gas = self.custom_overrides.get("gas_mq2_raw", 880)
            base_temp += 22.0
            flame_detected = True
        elif self.active_scenario == "TEMP_ALERT":
            base_temp = 68.5
            flame_detected = True
        elif self.active_scenario == "OBSTACLE_PROXIMITY":
            base_dist = self.custom_overrides.get("distance_cm", 9.2)
        elif self.active_scenario == "LOW_BATTERY":
            base_batt = self.custom_overrides.get("battery_pct", 11)
            base_volts = 9.8
        elif self.active_scenario == "COMM_LOSS":
            conn_state = ConnectionState.DISCONNECTED
            base_wifi = -98
        elif self.active_scenario == "INVALID_SENSOR":
            validity["gas"] = False
            validity["distance"] = False
            base_gas = -999  # Corrupt ADC value
            base_dist = -1.0
        elif self.active_scenario == "STALE_TELEMETRY":
            is_stale = True

        sensors = SensorReadings(
            temperature_c=round(base_temp, 1),
            humidity_pct=round(base_humidity, 1),
            distance_cm=max(2.0, round(base_dist, 1)),
            gas_mq2_raw=max(0, base_gas),
            flame_detected=flame_detected,
            motion_pir=motion_pir,
            imu_roll_deg=round(base_roll, 1),
            imu_pitch_deg=round(base_pitch, 1),
            imu_yaw_deg=round(base_yaw, 1),
            battery_pct=int(base_batt),
            battery_volts=round(base_volts, 2),
            wifi_rssi_dbm=int(base_wifi),
            lora_rssi_dbm=-72,
            sensor_validity=validity
        )

        # Baseline simulated detections with explicit SIMULATION provenance
        detections: List[AIDetection] = []
        if self.active_scenario != "CAMERA_FAILURE":
            detections = [
                AIDetection(
                    detection_id=f"sim-det-{self.step}-1",
                    label="Person",
                    confidence=0.84,
                    bounding_box=[0.32, 0.28, 0.54, 0.78],
                    evidence_frames=min(self.step, 15),
                    status="REPEATED" if self.step > 4 else "UNVERIFIED",
                    timestamp=current_time,
                    source_provenance="SIMULATION"
                )
            ]
            if flame_detected or self.active_scenario in ["GAS_ALERT", "TEMP_ALERT"]:
                detections.append(
                    AIDetection(
                        detection_id=f"sim-det-{self.step}-2",
                        label="Fire",
                        confidence=0.88,
                        bounding_box=[0.65, 0.42, 0.82, 0.69],
                        evidence_frames=min(self.step, 12),
                        status="CONFIRMED",
                        timestamp=current_time,
                        source_provenance="SIMULATION"
                    )
                )

        # Compute explainable risk & tactical guidance using SAGE
        risk = self.sage.evaluate(
            sensors=sensors,
            detections=detections,
            connection=conn_state,
            is_stale=is_stale
        )

        return RobotTelemetry(
            timestamp=current_time,
            sequence_number=self.step,
            robot_id=self.robot_id,
            is_simulation=True,
            source_provenance="SIMULATION",
            robot_ip="192.168.1.45 (Simulated)",
            cam_ip="192.168.1.46 (Simulated)",
            mode=self.mode,
            connection=conn_state,
            data_freshness_ms=int((time.time() % 1) * 200),
            sensors=sensors,
            recent_detections=detections,
            risk_assessment=risk,
            motor_safety_locked=self.safety_locked,
            position={"x": round(self.x, 2), "y": round(self.y, 2), "heading_deg": round(base_yaw, 1)}
        )
