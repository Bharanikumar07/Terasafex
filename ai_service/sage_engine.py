"""SAGE: Sensor-Aware Guidance Engine for TERRA-SAFE X.
Provides explainable multi-sensor fusion, evidence validation, risk scoring,
and tactical recommendation planning for disaster reconnaissance.
Strictly decoupled from UI rendering.
"""

import time
from typing import List, Dict, Tuple, Optional
from contracts.schemas import (
    SensorReadings,
    AIDetection,
    RiskAssessment,
    RiskLevel,
    SAGERecommendation,
    GuidanceAction,
    ConnectionState
)


class SAGEEngine:
    """Sensor-Aware Guidance Engine implementing verifiable risk & tactical planning."""

    def __init__(self):
        self.version = "1.1.0"

    def evaluate(
        self,
        sensors: SensorReadings,
        detections: List[AIDetection],
        connection: ConnectionState = ConnectionState.SIMULATED,
        is_stale: bool = False
    ) -> RiskAssessment:
        """Evaluates sensor integrity, evidence validity, and computes explainable risk & guidance."""
        timestamp = time.strftime("%H:%M:%S")

        # 1. Check data availability and freshness
        if connection == ConnectionState.DISCONNECTED or is_stale:
            rec = SAGERecommendation(
                action=GuidanceAction.DATA_UNAVAILABLE,
                summary="Telemetry stream lost or data is stale",
                reason="Cannot assess hazards accurately without fresh sensor telemetry. Halting observation.",
                evidence_references=["Connection: " + connection.value, f"Stale Flag: {is_stale}"],
                timestamp=timestamp,
                confidence=0.95,
                uncertainty=0.85,
                requires_operator_approval=True,
                proposed_observation="Wait for telemetry link restoration or switch to manual recovery mode.",
                source_provenance="SAGE_RULE_ENGINE"
            )
            return RiskAssessment(
                overall_score=75,
                risk_level=RiskLevel.UNKNOWN,
                contributors={"Telemetry Absence Penalty": 0.75},
                primary_hazards=["COMMUNICATION_LOSS_OR_STALE_TELEMETRY"],
                missing_evidence=["All sensor channels unverified"],
                uncertainty=0.85,
                recommendation="DATA UNAVAILABLE: Halt robot station until reliable telemetry stream is re-established.",
                sage_guidance=rec
            )

        # 2. Check sensor validity
        missing_evidence: List[str] = []
        validity = sensors.sensor_validity or {}
        for s_name, is_valid in validity.items():
            if not is_valid:
                missing_evidence.append(f"Sensor invalid: {s_name}")

        # Compute uncertainty based on missing sensor channels
        uncertainty = 0.05 + 0.15 * len(missing_evidence)
        uncertainty = min(0.95, uncertainty)

        # 3. Assess individual risk contributors
        contributors: Dict[str, float] = {}
        primary_hazards: List[str] = []

        # Toxic Gas / Smoke Hazard (MQ-2 raw: baseline ~200-300, elevated >400, dangerous >700)
        gas_risk = 0.0
        if validity.get("gas", True):
            if sensors.gas_mq2_raw > 750:
                gas_risk = 0.40
                primary_hazards.append("CRITICAL: Hazardous Combustible Gas / Toxic Smoke Detected")
            elif sensors.gas_mq2_raw > 400:
                gas_risk = 0.22
                primary_hazards.append("WARNING: Elevated MQ-2 Gas Reading")
            else:
                gas_risk = 0.05
        else:
            gas_risk = 0.20  # penalty for unknown gas state
            primary_hazards.append("UNCERTAIN: MQ-2 Gas sensor reading invalid")
        contributors["Toxic Gas & Smoke (MQ-2)"] = round(gas_risk, 3)

        # Thermal Hazard (High temperature > 50C or optical flame detected)
        thermal_risk = 0.0
        if validity.get("temperature", True) and validity.get("flame", True):
            if sensors.flame_detected:
                thermal_risk = 0.35
                primary_hazards.append("CRITICAL: Optical Flame Sensor Positive")
            elif sensors.temperature_c > 50.0:
                thermal_risk = 0.25
                primary_hazards.append(f"HIGH: Elevated Ambient Temperature ({sensors.temperature_c}°C)")
            elif sensors.temperature_c > 40.0:
                thermal_risk = 0.12
            else:
                thermal_risk = 0.04
        else:
            thermal_risk = 0.18
            primary_hazards.append("UNCERTAIN: Thermal sensors unverified")
        contributors["Thermal & Combustion"] = round(thermal_risk, 3)

        # Obstacle & Terrain Instability (Proximity HC-SR04 & IMU tilt)
        proximity_risk = 0.0
        if validity.get("distance", True):
            if sensors.distance_cm < 15.0:
                proximity_risk = 0.25
                primary_hazards.append(f"COLLISION HAZARD: Forward Obstacle at {sensors.distance_cm} cm")
            elif sensors.distance_cm < 30.0:
                proximity_risk = 0.12
            else:
                proximity_risk = 0.03
        else:
            proximity_risk = 0.15
        contributors["Obstacle Proximity (Ultrasonic)"] = round(proximity_risk, 3)

        # Terrain tilt
        tilt_risk = 0.0
        if validity.get("imu", True):
            max_tilt = max(abs(sensors.imu_roll_deg), abs(sensors.imu_pitch_deg))
            if max_tilt > 25.0:
                tilt_risk = 0.20
                primary_hazards.append(f"UNSTABLE TERRAIN: Robot Pitch/Roll tilt {max_tilt}°")
            elif max_tilt > 15.0:
                tilt_risk = 0.10
            else:
                tilt_risk = 0.03
        contributors["Terrain Tilt (IMU)"] = round(tilt_risk, 3)

        # Battery Health
        if validity.get("battery", True) and sensors.battery_pct < 20:
            primary_hazards.append(f"POWER CRITICAL: Battery below 20% ({sensors.battery_pct}%)")
            contributors["Battery Depletion"] = 0.15

        # Visual AI Person & Hazard Evidence
        person_candidates = [d for d in detections if d.label.lower() == "person"]
        fire_candidates = [d for d in detections if d.label.lower() in ["fire", "flame"]]

        if fire_candidates:
            fire_conf = max(d.confidence for d in fire_candidates)
            contributors["Visual Fire Detection (AI)"] = round(0.30 * fire_conf, 3)
            primary_hazards.append(f"AI CONFIRMED: Visual Fire Signature (conf {int(fire_conf * 100)}%)")

        if person_candidates:
            max_conf = max(d.confidence for d in person_candidates)
            contributors["Human Presence / Survivor Search"] = round(0.15 * max_conf, 3)

        # 4. Overall Score Calculation (normalized 0-100)
        total_risk_factor = sum(contributors.values())
        score = int(min(100, max(5, total_risk_factor * 100)))

        # Assign risk category
        if len(missing_evidence) >= 4:
            level = RiskLevel.UNKNOWN
        elif score >= 75:
            level = RiskLevel.CRITICAL
        elif score >= 50:
            level = RiskLevel.HIGH
        elif score >= 25:
            level = RiskLevel.MEDIUM
        else:
            level = RiskLevel.LOW

        # 5. Synthesize SAGE Tactical Guidance
        guidance = self._plan_tactical_guidance(
            level=level,
            score=score,
            primary_hazards=primary_hazards,
            person_candidates=person_candidates,
            sensors=sensors,
            missing_evidence=missing_evidence,
            uncertainty=uncertainty,
            timestamp=timestamp
        )

        return RiskAssessment(
            overall_score=score,
            risk_level=level,
            contributors=contributors,
            primary_hazards=primary_hazards,
            missing_evidence=missing_evidence,
            uncertainty=round(uncertainty, 3),
            recommendation=f"[{guidance.action.value}] {guidance.summary}: {guidance.reason}",
            sage_guidance=guidance
        )

    def _plan_tactical_guidance(
        self,
        level: RiskLevel,
        score: int,
        primary_hazards: List[str],
        person_candidates: List[AIDetection],
        sensors: SensorReadings,
        missing_evidence: List[str],
        uncertainty: float,
        timestamp: str
    ) -> SAGERecommendation:
        """Determines actionable tactical next-step ensuring operator oversight and safety."""

        # Priority 1: STOP if critical hazard present or imminent collision / gas flare
        if level in [RiskLevel.CRITICAL] or (sensors.distance_cm < 12.0 and sensors.sensor_validity.get("distance", True)):
            hazards_str = "; ".join(primary_hazards[:2]) if primary_hazards else "Multiple hazardous conditions"
            return SAGERecommendation(
                action=GuidanceAction.STOP,
                summary="Halt All Robot Locomotion",
                reason=f"Critical safety conditions active ({hazards_str}). Immediate operator intervention required.",
                evidence_references=primary_hazards[:3],
                timestamp=timestamp,
                confidence=0.96,
                uncertainty=uncertainty,
                requires_operator_approval=True,
                proposed_observation="Engage motor brake. Maintain camera watch while evaluating egress path.",
                source_provenance="SAGE_RULE_ENGINE"
            )

        # Priority 2: SLOW_DOWN if obstacle or tilt moderate
        if sensors.distance_cm < 25.0 or level == RiskLevel.HIGH:
            return SAGERecommendation(
                action=GuidanceAction.SLOW_DOWN,
                summary="Reduce Speed & Exercise Caution",
                reason=f"Forward obstacle clearance constrained ({sensors.distance_cm} cm) or elevated risk ({score}/100).",
                evidence_references=[f"Clearance: {sensors.distance_cm} cm", f"Risk score: {score}"],
                timestamp=timestamp,
                confidence=0.88,
                uncertainty=uncertainty,
                requires_operator_approval=True,
                proposed_observation="Reduce drive throttle to 15-20%. Verify forward clearance with short pan.",
                source_provenance="SAGE_RULE_ENGINE"
            )

        # Priority 3: INVESTIGATE candidate person without autonomous advance
        if person_candidates:
            best_person = max(person_candidates, key=lambda p: p.confidence)
            return SAGERecommendation(
                action=GuidanceAction.INVESTIGATE,
                summary="Inspect Possible Person Candidate",
                reason=f"Candidate human signature identified with {int(best_person.confidence * 100)}% confidence. Survivor status unverified.",
                evidence_references=[
                    f"Detection ID: {best_person.detection_id}",
                    f"Confidence: {best_person.confidence}",
                    f"Bounding box: {best_person.bounding_box}"
                ],
                timestamp=timestamp,
                confidence=best_person.confidence,
                uncertainty=uncertainty,
                requires_operator_approval=True,
                proposed_observation="Pan camera gimbal +15° right or tilt up to acquire unobstructed line of sight. DO NOT drive forward autonomously.",
                source_provenance="SAGE_RULE_ENGINE"
            )

        # Priority 4: OBSERVE if missing evidence or low confidence
        if missing_evidence:
            return SAGERecommendation(
                action=GuidanceAction.OBSERVE,
                summary="Observe & Verify Sensor Telemetry",
                reason=f"Incomplete sensor telemetry ({len(missing_evidence)} unverified channels). Hold position and monitor diagnostics.",
                evidence_references=missing_evidence,
                timestamp=timestamp,
                confidence=0.75,
                uncertainty=uncertainty,
                requires_operator_approval=True,
                proposed_observation="Perform sensor bus diagnostic check before proceeding with recon sweep.",
                source_provenance="SAGE_RULE_ENGINE"
            )

        # Baseline: Normal Recon
        return SAGERecommendation(
            action=GuidanceAction.OBSERVE,
            summary="Nominal Reconnaissance Standby",
            reason="All sensor streams nominal. Robot ready for operator navigational commands.",
            evidence_references=[f"Temp: {sensors.temperature_c}°C", f"Gas: {sensors.gas_mq2_raw}", f"Clearance: {sensors.distance_cm}cm"],
            timestamp=timestamp,
            confidence=0.92,
            uncertainty=uncertainty,
            requires_operator_approval=True,
            proposed_observation="Maintain scheduled sector scan and waypoint perimeter check.",
            source_provenance="SAGE_RULE_ENGINE"
        )
