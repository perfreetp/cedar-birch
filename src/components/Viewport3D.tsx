import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { useAppStore } from '../store/useAppStore'
import { useUiStore } from '../store/useUiStore'
import { ParticleSystem, type EngineStats } from '../engine/ParticleSystem'
import { SceneBuilder } from '../engine/SceneBuilder'
import { registerEngine } from '../engine/bridge'
import { clamp } from '../lib/geometry'

type ViewMode = 'persp' | 'top' | 'front'

interface CameraHandle {
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
}

export function Viewport3D(): React.JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null)
  const cameraRef = useRef<CameraHandle | null>(null)
  const [stats, setStats] = useState<EngineStats>({ fps: 0, alive: 0, avgAge: 0, maxDensity: 0, avgLife: 0 })
  const [viewMode, setViewMode] = useState<ViewMode>('persp')

  useEffect(() => {
    const mount = mountRef.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0d1420)
    scene.fog = new THREE.Fog(0x0d1420, 26, 60)

    const camera = new THREE.PerspectiveCamera(55, mount.clientWidth / mount.clientHeight, 0.05, 200)
    camera.position.set(11, 9, 12)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI * 0.495
    controls.target.set(0, 1.2, 0)
    cameraRef.current = { camera, controls }

    scene.add(new THREE.HemisphereLight(0xbcd8ff, 0x223044, 0.9))
    const dir = new THREE.DirectionalLight(0xffffff, 1.4)
    dir.position.set(8, 14, 6)
    scene.add(dir)
    const fill = new THREE.DirectionalLight(0x6f8fff, 0.35)
    fill.position.set(-10, 6, -8)
    scene.add(fill)

    const builder = new SceneBuilder()
    let builtRoot: THREE.Group | null = null
    let built: ReturnType<SceneBuilder['build']> | null = null

    const initial = useAppStore.getState()
    const engine = new ParticleSystem(scene, initial.room, initial.settings)
    engine.syncLayout(initial.room, initial.equipment, initial.supplies, initial.returns)
    engine.onStats(setStats)
    registerEngine(engine)

    // 选中高亮环
    const highlight = new THREE.Mesh(
      new THREE.RingGeometry(0.26, 0.34, 28),
      new THREE.MeshBasicMaterial({ color: 0xffe14d, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }),
    )
    highlight.rotation.x = -Math.PI / 2
    highlight.visible = false
    scene.add(highlight)

    // 切片平面边框 + 拖动柄
    const sliceFrame = new THREE.LineLoop(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x7ff3ff, transparent: true, opacity: 0.9 }),
    )
    const handle = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 18, 14),
      new THREE.MeshBasicMaterial({ color: 0x7ff3ff }),
    )
    handle.userData.sliceHandle = true
    scene.add(sliceFrame, handle)

    function rebuild(): void {
      const st = useAppStore.getState()
      if (builtRoot) {
        builder.dispose(builtRoot)
        scene.remove(builtRoot)
      }
      built = builder.build(st.room, st.equipment, st.supplies, st.returns)
      builtRoot = built.root
      scene.add(builtRoot)
      engine.syncLayout(st.room, st.equipment, st.supplies, st.returns)
      sliceFrame.geometry.dispose()
      sliceFrame.geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-st.room.width / 2, 0, -st.room.depth / 2),
        new THREE.Vector3(st.room.width / 2, 0, -st.room.depth / 2),
        new THREE.Vector3(st.room.width / 2, 0, st.room.depth / 2),
        new THREE.Vector3(-st.room.width / 2, 0, st.room.depth / 2),
      ])
      applySettings()
      applyHighlight()
    }

    function applySettings(): void {
      const st = useAppStore.getState()
      engine.setSettings(st.settings)
      const show = st.settings.sliceEnabled
      sliceFrame.visible = show
      handle.visible = show
      if (show) {
        const y = st.settings.sliceHeight
        sliceFrame.position.y = y
        handle.position.set(0, y, st.room.depth / 2 - 0.3)
      }
    }

    function applyHighlight(): void {
      const st = useAppStore.getState()
      const ui = useUiStore.getState()
      const g = ui.selectedSupplyId ? built?.supplyRoots.get(ui.selectedSupplyId) : null
      if (g) {
        highlight.visible = true
        highlight.position.set(g.position.x, st.room.height + 0.005, g.position.z)
      } else {
        highlight.visible = false
      }
    }

    rebuild()

    // ---- 射线拾取(送风口)与切片柄拖动 ----
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let downX = 0
    let downY = 0
    let draggingHandle = false

    function setPointer(e: PointerEvent): void {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    }

    function findUserData(obj: THREE.Object3D, key: string): THREE.Object3D | null {
      let cur: THREE.Object3D | null = obj
      while (cur) {
        if (cur.userData[key]) return cur
        cur = cur.parent
      }
      return null
    }

    function onPointerDown(e: PointerEvent): void {
      downX = e.clientX
      downY = e.clientY
      setPointer(e)
      raycaster.setFromCamera(pointer, camera)
      const hitHandle = raycaster.intersectObject(handle, false)
      if (hitHandle.length && useAppStore.getState().settings.sliceEnabled) {
        draggingHandle = true
        controls.enabled = false
      }
    }

    function onPointerMove(e: PointerEvent): void {
      if (!draggingHandle) return
      setPointer(e)
      raycaster.setFromCamera(pointer, camera)
      // 与过柄中心的竖直线求最近点,只改高度
      const ray = raycaster.ray
      const c = handle.position
      const wv = ray.origin.clone().sub(new THREE.Vector3(c.x, 0, c.z))
      const t = new THREE.Vector3(0, wv.y, 0)
        .sub(wv)
        .dot(ray.direction) / ray.direction.lengthSq()
      const closest = ray.origin.clone().add(ray.direction.clone().multiplyScalar(t))
      const st = useAppStore.getState()
      st.setSettings({ sliceHeight: clamp(closest.y, 0.1, st.room.height - 0.1) })
    }

    function onPointerUp(e: PointerEvent): void {
      if (draggingHandle) {
        draggingHandle = false
        controls.enabled = true
        return
      }
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY)
      if (moved > 5 || useAppStore.getState().page !== 1) return
      setPointer(e)
      raycaster.setFromCamera(pointer, camera)
      const roots = built ? [...built.supplyRoots.values()] : []
      const hits = raycaster.intersectObjects(roots, true)
      if (hits.length) {
        const g = findUserData(hits[0].object, 'ventId')
        if (g) useUiStore.getState().selectSupply(g.userData.ventId)
      } else {
        useUiStore.getState().selectSupply(null)
      }
    }

    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup', onPointerUp)

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth
      const h = mount.clientHeight
      if (w === 0 || h === 0) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    })
    ro.observe(mount)

    const unsubStore = useAppStore.subscribe((st, prev) => {
      if (st.layoutVersion !== prev.layoutVersion) rebuild()
      if (st.settings !== prev.settings) applySettings()
      if (st.page !== prev.page) applyHighlight()
    })
    const unsubUi = useUiStore.subscribe(() => applyHighlight())

    const clock = new THREE.Clock()
    let raf = 0
    function animate(): void {
      raf = requestAnimationFrame(animate)
      const dt = clock.getDelta()
      engine.step(dt)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(raf)
      unsubStore()
      unsubUi()
      ro.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      engine.dispose()
      registerEngine(null)
      if (builtRoot) {
        builder.dispose(builtRoot)
        scene.remove(builtRoot)
      }
      sliceFrame.geometry.dispose()
      handle.geometry.dispose()
      highlight.geometry.dispose()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
      cameraRef.current = null
    }
  }, [])

  function applyView(mode: ViewMode): void {
    setViewMode(mode)
    const h = cameraRef.current
    if (!h) return
    const room = useAppStore.getState().room
    const span = Math.max(room.width, room.depth)
    h.controls.target.set(0, room.height * 0.4, 0)
    if (mode === 'top') {
      h.camera.position.set(0, span * 1.15, 0.001)
    } else if (mode === 'front') {
      h.camera.position.set(0, room.height * 0.9, span * 1.05)
    } else {
      h.camera.position.set(span * 0.85, room.height * 2.4, span * 0.95)
    }
    h.controls.update()
  }

  const simRunning = useAppStore((s) => s.settings.running)
  const sliceOn = useAppStore((s) => s.settings.sliceEnabled)

  return (
    <div className="viewport">
      <div ref={mountRef} className="viewport-canvas" />
      <div className="viewport-overlay">
        <div className="view-buttons">
          <button className={viewMode === 'persp' ? 'active' : ''} onClick={() => applyView('persp')}>透视</button>
          <button className={viewMode === 'top' ? 'active' : ''} onClick={() => applyView('top')}>俯视</button>
          <button className={viewMode === 'front' ? 'active' : ''} onClick={() => applyView('front')}>正视</button>
        </div>
        <div className="stats">
          <span>FPS {stats.fps}</span>
          <span>粒子 {stats.alive}</span>
          <span>平均停留 {stats.avgAge.toFixed(1)}s</span>
          {sliceOn && <span>切片峰值 {stats.maxDensity}</span>}
          <span className={simRunning ? 'dot-on' : 'dot-off'}>{simRunning ? '运行中' : '已暂停'}</span>
        </div>
      </div>
    </div>
  )
}
