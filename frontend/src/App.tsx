import { useState, useEffect, useRef } from 'react';
import { 
  ShieldAlert, 
  Wifi, 
  Camera, 
  Battery, 
  Compass, 
  Eye, 
  Activity, 
  Play, 
  Square, 
  ChevronUp, 
  ChevronDown, 
  ChevronLeft, 
  ChevronRight, 
  Lock, 
  Unlock, 
  AlertTriangle, 
  Cpu, 
  Radio, 
  Layers, 
  Clock, 
  CheckCircle2, 
  FileText,
  Pause,
  RefreshCw,
  Terminal,
  Zap
} from 'lucide-react';
import type { 
  RobotTelemetry, 
  MissionEvent, 
  SystemHealth,
  CommandAcknowledgement,
  GuidanceAction
} from './types/contracts';

const initialTelemetry: RobotTelemetry = {
  timestamp: new Date().toLocaleTimeString(),
  sequence_number: 1,
  robot_id: "TERRA-01",
  is_simulation: true,
  source_provenance: "SIMULATION",
  robot_ip: "192.168.1.45 (Simulated)",
  cam_ip: "192.168.1.46 (Simulated)",
  mode: "SIMULATION",
  connection: "SIMULATED",
  data_freshness_ms: 12,
  motor_safety_locked: true,
  position: { x: 4.8, y: 3.2, heading_deg: 182.5 },
  sensors: {
    temperature_c: 34.2,
    humidity_pct: 58.0,
    distance_cm: 42.5,
    gas_mq2_raw: 280,
    flame_detected: false,
    motion_pir: true,
    imu_roll_deg: 2.1,
    imu_pitch_deg: -1.2,
    imu_yaw_deg: 182.5,
    battery_pct: 78,
    battery_volts: 11.8,
    wifi_rssi_dbm: -56,
    lora_rssi_dbm: -72,
    sensor_validity: {
      temperature: true,
      humidity: true,
      distance: true,
      gas: true,
      flame: true,
      motion: true,
      imu: true,
      battery: true
    }
  },
  recent_detections: [
    {
      detection_id: "sim-det-01",
      label: "Person",
      confidence: 0.84,
      bounding_box: [0.32, 0.28, 0.54, 0.78],
      evidence_frames: 8,
      status: "REPEATED",
      timestamp: "10:14:22",
      source_provenance: "SIMULATION"
    }
  ],
  risk_assessment: {
    overall_score: 38,
    risk_level: "MEDIUM",
    contributors: {
      "Toxic Gas & Smoke (MQ-2)": 0.05,
      "Thermal & Combustion": 0.04,
      "Obstacle Proximity (Ultrasonic)": 0.03,
      "Terrain Tilt (IMU)": 0.03,
      "Human Presence / Survivor Search": 0.126
    },
    primary_hazards: ["Candidate person identified (unverified trapped status)"],
    missing_evidence: [],
    uncertainty: 0.05,
    recommendation: "[INVESTIGATE] Inspect Possible Person Candidate: Candidate human signature identified with 84% confidence. Survivor status unverified.",
    sage_guidance: {
      action: "INVESTIGATE" as GuidanceAction,
      summary: "Inspect Possible Person Candidate",
      reason: "Candidate human signature identified with 84% confidence. Survivor status unverified.",
      evidence_references: ["Detection ID: sim-det-01", "Confidence: 0.84", "Bounding box: [0.32, 0.28, 0.54, 0.78]"],
      timestamp: "10:14:22",
      confidence: 0.84,
      uncertainty: 0.05,
      requires_operator_approval: true,
      proposed_observation: "Pan camera gimbal +15° right to acquire unobstructed line of sight. DO NOT drive forward autonomously.",
      source_provenance: "SAGE_RULE_ENGINE"
    }
  }
};

const initialEvents: MissionEvent[] = [
  {
    event_id: "evt-01",
    timestamp: "10:14:22",
    level: "WARNING",
    category: "AI_DETECTION",
    title: "Possible Person Identified",
    detail: "Candidate survivor trapped near rubble sector B (Confidence 84%). Provenance: SIMULATION.",
    source_provenance: "SIMULATION"
  },
  {
    event_id: "evt-02",
    timestamp: "10:14:20",
    level: "INFO",
    category: "SAGE_TACTICAL",
    title: "SAGE Guidance Generated",
    detail: "Action INVESTIGATE proposed. Operator approval required.",
    source_provenance: "SIMULATION"
  },
  {
    event_id: "evt-03",
    timestamp: "10:12:30",
    level: "INFO",
    category: "SYSTEM",
    title: "Recon Session Initialized",
    detail: "Deterministic physics & environmental simulator connected. Physical motors safe locked.",
    source_provenance: "SIMULATION"
  }
];

// Base URLs: support environment variables or relative paths in production / Vercel rewrites, with fallback for local dev
const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || "";
const WS_BASE = (import.meta as any).env?.VITE_WS_BASE_URL || (
  typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`
    : "ws://localhost:8000"
);

export function App() {
  const [telemetry, setTelemetry] = useState<RobotTelemetry>(initialTelemetry);
  const [events, setEvents] = useState<MissionEvent[]>(initialEvents);
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'evidence' | 'simulator' | 'contracts'>('dashboard');
  const [safetyLocked, setSafetyLocked] = useState<boolean>(true);
  const [simActive, setSimActive] = useState<boolean>(true);
  const [selectedSpeed, setSelectedSpeed] = useState<number>(30);
  const [wsStatus, setWsStatus] = useState<'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING'>('RECONNECTING');
  const [lastActionStatus, setLastActionStatus] = useState<string>("System ready. Bidirectional communication active.");
  const [commandLog, setCommandLog] = useState<CommandAcknowledgement[]>([]);
  const [activeScenario, setActiveScenario] = useState<string>("NORMAL");
  const [lastMessageTimestamp, setLastMessageTimestamp] = useState<string>(new Date().toLocaleTimeString());

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);

  // Bidirectional WebSocket Connection with Reconnect & Heartbeat Monitoring
  useEffect(() => {
    let isMounted = true;

    const connectWebSocket = () => {
      try {
        const wsUrl = WS_BASE.startsWith("ws://") || WS_BASE.startsWith("wss://")
          ? `${WS_BASE}/ws/telemetry`
          : `ws://${WS_BASE}/ws/telemetry`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!isMounted) return;
          setWsStatus("CONNECTED");
          setLastActionStatus("Bidirectional WebSocket stream active. Telemetry broadcast at 2Hz.");
        };

        ws.onmessage = (event) => {
          if (!isMounted) return;
          try {
            const data = JSON.parse(event.data);
            setLastMessageTimestamp(new Date().toLocaleTimeString());

            if (data.type === "COMMAND_ACK" && data.acknowledgement) {
              const ack = data.acknowledgement as CommandAcknowledgement;
              setCommandLog(prev => [ack, ...prev.slice(0, 19)]);
              setLastActionStatus(`[ACK] Command ${ack.command} status: ${ack.status}. ${ack.reason}`);
              if (!ack.accepted || ack.status === "REJECTED" || ack.status === "FAILED") {
                setEvents(prev => [
                  {
                    event_id: `evt-${Date.now()}`,
                    timestamp: new Date().toLocaleTimeString(),
                    level: "CRITICAL",
                    category: "SYSTEM",
                    title: `Command ${ack.command} ${ack.status}`,
                    detail: ack.reason,
                    source_provenance: "SIMULATION"
                  },
                  ...prev.slice(0, 24)
                ]);
              }
            } else if (data.sensors && data.risk_assessment) {
              setTelemetry(data);
              if (data.risk_assessment.overall_level === "CRITICAL") {
                setEvents(prev => {
                  const lastEvt = prev[0];
                  const newTitle = `Elevated Risk: ${data.risk_assessment.primary_threat}`;
                  if (lastEvt && lastEvt.title === newTitle && (Date.now() - parseInt(lastEvt.event_id.replace('evt-', '') || '0')) < 5000) {
                    return prev;
                  }
                  return [
                    {
                      event_id: `evt-${Date.now()}`,
                      timestamp: new Date().toLocaleTimeString(),
                      level: "CRITICAL",
                      category: "SENSOR_ALERT",
                      title: newTitle,
                      detail: data.risk_assessment.recommendation || "Hazard condition requires operator caution.",
                      source_provenance: "SIMULATION"
                    },
                    ...prev.slice(0, 24)
                  ];
                });
              }
            }
          } catch (err) {
            console.error("Telemetry parse error:", err);
          }
        };

        ws.onerror = () => {
          if (!isMounted) return;
          setWsStatus("RECONNECTING");
        };

        ws.onclose = () => {
          if (!isMounted) return;
          setWsStatus("DISCONNECTED");
          // Reconnect with backoff
          reconnectTimeoutRef.current = setTimeout(() => {
            if (isMounted) connectWebSocket();
          }, 2500);
        };
      } catch {
        if (isMounted) setWsStatus("DISCONNECTED");
      }
    };

    connectWebSocket();

    // Fetch initial health from backend
    fetch(`${API_BASE}/api/health`)
      .then(res => res.json())
      .then(data => setSystemHealth(data))
      .catch(() => {});

    // Periodic health poll
    const healthInterval = setInterval(() => {
      fetch(`${API_BASE}/api/health`)
        .then(res => res.json())
        .then(data => setSystemHealth(data))
        .catch(() => setSystemHealth(null));
    }, 5000);

    return () => {
      isMounted = false;
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      clearInterval(healthInterval);
    };
  }, []);

  // Bidirectional Command Dispatch over WebSocket (with REST fallback)
  const sendMotorCommand = async (cmd: string) => {
    if (safetyLocked && !telemetry.is_simulation) {
      alert("Safety Interlock Active: Physical motor outputs are locked. Unlock safety first or operate in Simulation mode.");
      return;
    }

    const commandId = `cmd-${Date.now()}`;
    const payload = {
      command_id: commandId,
      command: cmd,
      speed_pct: selectedSpeed,
      override_safety: !safetyLocked,
      timestamp: new Date().toLocaleTimeString()
    };

    // If WebSocket is open, send through bidirectional channel
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
      setLastActionStatus(`Dispatched command [${cmd}] via WebSocket channel...`);
    } else {
      // Fallback to REST
      try {
        const res = await fetch(`${API_BASE}/api/command`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const ack: CommandAcknowledgement = await res.json();
        setCommandLog(prev => [ack, ...prev.slice(0, 19)]);
        setLastActionStatus(`[REST ACK] Command ${ack.command} status: ${ack.status}. ${ack.reason}`);
      } catch {
        setLastActionStatus(`Failed to dispatch command [${cmd}]. Backend unreachable.`);
      }
    }
  };

  const handleEStop = async () => {
    setSafetyLocked(true);
    setLastActionStatus("EMERGENCY STOP TRIGGERED. All motion halted and actuators inhibited.");
    try {
      await fetch(`${API_BASE}/api/estop`, { method: "POST" });
    } catch {}
  };

  const triggerScenario = async (scenario: string, endpoint?: string) => {
    setActiveScenario(scenario);
    setLastActionStatus(`Injecting simulation scenario: ${scenario}...`);
    try {
      if (endpoint) {
        await fetch(`${API_BASE}${endpoint}`, { method: "POST" });
      } else {
        await fetch(`${API_BASE}/api/simulator/scenario`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scenario_name: scenario, fault_active: scenario !== "NORMAL" })
        });
      }
    } catch {
      setLastActionStatus(`Scenario ${scenario} updated locally.`);
    }
  };

  const resetSimulator = async () => {
    setActiveScenario("NORMAL");
    setLastActionStatus("Resetting simulator to nominal baseline parameters...");
    try {
      await fetch(`${API_BASE}/api/simulator/reset`, { method: "POST" });
    } catch {}
  };

  const getRiskColor = (score: number, level: string) => {
    if (level === 'UNKNOWN') return { border: '#64748b', text: '#334155', bg: '#f1f5f9' };
    if (score >= 70 || level === 'CRITICAL') return { border: '#b91c1c', text: '#991b1b', bg: '#fee2e2' };
    if (score >= 40 || level === 'HIGH') return { border: '#d97706', text: '#b45309', bg: '#fef3c7' };
    return { border: '#15803d', text: '#166534', bg: '#dcfce7' };
  };

  const riskPalette = getRiskColor(telemetry.risk_assessment.overall_score, telemetry.risk_assessment.risk_level);
  const guidance = telemetry.risk_assessment.sage_guidance;

  return (
    <div className="app-layout">
      {/* Simulation Banner Notice */}
      <div className="simulation-banner">
        <div>
          <strong>SOFTWARE SIMULATION MODE:</strong> Operating with deterministic synthetic sensors & verified YOLOv8-Nano sample inference. Physical motors locked.
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}>WS: {wsStatus}</span>
          <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}>SEQ: #{telemetry.sequence_number}</span>
          {systemHealth && (
            <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: '#166534' }}>
              • SAGE: {systemHealth.services.sage_engine}
            </span>
          )}
        </div>
      </div>

      {/* Main Mission Header */}
      <header className="top-header">
        <div className="brand-section">
          <div className="brand-emblem">TX</div>
          <div>
            <h1 className="brand-title">TERRA-SAFE X</h1>
            <p className="brand-subtitle">Reconnaissance & Disaster Assessment System</p>
          </div>
        </div>

        <div className="header-status-strip">
          <div className={`status-pill ${telemetry.is_simulation ? 'sim' : 'live'}`}>
            <Radio size={14} />
            <span>ROBOT: {telemetry.robot_id} [MOCK]</span>
          </div>

          <div className="status-pill">
            <Wifi size={14} />
            <span>WIFI: {telemetry.sensors.wifi_rssi_dbm} dBm</span>
          </div>

          <div className="status-pill">
            <Battery size={14} />
            <span>BATT: {telemetry.sensors.battery_pct}% ({telemetry.sensors.battery_volts}V)</span>
          </div>

          <div className="status-pill">
            <Clock size={14} />
            <span>LAST RX: {lastMessageTimestamp}</span>
          </div>

          <button className="btn-estop" onClick={handleEStop} title="Immediate Motor Inhibitor">
            <AlertTriangle size={16} />
            Emergency Stop
          </button>
        </div>
      </header>

      {/* Secondary Operational Navigation Bar */}
      <nav className="nav-subbar">
        <div className="nav-tabs">
          <button 
            className={`nav-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            Mission Dashboard
          </button>
          <button 
            className={`nav-btn ${activeTab === 'evidence' ? 'active' : ''}`}
            onClick={() => setActiveTab('evidence')}
          >
            AI Evidence & Detections
          </button>
          <button 
            className={`nav-btn ${activeTab === 'simulator' ? 'active' : ''}`}
            onClick={() => setActiveTab('simulator')}
          >
            Simulation Lab ({activeScenario})
          </button>
          <button 
            className={`nav-btn ${activeTab === 'contracts' ? 'active' : ''}`}
            onClick={() => setActiveTab('contracts')}
          >
            Contracts & Diagnostics ({commandLog.length} Acks)
          </button>
        </div>

        <div className="sim-toggle-group">
          <span>Simulation Engine:</span>
          <button 
            className="btn-ctrl" 
            style={{ fontSize: '11px', padding: '4px 10px' }}
            onClick={async () => {
              if (simActive) {
                await fetch(`${API_BASE}/api/simulator/pause`, { method: "POST" });
                setSimActive(false);
                setLastActionStatus("Simulation cycle paused.");
              } else {
                await fetch(`${API_BASE}/api/simulator/resume`, { method: "POST" });
                setSimActive(true);
                setLastActionStatus("Simulation cycle resumed.");
              }
            }}
          >
            {simActive ? <Pause size={13} /> : <Play size={13} />}
            {simActive ? "Pause Sim Loop" : "Resume Sim"}
          </button>
        </div>
      </nav>

      {/* Status Bar */}
      <div style={{ background: '#f5f0e6', borderBottom: '1px solid var(--border-subtle)', padding: '5px 24px', fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
        SYS_LOG: {lastActionStatus}
      </div>

      {/* Tab 1: Primary Mission Dashboard */}
      {activeTab === 'dashboard' && (
        <main className="dashboard-grid">
          {/* Column 1: Video Viewport + Teleoperation Pad */}
          <section className="grid-col">
            <div className="mission-card">
              <div className="card-header">
                <h3><Camera size={16} /> ESP32-CAM Recon Feed</h3>
                <span className="badge-tag">SOURCE: SIMULATION (QVGA 320x240)</span>
              </div>
              <div className="card-body">
                <div className="cam-viewport">
                  {/* Styled editorial canvas representing disaster rubble */}
                  <svg width="100%" height="280" style={{ background: '#232529' }} xmlns="http://www.w3.org/2000/svg">
                    <rect width="100%" height="100%" fill="#1a1c20" />
                    {/* Rubble contours */}
                    <path d="M 0 240 Q 80 180 180 220 T 360 210 T 540 240 L 540 280 L 0 280 Z" fill="#2d3035" />
                    <path d="M 120 230 Q 220 150 320 200 T 480 190 L 540 280 L 120 280 Z" fill="#3b3f46" />
                    {/* Person silhouette */}
                    <circle cx="210" cy="150" r="16" fill="#e2e8f0" opacity="0.85" />
                    <path d="M 195 170 L 225 170 L 230 230 L 190 230 Z" fill="#94a3b8" opacity="0.85" />
                    {/* Flame representation */}
                    {telemetry.sensors.flame_detected && (
                      <path d="M 380 210 Q 395 160 405 190 Q 420 150 430 210 Z" fill="#ea580c" opacity="0.9" />
                    )}
                  </svg>

                  {/* Dynamic Bounding Box: Person */}
                  {telemetry.recent_detections.some(d => d.label.toLowerCase() === 'person') && (
                    <div 
                      className="cam-bounding-box person" 
                      style={{ left: '33%', top: '35%', width: '18%', height: '46%' }}
                    >
                      <span className="box-label">Possible Person (84%)</span>
                    </div>
                  )}

                  {/* Dynamic Bounding Box: Flame */}
                  {telemetry.sensors.flame_detected && (
                    <div 
                      className="cam-bounding-box fire" 
                      style={{ left: '67%', top: '48%', width: '16%', height: '28%' }}
                    >
                      <span className="box-label">Fire (88%)</span>
                    </div>
                  )}

                  <div className="cam-overlay-badge">
                    <span>12 FPS</span>
                    <span>•</span>
                    <span>MOCK STREAM</span>
                    <span>•</span>
                    <span>PROVENANCE: SIMULATION</span>
                  </div>
                </div>

                <div className="cam-controls">
                  <button className="btn-ctrl" onClick={() => sendMotorCommand("PAN_LEFT")}>Pan Left (-15°)</button>
                  <button className="btn-ctrl" onClick={() => sendMotorCommand("PAN_RIGHT")}>Pan Right (+15°)</button>
                  <button className="btn-ctrl" onClick={() => sendMotorCommand("TILT_UP")}>Tilt Up (+10°)</button>
                  <button className="btn-ctrl" onClick={() => sendMotorCommand("TILT_DOWN")}>Tilt Down (-10°)</button>
                </div>
              </div>
            </div>

            {/* Manual Controls Card */}
            <div className="mission-card">
              <div className="card-header">
                <h3><Layers size={16} /> Teleoperation & Interlock</h3>
                <span className="badge-tag">{safetyLocked ? "HARDWARE INHIBITED" : "MOTORS ARMED"}</span>
              </div>
              <div className="card-body">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button 
                      className="btn-ctrl" 
                      onClick={() => setSafetyLocked(!safetyLocked)}
                      style={{ color: safetyLocked ? 'var(--accent-crimson)' : 'var(--accent-emerald)' }}
                    >
                      {safetyLocked ? <Lock size={14} /> : <Unlock size={14} />}
                      {safetyLocked ? "Motor Safety: LOCKED" : "Motor Safety: UNLOCKED"}
                    </button>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                    <span>Throttle:</span>
                    <input 
                      type="range" 
                      min="10" 
                      max="100" 
                      value={selectedSpeed} 
                      onChange={(e) => setSelectedSpeed(Number(e.target.value))}
                      style={{ width: '90px' }}
                    />
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{selectedSpeed}%</span>
                  </div>
                </div>

                {/* D-Pad Directional Controller */}
                <div className="teleop-pad">
                  <div></div>
                  <button className="pad-btn" onClick={() => sendMotorCommand("FORWARD")} title="Forward"><ChevronUp size={20} /></button>
                  <div></div>

                  <button className="pad-btn" onClick={() => sendMotorCommand("LEFT")} title="Turn Left"><ChevronLeft size={20} /></button>
                  <button className="pad-btn" onClick={() => sendMotorCommand("STOP")} title="Stop" style={{ color: 'var(--accent-crimson)' }}><Square size={16} /></button>
                  <button className="pad-btn" onClick={() => sendMotorCommand("RIGHT")} title="Turn Right"><ChevronRight size={20} /></button>

                  <div></div>
                  <button className="pad-btn" onClick={() => sendMotorCommand("BACKWARD")} title="Backward"><ChevronDown size={20} /></button>
                  <div></div>
                </div>

                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center', marginTop: '6px' }}>
                  Commands dispatch over WebSocket & REST. Physical actuators remain disabled by default.
                </div>
              </div>
            </div>
          </section>

          {/* Column 2: Sensor Telemetry & Navigation Vector */}
          <section className="grid-col">
            <div className="mission-card">
              <div className="card-header">
                <h3><Activity size={16} /> Environmental Telemetry</h3>
                <span className="badge-tag">DATA AGE: {telemetry.data_freshness_ms}ms</span>
              </div>
              <div className="card-body">
                <div className="sensor-grid">
                  <div className="metric-cell">
                    <span className="metric-label">Ambient Temp</span>
                    <span className="metric-value">{telemetry.sensors.temperature_c} °C</span>
                    <span className="metric-sub" style={{ color: telemetry.sensors.temperature_c > 45 ? '#b91c1c' : '#15803d' }}>
                      {telemetry.sensors.sensor_validity?.temperature === false ? 'INVALID' : telemetry.sensors.temperature_c > 45 ? 'Elevated Heat' : 'Normal Range'}
                    </span>
                  </div>

                  <div className="metric-cell">
                    <span className="metric-label">Relative Humidity</span>
                    <span className="metric-value">{telemetry.sensors.humidity_pct} %</span>
                    <span className="metric-sub">BME280 / DHT</span>
                  </div>

                  <div className="metric-cell">
                    <span className="metric-label">Proximity Range</span>
                    <span className="metric-value">{telemetry.sensors.distance_cm} cm</span>
                    <span className="metric-sub" style={{ color: telemetry.sensors.distance_cm < 15 ? '#b91c1c' : '#15803d' }}>
                      {telemetry.sensors.sensor_validity?.distance === false ? 'INVALID' : telemetry.sensors.distance_cm < 15 ? 'CRITICAL CLEARANCE' : 'Clear Path'}
                    </span>
                  </div>

                  <div className="metric-cell">
                    <span className="metric-label">MQ-2 Gas Index</span>
                    <span className="metric-value">{telemetry.sensors.gas_mq2_raw}</span>
                    <span className="metric-sub" style={{ color: telemetry.sensors.gas_mq2_raw > 400 ? '#b91c1c' : '#b45309' }}>
                      {telemetry.sensors.sensor_validity?.gas === false ? 'INVALID' : telemetry.sensors.gas_mq2_raw > 400 ? 'Toxic Alert' : 'Nominal'}
                    </span>
                  </div>

                  <div className="metric-cell">
                    <span className="metric-label">Optical Flame</span>
                    <span className="metric-value" style={{ color: telemetry.sensors.flame_detected ? '#b91c1c' : '#15803d' }}>
                      {telemetry.sensors.flame_detected ? 'DETECTED' : 'CLEAR'}
                    </span>
                    <span className="metric-sub">IR Flame Sensor</span>
                  </div>

                  <div className="metric-cell">
                    <span className="metric-label">PIR Movement</span>
                    <span className="metric-value" style={{ color: telemetry.sensors.motion_pir ? '#2563eb' : '#64748b' }}>
                      {telemetry.sensors.motion_pir ? 'MOTION' : 'STILL'}
                    </span>
                    <span className="metric-sub">Passive Infrared</span>
                  </div>
                </div>

                <div style={{ marginTop: '14px', borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
                    <span>Roll: {telemetry.sensors.imu_roll_deg}°</span>
                    <span>Pitch: {telemetry.sensors.imu_pitch_deg}°</span>
                    <span>Yaw: {telemetry.sensors.imu_yaw_deg}°</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Navigation Grid & Position */}
            <div className="mission-card">
              <div className="card-header">
                <h3><Compass size={16} /> Hazard Grid & Spatial Pose</h3>
                <span className="badge-tag">DEAD RECKONING [SIM]</span>
              </div>
              <div className="card-body">
                <div style={{ background: '#f5f2eb', border: '1px solid var(--border-strong)', height: '170px', position: 'relative', borderRadius: '4px', overflow: 'hidden' }}>
                  <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                      <pattern id="smallGrid" width="20" height="20" patternUnits="userSpaceOnUse">
                        <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#ded8cb" strokeWidth="1"/>
                      </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#smallGrid)" />
                    {/* Obstacle sector */}
                    <rect x="70" y="30" width="50" height="50" fill="#fecaca" stroke="#f87171" strokeWidth="1" opacity="0.6"/>
                    <text x="75" y="58" fontSize="10" fontFamily="var(--font-mono)" fill="#991b1b">Obstacle</text>
                    {/* Planned path line */}
                    <path d="M 30 140 Q 120 120 180 80 T 260 40" fill="none" stroke="#2563eb" strokeWidth="2" strokeDasharray="4" />
                    {/* Robot marker */}
                    <circle cx={Math.min(260, Math.max(30, telemetry.position.x * 25))} cy={Math.min(140, Math.max(30, telemetry.position.y * 25))} r="8" fill="#1b365d" stroke="#ffffff" strokeWidth="2" />
                  </svg>
                  <div style={{ position: 'absolute', bottom: '8px', left: '10px', fontSize: '11px', fontFamily: 'var(--font-mono)', background: 'rgba(255,255,255,0.85)', padding: '2px 6px', borderRadius: '2px' }}>
                    X: {telemetry.position.x.toFixed(1)}m | Y: {telemetry.position.y.toFixed(1)}m | HEADING: {telemetry.position.heading_deg.toFixed(1)}°
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Column 3: Explainable Risk & SAGE Advisor */}
          <section className="grid-col">
            <div className="mission-card">
              <div className="card-header">
                <h3><ShieldAlert size={16} /> Explainable Risk Assessment</h3>
                <span className="badge-tag">UNCERTAINTY: {Math.round((telemetry.risk_assessment.uncertainty || 0) * 100)}%</span>
              </div>
              <div className="card-body">
                <div className="risk-meter-container">
                  <div 
                    className="risk-circle" 
                    style={{ borderColor: riskPalette.border, background: riskPalette.bg, color: riskPalette.text }}
                  >
                    <span className="risk-score-num">{telemetry.risk_assessment.overall_score}</span>
                    <span className="risk-score-lvl">{telemetry.risk_assessment.risk_level}</span>
                  </div>

                  <div className="risk-bars-list">
                    {Object.entries(telemetry.risk_assessment.contributors).map(([label, weight]) => (
                      <div key={label} className="risk-bar-row">
                        <span className="risk-bar-label">{label}</span>
                        <div className="risk-progress-track">
                          <div 
                            className="risk-progress-fill" 
                            style={{ 
                              width: `${Math.round(weight * 100)}%`, 
                              backgroundColor: weight > 0.3 ? '#b91c1c' : weight > 0.18 ? '#d97706' : '#2563eb' 
                            }} 
                          />
                        </div>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{Math.round(weight * 100)}%</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* SAGE Guidance Callout */}
                <div className="sage-callout" style={{ marginTop: '14px' }}>
                  <div className="sage-callout-title">
                    <CheckCircle2 size={15} /> SAGE Tactical Guidance [{guidance?.action || 'OBSERVE'}]:
                  </div>
                  <p style={{ fontWeight: 600 }}>{guidance?.summary || telemetry.risk_assessment.recommendation}</p>
                  <p style={{ fontSize: '12px', marginTop: '4px', color: '#475569' }}>{guidance?.reason}</p>
                  {guidance?.proposed_observation && (
                    <div style={{ marginTop: '8px', padding: '6px 8px', background: 'rgba(255,255,255,0.7)', borderRadius: '3px', fontSize: '11px', borderLeft: '2px solid var(--accent-terracotta)' }}>
                      <strong>Proposed Plan:</strong> {guidance.proposed_observation}
                      <div style={{ marginTop: '4px', display: 'flex', gap: '6px' }}>
                        <button 
                          className="btn-ctrl" 
                          style={{ fontSize: '10px', padding: '2px 8px' }}
                          onClick={() => setLastActionStatus("Operator approved tactical guidance recommendation.")}
                        >
                          Approve Action
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Event Timeline */}
            <div className="mission-card">
              <div className="card-header">
                <h3><FileText size={16} /> Mission Event Timeline</h3>
                <span className="badge-tag">{events.length} EVENTS</span>
              </div>
              <div className="card-body" style={{ padding: '0px' }}>
                <table className="events-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Level</th>
                      <th>Category</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((evt) => (
                      <tr key={evt.event_id}>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{evt.timestamp}</td>
                        <td>
                          <span className={`level-tag ${evt.level}`}>{evt.level}</span>
                        </td>
                        <td style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{evt.category}</td>
                        <td>
                          <strong>{evt.title}:</strong> {evt.detail}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </main>
      )}

      {/* Tab 2: AI Evidence & Model Intelligence */}
      {activeTab === 'evidence' && (
        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="mission-card">
            <div className="card-header">
              <h3><Eye size={18} /> TERA X Intelligence: YOLOv8-Nano Model</h3>
              <span className="badge-model-active"><CheckCircle2 size={13} /> MODEL: BEST.PT ACTIVE</span>
            </div>
            <div className="card-body">
              <p style={{ color: 'var(--text-muted)', marginBottom: '14px' }}>
                The AI vision service runs an optimized Ultralytics YOLOv8-Nano neural network fine-tuned on disaster reconnaissance scenes. Offloaded to thread pool to preserve WebSocket 2Hz streaming.
              </p>

              <div className="ai-metric-pill-row">
                <div className="ai-metric-box">
                  <div className="ai-metric-box-title">Architecture</div>
                  <div className="ai-metric-box-val" style={{ fontSize: '15px' }}>YOLOv8-Nano</div>
                </div>
                <div className="ai-metric-box">
                  <div className="ai-metric-box-title">Weights File</div>
                  <div className="ai-metric-box-val" style={{ fontSize: '14px', fontFamily: 'var(--font-mono)' }}>best.pt (6.5MB)</div>
                </div>
                <div className="ai-metric-box">
                  <div className="ai-metric-box-title">Inference Speed</div>
                  <div className="ai-metric-box-val">~48 ms</div>
                </div>
                <div className="ai-metric-box">
                  <div className="ai-metric-box-title">Target Class</div>
                  <div className="ai-metric-box-val" style={{ fontSize: '15px' }}>0: Person</div>
                </div>
                <div className="ai-metric-box">
                  <div className="ai-metric-box-title">Confidence Min</div>
                  <div className="ai-metric-box-val">0.25</div>
                </div>
              </div>

              {/* Live Real Inference Trigger */}
              <div style={{ marginTop: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button 
                  className="btn-ctrl"
                  style={{ background: 'var(--accent-navy)', color: '#fff', borderColor: '#0f1d33' }}
                  onClick={async () => {
                    setLastActionStatus("Dispatching real sample inference request to backend...");
                    try {
                      const res = await fetch(`${API_BASE}/api/ai/predict-sample`, { method: "POST" });
                      const data = await res.json();
                      if (data.detections && data.detections.length > 0) {
                        setTelemetry(prev => ({
                          ...prev,
                          recent_detections: data.detections
                        }));
                        setLastActionStatus(`Real inference successful! Detected ${data.detections_count} candidate(s) in ${data.inference_latency_ms}ms.`);
                      }
                    } catch {
                      setLastActionStatus("Backend offline or unreachable for sample test.");
                    }
                  }}
                >
                  <Cpu size={15} /> Execute Real Inference Test on Sample Image
                </button>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Runs <code>best.pt</code> directly against validation frame without synthetic simulation.
                </span>
              </div>
            </div>
          </div>

          {/* Detections List */}
          <div className="mission-card">
            <div className="card-header">
              <h3><Layers size={18} /> Active Detection Evidence</h3>
              <span className="badge-tag">{telemetry.recent_detections.length} TARGETS</span>
            </div>
            <div className="card-body">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                {telemetry.recent_detections.map((det) => (
                  <div key={det.detection_id} style={{ border: '1px solid var(--border-subtle)', borderRadius: '4px', padding: '14px', background: '#fbf9f5' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h4 style={{ fontFamily: 'var(--font-serif)', fontSize: '17px', color: 'var(--text-main)' }}>
                        {det.label} (Possible Person)
                      </h4>
                      <span className={`level-tag ${det.status === 'CONFIRMED' ? 'CRITICAL' : 'WARNING'}`}>
                        {det.status}
                      </span>
                    </div>

                    <div style={{ marginTop: '10px', fontSize: '13px', fontFamily: 'var(--font-mono)' }}>
                      <div>Confidence: {(det.confidence * 100).toFixed(1)}%</div>
                      <div>Evidence Frames: {det.evidence_frames} verified</div>
                      <div>Bounding Box: [{det.bounding_box.map(b => b.toFixed(2)).join(', ')}]</div>
                      <div>Provenance: <span style={{ fontWeight: 600 }}>{det.source_provenance || 'SIMULATION'}</span></div>
                      <div>Timestamp: {det.timestamp}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Simulation Lab & Physics Engine */}
      {activeTab === 'simulator' && (
        <div style={{ padding: '24px' }}>
          <div className="mission-card">
            <div className="card-header">
              <h3><Cpu size={18} /> Deterministic Environmental & Physics Simulator</h3>
              <span className="badge-tag">SCENARIO: {activeScenario}</span>
            </div>
            <div className="card-body">
              <p style={{ marginBottom: '16px', color: 'var(--text-muted)' }}>
                Provides repeatable fault injection scenarios to validate SAGE risk reasoning, event propagation, and communication reliability.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div style={{ border: '1px solid var(--border-subtle)', padding: '16px', borderRadius: '4px', background: '#fcfbf8' }}>
                  <h4 style={{ fontFamily: 'var(--font-serif)', fontSize: '16px', marginBottom: '10px' }}>Repeatable Scenarios Matrix</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <button className="btn-ctrl" onClick={() => triggerScenario("GAS_ALERT", "/api/simulator/fault/gas")}>
                      <Zap size={14} /> Inject Gas & Combustion Alert
                    </button>
                    <button className="btn-ctrl" onClick={() => triggerScenario("OBSTACLE_PROXIMITY", "/api/simulator/fault/obstacle")}>
                      <Zap size={14} /> Inject Critical Obstacle Proximity (&lt; 10 cm)
                    </button>
                    <button className="btn-ctrl" onClick={() => triggerScenario("LOW_BATTERY", "/api/simulator/fault/battery")}>
                      <Zap size={14} /> Inject Low Battery Alert (&lt; 15%)
                    </button>
                    <button className="btn-ctrl" onClick={() => triggerScenario("COMM_LOSS", "/api/simulator/fault/comm_loss")}>
                      <Zap size={14} /> Inject Communication Loss Scenario
                    </button>
                    <button className="btn-ctrl" onClick={() => triggerScenario("INVALID_SENSOR", "/api/simulator/fault/invalid_sensor")}>
                      <Zap size={14} /> Inject Corrupted / Invalid Sensor Bus
                    </button>
                  </div>
                </div>

                <div style={{ border: '1px solid var(--border-subtle)', padding: '16px', borderRadius: '4px', background: '#fcfbf8' }}>
                  <h4 style={{ fontFamily: 'var(--font-serif)', fontSize: '16px', marginBottom: '10px' }}>Simulator Loop & Baseline Control</h4>
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '14px' }}>
                    Reversible scenario control: reset restores all sensor values, SAGE calculations, and dead reckoning to baseline.
                  </p>
                  <button className="btn-ctrl" style={{ width: '100%', justifyContent: 'center' }} onClick={resetSimulator}>
                    <RefreshCw size={14} /> Restore Baseline Parameters (Reset)
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Contracts, Diagnostics & Command Acknowledgement Log */}
      {activeTab === 'contracts' && (
        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="mission-card">
            <div className="card-header">
              <h3><Terminal size={18} /> Bidirectional Command History & Acknowledgement Log</h3>
              <span className="badge-tag">{commandLog.length} ACKNOWLEDGED</span>
            </div>
            <div className="card-body" style={{ padding: '0px' }}>
              <table className="events-table">
                <thead>
                  <tr>
                    <th>Command ID</th>
                    <th>Action</th>
                    <th>Execution State</th>
                    <th>Accepted</th>
                    <th>Reason</th>
                    <th>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {commandLog.map((ack) => (
                    <tr key={ack.command_id}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{ack.command_id}</td>
                      <td><strong>{ack.command}</strong></td>
                      <td>
                        <span className={`level-tag ${ack.status === 'REJECTED' ? 'CRITICAL' : 'INFO'}`}>
                          {ack.status}
                        </span>
                      </td>
                      <td>{ack.accepted ? 'YES' : 'NO'}</td>
                      <td style={{ fontSize: '12px' }}>{ack.reason}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{ack.timestamp}</td>
                    </tr>
                  ))}
                  {commandLog.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '16px', color: 'var(--text-muted)' }}>
                        No commands dispatched yet during this operator session.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mission-card">
            <div className="card-header">
              <h3><FileText size={18} /> System Diagnostics & Health Contract (v1.1.0)</h3>
              <span className="badge-tag">Pydantic & TypeScript Synchronized</span>
            </div>
            <div className="card-body">
              <pre style={{ background: '#1c1e22', color: '#e2e8f0', padding: '16px', borderRadius: '4px', overflowX: 'auto', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
{JSON.stringify(systemHealth, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="bottom-footer">
        <div>
          TERRA-SAFE X Reconnaissance OS • Operational Release v1.1.0 • Hardware Safety Interlocks Engaged
        </div>
        <div>
          Architecture: React (TS) + FastAPI + SAGE Guidance Engine + Simulator Bridge
        </div>
      </footer>
    </div>
  );
}

export default App;
