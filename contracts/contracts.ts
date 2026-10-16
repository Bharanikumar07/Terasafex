/**
 * Shared TypeScript Contracts for TERRA-SAFE X
 * Mirrors contracts/schemas.py (Version 1.1.0)
 */

export type RobotMode = 'MANUAL' | 'AUTONOMOUS' | 'EMERGENCY_STOP' | 'SIMULATION';
export type ConnectionState = 'CONNECTED' | 'DISCONNECTED' | 'SIMULATED' | 'DEGRADED';
export type AlertLevel = 'INFO' | 'WARNING' | 'CRITICAL';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNKNOWN';
export type GuidanceAction = 'INVESTIGATE' | 'OBSERVE' | 'SLOW_DOWN' | 'STOP' | 'DATA_UNAVAILABLE';
export type CommandExecutionState = 'RECEIVED' | 'ACCEPTED' | 'SIMULATED_EXECUTION' | 'COMPLETED' | 'REJECTED' | 'FAILED';

export interface SensorReadings {
  temperature_c: number;
  humidity_pct: number;
  distance_cm: number;
  gas_mq2_raw: number;
  flame_detected: boolean;
  motion_pir: boolean;
  imu_roll_deg: number;
  imu_pitch_deg: number;
  imu_yaw_deg: number;
  battery_pct: number;
  battery_volts: number;
  wifi_rssi_dbm: number;
  lora_rssi_dbm?: number | null;
  sensor_validity?: Record<string, boolean>;
}

export interface AIDetection {
  detection_id: string;
  label: string;
  confidence: number;
  bounding_box: [number, number, number, number]; // [x_min, y_min, x_max, y_max]
  evidence_frames: number;
  status: 'UNVERIFIED' | 'CONFIRMED' | 'REPEATED';
  timestamp: string;
  source_provenance?: 'SAMPLE_IMAGE' | 'SIMULATION' | 'HARDWARE';
  thumbnail_url?: string;
}

export interface SAGERecommendation {
  action: GuidanceAction;
  summary: string;
  reason: string;
  evidence_references: string[];
  timestamp: string;
  confidence: number;
  uncertainty: number;
  requires_operator_approval: boolean;
  proposed_observation?: string | null;
  source_provenance: string;
}

export interface RiskAssessment {
  overall_score: number;
  risk_level: RiskLevel;
  contributors: Record<string, number>;
  primary_hazards: string[];
  missing_evidence?: string[];
  uncertainty?: number;
  recommendation: string;
  sage_guidance?: SAGERecommendation | null;
}

export interface RobotTelemetry {
  timestamp: string;
  sequence_number: number;
  robot_id: string;
  is_simulation: boolean;
  source_provenance: 'SIMULATION' | 'SAMPLE_IMAGE' | 'HARDWARE';
  robot_ip: string;
  cam_ip: string;
  mode: RobotMode;
  connection: ConnectionState;
  data_freshness_ms: number;
  sensors: SensorReadings;
  recent_detections: AIDetection[];
  risk_assessment: RiskAssessment;
  motor_safety_locked: boolean;
  position: {
    x: number;
    y: number;
    heading_deg: number;
  };
}

export interface MotorCommand {
  command_id?: string;
  command: 'FORWARD' | 'BACKWARD' | 'LEFT' | 'RIGHT' | 'STOP' | 'PAN_LEFT' | 'PAN_RIGHT' | 'TILT_UP' | 'TILT_DOWN' | 'MISSION_START' | 'MISSION_PAUSE';
  speed_pct?: number;
  override_safety?: boolean;
  timestamp?: string;
}

export interface CommandAcknowledgement {
  command_id: string;
  command: string;
  status: CommandExecutionState;
  accepted: boolean;
  reason: string;
  timestamp: string;
  speed_pct: number;
  override_active: boolean;
  is_simulation: boolean;
}

export interface MissionEvent {
  event_id: string;
  timestamp: string;
  level: AlertLevel;
  category: 'AI_DETECTION' | 'SENSOR_ALERT' | 'NAVIGATION' | 'SYSTEM' | 'SAGE_TACTICAL';
  title: string;
  detail: string;
  source_provenance?: 'SIMULATION' | 'SAMPLE_IMAGE' | 'HARDWARE';
  acknowledged?: boolean;
}

export interface SimulationScenarioConfig {
  scenario_name: string;
  fault_active: boolean;
  custom_params?: Record<string, any>;
}

export interface SystemHealth {
  status: string;
  version: string;
  is_simulation: boolean;
  active_connections: number;
  services: Record<string, string>;
}
