import type { Clip, ClipProperties } from '../../../types'

export type PreviewTool = 'select' | 'move' | 'resize' | 'rotate' | 'scale' | 'crop'
export type ObjectTransform = Required<Pick<ClipProperties, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'scale' | 'opacity' | 'flip_x' | 'flip_y'>>

export const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value))

export const round = (value: number, places = 2) => {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

export function getObjectTransform(clip: Clip, draft?: Partial<ClipProperties> | null): ObjectTransform {
  const text = clip.type === 'text'
  return {
    x: text ? 20 : 0,
    y: text ? 35 : 0,
    width: text ? 60 : 100,
    height: text ? 22 : 100,
    rotation: 0,
    scale: 1,
    opacity: 1,
    flip_x: false,
    flip_y: false,
    ...clip.props,
    ...draft,
  }
}

export type PointerGesture = {
  tool: Exclude<PreviewTool, 'select'|'crop'>
  startX: number
  startY: number
  centerX: number
  centerY: number
  initial: ObjectTransform
  initialAngle: number
}

export function getTransformDelta(
  gesture: PointerGesture,
  x: number,
  y: number,
  stageWidth: number,
  stageHeight: number,
): Partial<ClipProperties> {
  const { initial, startX, startY, centerX, centerY, tool, initialAngle } = gesture
  const dx = (x - startX) / Math.max(1, stageWidth) * 100
  const dy = (y - startY) / Math.max(1, stageHeight) * 100

  if (tool === 'move') return {
    x: round(clamp(initial.x + dx, -400, 400), 1),
    y: round(clamp(initial.y + dy, -400, 400), 1),
  }
  if (tool === 'resize') return {
    width: round(clamp(initial.width + dx / initial.scale, 2, 400), 1),
    height: round(clamp(initial.height + dy / initial.scale, 2, 400), 1),
  }
  if (tool === 'scale') {
    const distanceBefore = Math.hypot(startX - centerX, startY - centerY)
    const distanceNow = Math.hypot(x - centerX, y - centerY)
    return { scale: round(clamp(initial.scale * distanceNow / Math.max(8, distanceBefore), 0.1, 8), 2) }
  }
  const angleNow = Math.atan2(y - centerY, x - centerX)
  let angleChange = (angleNow - initialAngle) * 180 / Math.PI
  if (angleChange > 180) angleChange -= 360
  if (angleChange < -180) angleChange += 360
  return { rotation: round(clamp(initial.rotation + angleChange, -3600, 3600), 1) }
}

export const resetTransform: Partial<ClipProperties> = {
  x: 0, y: 0, width: 100, height: 100, scale: 1, rotation: 0, flip_x: false, flip_y: false,
}

/** UI crop value in source percentages. Cropping never changes timeline duration. */
export function calculateCropMargin(
  edge:'left'|'right'|'top'|'bottom', initial:number, opposite:number,
  deltaPixels:number, mediaPixels:number,
):number {
  const direction=edge==='right'||edge==='bottom'?-1:1
  return round(clamp(initial+direction*deltaPixels/Math.max(1,mediaPixels)*100,0,95-opposite),1)
}
