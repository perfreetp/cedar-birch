// troika-three-text 三维标注: 眼壁最大风速位置
import * as THREE from 'three';
import { Text } from 'troika-three-text';

const FONT_URL = '/vendor/fonts/noto-sc-500.woff';

export class EyewallAnnotation {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    // 定位标记: 发光小球 + 竖线
    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, 20, 20),
      new THREE.MeshBasicMaterial({ color: 0xffd166, toneMapped: false })
    );
    this.group.add(this.marker);

    this.stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 14, 8),
      new THREE.MeshBasicMaterial({
        color: 0xffd166,
        transparent: true,
        opacity: 0.65,
        toneMapped: false,
      })
    );
    this.group.add(this.stem);

    this.text = new Text();
    this.text.font = FONT_URL;
    this.text.fontSize = 9;
    this.text.color = 0xffe9b0;
    this.text.anchorX = 'left';
    this.text.anchorY = 'bottom';
    this.text.outlineWidth = 0.9;
    this.text.outlineColor = 0x1a1206;
    this.text.maxWidth = 180;
    this.text.whiteSpace = 'overflowWrap';
    this.group.add(this.text);

    this._t0 = performance.now();
    this.visible = false;
  }

  update(loc, state) {
    if (!loc) {
      this.visible = false;
      this.group.visible = false;
      return;
    }
    this.visible = true;
    this.group.visible = true;
    this.marker.position.set(loc.x, loc.y, loc.z);
    this.stem.position.set(loc.x, loc.y + 7, loc.z);
    this.text.position.set(loc.x + 6, loc.y + 16, loc.z);

    const lines = [
      `眼壁最大风速  Vmax ${loc.vmax.toFixed(1)} m/s`,
      `高度 ${Math.round(loc.y / 0.6)} km · ${state.time}`,
      `中心气压 ${state.centralPressure.toFixed(1)} hPa`,
    ];
    this.text.text = lines.join('\n');
    this.text.sync(() => {
      // 字体加载失败时 troika 会静默回退, 这里无需额外处理
    });
  }

  // 标注始终面向相机
  faceCamera(camera) {
    if (!this.visible) return;
    this.text.quaternion.copy(camera.quaternion);
    const pulse = 1 + 0.25 * Math.sin((performance.now() - this._t0) / 260);
    this.marker.scale.setScalar(pulse);
  }

  dispose() {
    this.text.dispose();
  }
}
