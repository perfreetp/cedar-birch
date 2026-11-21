/** 铰链曲线 / 甘特图共享配色（十六进制），最多支持 8 节铰链 */
export const HINGE_COLORS = [
  '#4fc3f7',
  '#81c784',
  '#ffb74d',
  '#ba68c8',
  '#f06292',
  '#4dd0e1',
  '#aed581',
  '#ff8a65'
]

export function hingeColor(i: number): string {
  return HINGE_COLORS[i % HINGE_COLORS.length]
}
