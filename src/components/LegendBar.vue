<script setup lang="ts">
import { CAPACITY_TIERS, INSUFFICIENT_COLOR, COOP_COLOR, COLLISION_COLOR } from '../domain/tiers'

const rgb = (c: number[]) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`
</script>

<template>
  <div class="legend">
    <div class="item" v-for="t in CAPACITY_TIERS" :key="t.minT">
      <span class="swatch" :style="{ background: rgb(t.color) }"></span>{{ t.label }}
    </div>
    <div class="item">
      <span class="swatch" :style="{ background: rgb(COOP_COLOR) }"></span>协同吊装区
    </div>
    <div class="item">
      <span class="swatch" :style="{ background: rgb(INSUFFICIENT_COLOR) }"></span>起重不足/缺口
    </div>
    <div class="item">
      <span class="swatch" :style="{ background: rgb(COLLISION_COLOR) }"></span>阻挡/碰撞
    </div>
  </div>
</template>
