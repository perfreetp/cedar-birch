import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { BloomEffect, EffectComposer, EffectPass, FXAAEffect, RenderPass } from 'postprocessing'
import { VolumeManager } from '../volume/VolumeManager'
import { raymarchFrag, raymarchVert, sliceFrag, sliceVert } from '../volume/shaders'
import { services } from './services'
import { cameraBridge, useStore } from '../state/store'
import { wirePersistence } from '../io/importFlow'

const BG_COLOR = '#0b0e14'

export function Stage() {
  const mountRef = useRef<HTMLDivElement>(null)
  const selectRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mount = mountRef.current!
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(BG_COLOR)
    mount.appendChild(renderer.domElement)

    // ---- 相机与交互 ----
    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 200)
    camera.up.set(0, 0, 1)
    camera.position.set(3, 2.6, 2.8)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.12

    cameraBridge.get = () => ({
      position: camera.position.toArray() as [number, number, number],
      target: controls.target.toArray() as [number, number, number],
      up: camera.up.toArray() as [number, number, number],
    })
    cameraBridge.set = (c) => {
      camera.position.fromArray(c.position)
      controls.target.fromArray(c.target)
      camera.up.fromArray(c.up)
      controls.update()
    }

    // ---- 切面场景(渲染到带深度的 RT,供体渲染按深度合成) ----
    const sliceScene = new THREE.Scene()
    sliceScene.background = new THREE.Color(BG_COLOR)

    const dbSize = new THREE.Vector2()
    renderer.getDrawingBufferSize(dbSize)
    let sliceRT = makeSliceRT(dbSize.x, dbSize.y)

    // ---- 体数据管理 ----
    const volume = new VolumeManager(renderer)
    services.setVolume(volume)
    wirePersistence()
    volume.onProgress = (done, total) => useStore.getState().setProgress({ phase: 'bake', done, total })
    volume.onReady = () => useStore.getState().setProgress({ phase: 'ready', done: 0, total: 0 })

    // 1^3 占位纹理,避免空 sampler 警告
    const dummyTex = new THREE.Data3DTexture(new Uint8Array(4), 1, 1, 1)
    dummyTex.format = THREE.RGBAFormat
    dummyTex.needsUpdate = true

    // ---- 光线步进全屏 pass ----
    const raymat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: raymarchVert,
      fragmentShader: raymarchFrag,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uVol: { value: dummyTex },
        uSliceColor: { value: sliceRT.texture },
        uSliceDepth: { value: sliceRT.depthTexture },
        uBoxMin: { value: new THREE.Vector3(-1, -1, -1) },
        uBoxMax: { value: new THREE.Vector3(1, 1, 1) },
        uCamPos: { value: new THREE.Vector3() },
        uInvViewProj: { value: new THREE.Matrix4() },
        uLightPos: { value: new THREE.Vector3(2.5, 2.5, 2.5) },
        uLightColor: { value: new THREE.Vector3(1.6, 1.55, 1.5) },
        uAmbient: { value: 0.25 },
        uSteps: { value: 384 },
        uDensity: { value: 8 },
        uHasVolume: { value: 0 },
      },
    })
    const quadScene = new THREE.Scene()
    quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), raymat))
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

    // ---- 后期:FXAA + 可选辉光 ----
    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(quadScene, quadCam))
    const bloom = new BloomEffect({ intensity: 0 })
    composer.addPass(new EffectPass(camera, new FXAAEffect(), bloom))

    // ---- 切面网格 ----
    const sliceMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: sliceVert,
      fragmentShader: sliceFrag,
      side: THREE.DoubleSide,
      uniforms: {
        uRaw: { value: dummyTex },
        uLut: { value: volume.lutTex },
        uBoxMin: { value: new THREE.Vector3(-1, -1, -1) },
        uBoxMax: { value: new THREE.Vector3(1, 1, 1) },
        uChannel: { value: 0 },
      },
    })
    const planeX = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sliceMat)
    const planeY = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sliceMat)
    const planeZ = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sliceMat)
    const planeFree = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sliceMat)
    planeX.rotation.y = Math.PI / 2
    planeY.rotation.x = Math.PI / 2
    sliceScene.add(planeX, planeY, planeZ, planeFree)

    // 包围盒线框
    const boxLines = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0x4a5568 }),
    )
    boxLines.visible = false
    sliceScene.add(boxLines)

    // 光源手柄
    const lightMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffdd55 }),
    )
    sliceScene.add(lightMesh)

    // 拖动控制器(光源 / 自由切面共用一个)
    const tc = new TransformControls(camera, renderer.domElement)
    tc.addEventListener('dragging-changed', (e) => {
      controls.enabled = !e.value
    })
    tc.addEventListener('objectChange', () => {
      const st = useStore.getState()
      if (tc.object === lightMesh) {
        const p = lightMesh.position
        st.setLight({ ...st.light, pos: [p.x, p.y, p.z] })
      } else if (tc.object === planeFree) {
        const n = new THREE.Vector3(0, 0, 1).applyQuaternion(planeFree.quaternion)
        const theta = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(n.z, -1, 1)))
        const phi = THREE.MathUtils.radToDeg(Math.atan2(n.y, n.x))
        const center = new THREE.Vector3().addVectors(volume.boxMin, volume.boxMax).multiplyScalar(0.5)
        const halfDiag = volume.boxMax.clone().sub(volume.boxMin).length() / 2
        const offset = THREE.MathUtils.clamp(
          planeFree.position.clone().sub(center).dot(n) / halfDiag,
          -1,
          1,
        )
        st.setSlices({ ...st.slices, free: { ...st.slices.free, theta, phi, offset } })
      }
    })
    sliceScene.add(tc.getHelper())

    // ---- 框选放大 ----
    const selDiv = selectRef.current!
    let selStart: { x: number; y: number } | null = null
    const onPointerDown = (e: PointerEvent) => {
      if (!e.shiftKey) return
      selStart = { x: e.offsetX, y: e.offsetY }
      controls.enabled = false
      e.preventDefault()
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!selStart) return
      const rect = renderer.domElement.getBoundingClientRect()
      const x = Math.min(selStart.x, e.clientX - rect.left)
      const y = Math.min(selStart.y, e.clientY - rect.top)
      const w = Math.abs(e.clientX - rect.left - selStart.x)
      const h = Math.abs(e.clientY - rect.top - selStart.y)
      Object.assign(selDiv.style, { display: 'block', left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` })
    }
    const onPointerUp = (e: PointerEvent) => {
      if (!selStart) return
      const rect = renderer.domElement.getBoundingClientRect()
      const x2 = e.clientX - rect.left
      const y2 = e.clientY - rect.top
      const w = Math.abs(x2 - selStart.x)
      const h = Math.abs(y2 - selStart.y)
      selDiv.style.display = 'none'
      controls.enabled = true
      if (w > 12 && h > 12) {
        const cx = ((selStart.x + x2) / 2 / rect.width) * 2 - 1
        const cy = -(((selStart.y + y2) / 2 / rect.height) * 2 - 1)
        const raycaster = new THREE.Raycaster()
        raycaster.setFromCamera(new THREE.Vector2(cx, cy), camera)
        const dist = camera.position.distanceTo(controls.target)
        const newTarget = raycaster.ray.at(dist, new THREE.Vector3())
        const frac = Math.max(w / rect.width, h / rect.height)
        const newDist = dist * THREE.MathUtils.clamp(frac, 0.02, 1)
        const dir = camera.position.clone().sub(controls.target).normalize()
        controls.target.copy(newTarget)
        camera.position.copy(newTarget.clone().add(dir.multiplyScalar(newDist)))
      }
      selStart = null
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)

    // ---- 尺寸自适应 ----
    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth
      const h = mount.clientHeight
      if (w === 0 || h === 0) return
      renderer.setSize(w, h)
      composer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.getDrawingBufferSize(dbSize)
      sliceRT.setSize(dbSize.x, dbSize.y)
    })
    ro.observe(mount)

    // ---- 传输函数变更 → 重烘焙(防抖) ----
    let rebakeTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleRebake = () => {
      if (rebakeTimer) clearTimeout(rebakeTimer)
      rebakeTimer = setTimeout(() => {
        const st = useStore.getState()
        volume.rebake(st.tf, st.volumeChannel)
      }, 80)
    }

    // ---- 渲染循环 ----
    let raf = 0
    let frames = 0
    let fpsT0 = performance.now()
    let lastTfTemp = useStore.getState().tf.temp
    let lastTfSpeed = useStore.getState().tf.speed
    let lastVolCh = useStore.getState().volumeChannel
    const invVP = new THREE.Matrix4()
    const center = new THREE.Vector3()
    const bsize = new THREE.Vector3()
    const nrm = new THREE.Vector3()

    const loop = () => {
      raf = requestAnimationFrame(loop)
      const st = useStore.getState()

      // TF / 体渲染通道变化
      if (st.tf.temp !== lastTfTemp || st.tf.speed !== lastTfSpeed) {
        const activeChanged = st.tf[st.volumeChannel] !== (st.volumeChannel === 'temp' ? lastTfTemp : lastTfSpeed)
        volume.updateLuts(st.tf)
        if (activeChanged) scheduleRebake()
        lastTfTemp = st.tf.temp
        lastTfSpeed = st.tf.speed
      }
      if (st.volumeChannel !== lastVolCh) {
        lastVolCh = st.volumeChannel
        scheduleRebake()
      }
      if (volume.bakeRequested) {
        volume.bakeRequested = false
        scheduleRebake()
      }

      volume.update()

      // 体纹理 / 包围盒
      const hasVol = volume.volTex !== null
      raymat.uniforms.uHasVolume.value = hasVol ? 1 : 0
      if (hasVol && raymat.uniforms.uVol.value !== volume.volTex) raymat.uniforms.uVol.value = volume.volTex
      if (hasVol && sliceMat.uniforms.uRaw.value !== volume.rawTex) sliceMat.uniforms.uRaw.value = volume.rawTex
      raymat.uniforms.uBoxMin.value.copy(volume.boxMin)
      raymat.uniforms.uBoxMax.value.copy(volume.boxMax)
      sliceMat.uniforms.uBoxMin.value.copy(volume.boxMin)
      sliceMat.uniforms.uBoxMax.value.copy(volume.boxMax)
      sliceMat.uniforms.uChannel.value = st.activeChannel === 'temp' ? 0 : 1

      center.addVectors(volume.boxMin, volume.boxMax).multiplyScalar(0.5)
      bsize.subVectors(volume.boxMax, volume.boxMin)

      boxLines.visible = hasVol
      boxLines.position.copy(center)
      boxLines.scale.copy(bsize)

      // 切面
      planeX.visible = hasVol && st.slices.x.enabled
      planeX.position.set(volume.boxMin.x + st.slices.x.pos * bsize.x, center.y, center.z)
      planeX.scale.set(bsize.y, bsize.z, 1)
      planeY.visible = hasVol && st.slices.y.enabled
      planeY.position.set(center.x, volume.boxMin.y + st.slices.y.pos * bsize.y, center.z)
      planeY.scale.set(bsize.x, bsize.z, 1)
      planeZ.visible = hasVol && st.slices.z.enabled
      planeZ.position.set(center.x, center.y, volume.boxMin.z + st.slices.z.pos * bsize.z)
      planeZ.scale.set(bsize.x, bsize.y, 1)

      const free = st.slices.free
      planeFree.visible = hasVol && free.enabled
      const th = THREE.MathUtils.degToRad(free.theta)
      const ph = THREE.MathUtils.degToRad(free.phi)
      nrm.set(Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th))
      const halfDiag = bsize.length() / 2
      planeFree.position.copy(center).addScaledVector(nrm, free.offset * halfDiag)
      planeFree.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nrm)
      planeFree.scale.setScalar(bsize.length() * 1.2)

      // 光源
      lightMesh.position.fromArray(st.light.pos)
      raymat.uniforms.uLightPos.value.copy(lightMesh.position)
      raymat.uniforms.uLightColor.value.set(
        st.light.intensity * 1.0,
        st.light.intensity * 0.97,
        st.light.intensity * 0.92,
      )
      raymat.uniforms.uAmbient.value = st.light.ambient
      raymat.uniforms.uDensity.value = st.density

      // 编辑目标
      const target = st.editTarget === 'light' ? lightMesh : st.editTarget === 'slice' && free.enabled ? planeFree : null
      if (tc.object !== target) {
        if (target) tc.attach(target)
        else tc.detach()
      }
      if (target === planeFree && tc.mode !== st.tcMode) tc.setMode(st.tcMode)
      if (target === lightMesh && tc.mode !== 'translate') tc.setMode('translate')

      // 相机矩阵
      controls.update()
      camera.updateMatrixWorld()
      raymat.uniforms.uCamPos.value.copy(camera.position)
      invVP.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse)
      raymat.uniforms.uInvViewProj.value.copy(invVP)

      bloom.intensity = st.bloom

      // 渲染:切面场景 → RT,再 raymarch 合成 → 后期
      renderer.setRenderTarget(sliceRT)
      renderer.render(sliceScene, camera)
      renderer.setRenderTarget(null)
      composer.render()

      // FPS
      frames++
      const now = performance.now()
      if (now - fpsT0 >= 500) {
        st.setFps(Math.round((frames * 1000) / (now - fpsT0)))
        frames = 0
        fpsT0 = now
      }
    }
    loop()

    return () => {
      cancelAnimationFrame(raf)
      if (rebakeTimer) clearTimeout(rebakeTimer)
      ro.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      tc.detach()
      tc.dispose()
      controls.dispose()
      composer.dispose()
      sliceRT.dispose()
      volume.clear()
      dummyTex.dispose()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
      cameraBridge.get = null
      cameraBridge.set = null
      services.volume = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div ref={mountRef} className="stage">
      <div ref={selectRef} className="select-rect" />
    </div>
  )
}

function makeSliceRT(w: number, h: number): THREE.WebGLRenderTarget {
  const depthTexture = new THREE.DepthTexture(w, h)
  return new THREE.WebGLRenderTarget(w, h, {
    depthTexture,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  })
}
