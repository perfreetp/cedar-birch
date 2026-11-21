import { create } from 'zustand'

/** 仅用于 3D 视口与右侧面板之间的选中态通信 */
interface UiState {
  selectedSupplyId: string | null
  selectedReturnId: string | null
  selectSupply: (id: string | null) => void
  selectReturn: (id: string | null) => void
}

export const useUiStore = create<UiState>((set) => ({
  selectedSupplyId: null,
  selectedReturnId: null,
  selectSupply: (id) => set({ selectedSupplyId: id, selectedReturnId: id ? null : undefined }),
  selectReturn: (id) => set({ selectedReturnId: id, selectedSupplyId: id ? null : undefined }),
}))
