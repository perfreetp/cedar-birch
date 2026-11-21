import { useEffect } from 'react';
import { world } from './sim/world';
import { bumpAll } from './state/store';
import Toolbar from './components/Toolbar';
import SidePanel from './components/SidePanel';
import Timeline from './components/Timeline';
import Viewport from './components/Viewport';

export default function App() {
  useEffect(() => {
    // 启动即生成演示数据：1200 点位、3 辆车
    world.generateDemo(1200, 3);
    bumpAll();
  }, []);
  return (
    <div className="app">
      <Toolbar />
      <div className="main">
        <Viewport />
        <SidePanel />
      </div>
      <Timeline />
    </div>
  );
}
