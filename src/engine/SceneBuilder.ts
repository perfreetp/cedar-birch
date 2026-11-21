import * as THREE from 'three'
import type { Equipment, ReturnVent, RoomSpec, SupplyVent } from '../types'
import { returnVentWorldPos, ventDirection } from '../lib/geometry'

export interface SceneBuildResult {
  root: THREE.Group
  supplyRoots: Map<string, THREE.Object3D>
  returnRoots: Map<string, THREE.Object3D>
  equipmentRoots: Map<string, THREE.Object3D>
}

/** 依据布局数据构建静态场景;布局版本变化时整体重建并释放旧资源 */
export class SceneBuilder {
  build(
    room: RoomSpec,
    equipment: Equipment[],
    supplies: SupplyVent[],
    returns: ReturnVent[],
  ): SceneBuildResult {
    const root = new THREE.Group()
    root.name = 'sceneRoot'
    const supplyRoots = new Map<string, THREE.Object3D>()
    const returnRoots = new Map<string, THREE.Object3D>()
    const equipmentRoots = new Map<string, THREE.Object3D>()

    this.buildRoom(root, room)
    for (const eq of equipment) this.buildEquipment(root, eq, equipmentRoots)
    for (const sv of supplies) this.buildSupply(root, room, sv, supplyRoots)
    for (const rv of returns) this.buildReturn(root, room, rv, returnRoots)
    return { root, supplyRoots, returnRoots, equipmentRoots }
  }

  private buildRoom(root: THREE.Group, room: RoomSpec): void {
    const { width: W, depth: D, height: H } = room
    const hx = W / 2
    const hz = D / 2

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(W, D),
      new THREE.MeshStandardMaterial({ color: 0x1b2330, roughness: 0.85, metalness: 0.1 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = 0
    floor.receiveShadow = true
    root.add(floor)

    // 地面参考网格
    const grid = new THREE.GridHelper(Math.max(W, D), Math.max(W, D), 0x3a4a63, 0x2a3648)
    grid.position.y = 0.005
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = 0.5
    root.add(grid)

    // 半透明墙面 + 墙边线框
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x6fa8dc,
      transparent: true,
      opacity: 0.07,
      roughness: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x8fb8e8, transparent: true, opacity: 0.75 })
    const wallGeo = (w: number, h: number) => new THREE.PlaneGeometry(w, h)
    const walls: Array<[THREE.PlaneGeometry, [number, number, number], [number, number, number]]> = [
      [wallGeo(W, H), [0, H / 2, -hz], [0, 0, 0]],
      [wallGeo(W, H), [0, H / 2, hz], [0, 0, 0]],
      [wallGeo(D, H), [-hx, H / 2, 0], [0, Math.PI / 2, 0]],
      [wallGeo(D, H), [hx, H / 2, 0], [0, Math.PI / 2, 0]],
    ]
    for (const [geo, pos, rot] of walls) {
      const mesh = new THREE.Mesh(geo, wallMat)
      mesh.position.set(...pos)
      mesh.rotation.set(...rot)
      root.add(mesh)
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat)
      edges.position.copy(mesh.position)
      edges.rotation.copy(mesh.rotation)
      root.add(edges)
    }

    // 顶棚(略透明,便于俯看)
    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(W, D),
      new THREE.MeshStandardMaterial({
        color: 0x243447,
        transparent: true,
        opacity: 0.25,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    ceil.rotation.x = Math.PI / 2
    ceil.position.y = H
    root.add(ceil)
  }

  private buildEquipment(
    root: THREE.Group,
    eq: Equipment,
    map: Map<string, THREE.Object3D>,
  ): void {
    const g = new THREE.Group()
    g.position.set(eq.x, 0, eq.z)
    g.rotation.y = eq.rotation
    g.userData.equipId = eq.id

    const box = new THREE.Mesh(
      new THREE.BoxGeometry(eq.w, eq.h, eq.d),
      new THREE.MeshStandardMaterial({
        color: eq.color,
        roughness: 0.55,
        metalness: 0.25,
        transparent: true,
        opacity: 0.92,
      }),
    )
    box.position.y = eq.h / 2
    g.add(box)
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(box.geometry),
      new THREE.LineBasicMaterial({ color: 0xd7e8ff }),
    )
    edges.position.copy(box.position)
    g.add(edges)
    root.add(g)
    map.set(eq.id, g)
  }

  private buildSupply(
    root: THREE.Group,
    room: RoomSpec,
    sv: SupplyVent,
    map: Map<string, THREE.Object3D>,
  ): void {
    const g = new THREE.Group()
    g.position.set(sv.x, room.height, sv.z)
    g.userData.ventId = sv.id

    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 0.06, 20),
      new THREE.MeshStandardMaterial({ color: 0x35e0e8, emissive: 0x0e5a60, roughness: 0.3 }),
    )
    plate.position.y = -0.03
    g.add(plate)

    // 方向箭头:同时表达方位角与倾角
    const [dx, dy, dz] = ventDirection(sv)
    const dir = new THREE.Vector3(dx, dy, dz).normalize()
    const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(0, -0.1, 0), 0.55, 0x9ef7ff, 0.16, 0.1)
    g.add(arrow)

    root.add(g)
    map.set(sv.id, g)
  }

  private buildReturn(
    root: THREE.Group,
    room: RoomSpec,
    rv: ReturnVent,
    map: Map<string, THREE.Object3D>,
  ): void {
    const g = new THREE.Group()
    const [x, y, z] = returnVentWorldPos(rv, room)
    g.position.set(x, y, z)
    g.userData.returnId = rv.id

    const horizontal = rv.wall === 'west' || rv.wall === 'east'
    const geo = horizontal
      ? new THREE.BoxGeometry(0.06, rv.height, rv.width)
      : new THREE.BoxGeometry(rv.width, rv.height, 0.06)
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0xff7a45, emissive: 0x5c1f08, roughness: 0.4 }),
    )
    g.add(mesh)
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0xffc2a8 }),
    )
    g.add(edges)
    root.add(g)
    map.set(rv.id, g)
  }

  dispose(root: THREE.Group): void {
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
        obj.geometry?.dispose()
        const m = obj.material
        if (Array.isArray(m)) m.forEach((mm) => mm.dispose())
        else m?.dispose()
      }
    })
  }
}
