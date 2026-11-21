import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { RocketScene } from './render/RocketScene';
import { TrajectorySampler } from './render/trajectory';
import { buildSequenceTimes, downloadBlob, downloadDataURL, formatTime } from './render/export';
import { DEFAULT_SETTINGS, PARTICLE_TIERS, type RendererSettings, type SimState, type TrajectoryData } from './types';
import ControlPanel from './components/ControlPanel';
import Timeline from './components/Timeline';
import Hud from './components/Hud';

function makeSim(): SimState {
  return {
    time: 0,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    speed: 0,
    altitude: 0,
    throttle: 1,
    quaternion: new THREE.Quaternion(),
  };
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<RocketScene | null>(null);
  const samplerRef = useRef<TrajectorySampler | null>(null);
  const simRef = useRef<SimState>(makeSim());
  const settingsRef = useRef<RendererSettings>({ ...DEFAULT_SETTINGS });
  const timeRef = useRef(0);
  const playingRef = useRef(false);
  const speedRef = useRef<1 | 0.5>(1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [settings, setSettings] = useState<RendererSettings>({ ...DEFAULT_SETTINGS });
  const [trajName, setTrajName] = useState('加载中…');
  const [duration, setDuration] = useState(1);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [hud, setHud] = useState({ altitude: 0, speed: 0, throttle: 1, tier: PARTICLE_TIERS[0].label });
  const [error, setError] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null);

  const syncSettings = useCallback((patch: Partial<RendererSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      settingsRef.current = next;
      return next;
    });
  }, []);

  const loadSampler = useCallback((sampler: TrajectorySampler) => {
    samplerRef.current = sampler;
    setTrajName(sampler.name);
    setDuration(sampler.duration);
    timeRef.current = 0;
    setTime(0);
    playingRef.current = false;
    setPlaying(false);
    sampler.sample(0, simRef.current);
  }, []);

  const loadTrajectory = useCallback((data: TrajectoryData) => {
    loadSampler(new TrajectorySampler(data));
  }, [loadSampler]);

  // 初始化场景与内置示例弹道
  useEffect(() => {
    const canvas = canvasRef.current!;
    const scene = new RocketScene(canvas, simRef.current);
    sceneRef.current = scene;
    const ro = new ResizeObserver(() => {
      const w = wrapRef.current!.clientWidth;
      const h = wrapRef.current!.clientHeight;
      scene.resize(w, h);
    });
    ro.observe(wrapRef.current!);

    fetch(`${import.meta.env.BASE_URL}sample-trajectory.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: TrajectoryData) => {
        loadTrajectory(data);
        const w = wrapRef.current!.clientWidth;
        const h = wrapRef.current!.clientHeight;
        scene.resize(w, h);
      })
      .catch((e: Error) => setError(`示例弹道加载失败：${e.message}，请手动导入 JSON`));

    let raf = 0;
    let last = performance.now();
    let hudAcc = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const sampler = samplerRef.current;
      if (!sampler) {
        scene.update(0, settingsRef.current);
        return;
      }
      if (playingRef.current) {
        let t = timeRef.current + dt * speedRef.current;
        if (t >= sampler.duration) {
          t = sampler.duration;
          playingRef.current = false;
          setPlaying(false);
        }
        timeRef.current = t;
        setTime(t);
      }
      sampler.sample(timeRef.current, simRef.current);
      scene.update(timeRef.current, settingsRef.current);

      hudAcc += dt;
      if (hudAcc > 0.12) {
        hudAcc = 0;
        const s = simRef.current;
        setHud({
          altitude: s.altitude,
          speed: s.speed,
          throttle: s.throttle,
          tier: scene.currentTierLabel,
        });
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      scene.dispose();
    };
  }, [loadTrajectory]);

  const seek = useCallback((t: number) => {
    const clamped = THREE.MathUtils.clamp(t, 0, samplerRef.current?.duration ?? 0);
    timeRef.current = clamped;
    setTime(clamped);
    samplerRef.current?.sample(clamped, simRef.current);
  }, []);

  const onScrub = useCallback((t: number) => {
    playingRef.current = false;
    setPlaying(false);
    seek(t);
  }, [seek]);

  const togglePlay = useCallback(() => {
    if (!samplerRef.current) return;
    if (timeRef.current >= samplerRef.current.duration) timeRef.current = 0;
    playingRef.current = !playingRef.current;
    setPlaying(playingRef.current);
  }, []);

  const onImportFile = useCallback(async (file: File) => {
    try {
      const sampler = await TrajectorySampler.fromFile(file);
      loadSampler(sampler);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '弹道文件解析失败');
    }
  }, [loadTrajectory]);

  const exportFrame = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const url = scene.capturePNG();
    downloadDataURL(url, `rocket-frame-t${timeRef.current.toFixed(2)}s.png`);
  }, []);

  const exportSequence = useCallback(async () => {
    const scene = sceneRef.current;
    const sampler = samplerRef.current;
    if (!scene || !sampler || exportProgress) return;
    const times = buildSequenceTimes(sampler.frames.map((f) => f.t), 24);
    setExportProgress({ done: 0, total: times.length });
    try {
      const blobs = await scene.captureSequence(
        times,
        (t) => {
          timeRef.current = t;
          setTime(t);
          sampler.sample(t, simRef.current);
        },
        settingsRef.current,
        (done, total) => setExportProgress({ done, total }),
      );
      blobs.forEach((blob, i) => {
        setTimeout(() => {
          downloadBlob(blob, `rocket-keyframe-${String(i + 1).padStart(2, '0')}-t${times[i].toFixed(1)}s.png`);
        }, i * 250); // 错峰下载，避免浏览器拦截多文件
      });
    } finally {
      setTimeout(() => setExportProgress(null), 800);
    }
  }, [exportProgress]);

  return (
    <div className="app">
      <div ref={wrapRef} className="canvas-wrap">
        <canvas ref={canvasRef} />
        <Hud
          trajName={trajName}
          time={time}
          altitude={hud.altitude}
          speed={hud.speed}
          throttle={hud.throttle}
          tier={hud.tier}
        />
        {error && (
          <div className="error-banner">
            <span>{error}</span>
            <button onClick={() => setError(null)}>✕</button>
          </div>
        )}
        {exportProgress && (
          <div className="export-banner">
            截图序列生成中 {exportProgress.done}/{exportProgress.total}
            <div className="progress-bar"><i style={{ width: `${(exportProgress.done / exportProgress.total) * 100}%` }} /></div>
          </div>
        )}
      </div>

      <ControlPanel
        settings={settings}
        playing={playing}
        onPatch={syncSettings}
        onTogglePlay={togglePlay}
        onImportClick={() => fileInputRef.current?.click()}
        onExportFrame={exportFrame}
        onExportSequence={exportSequence}
        exporting={exportProgress !== null}
      />
      <Timeline time={time} duration={duration} onScrub={onScrub} formatTime={formatTime} />

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImportFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
