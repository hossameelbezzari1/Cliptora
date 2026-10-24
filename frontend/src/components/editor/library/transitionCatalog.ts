/** CLIPTORA transition metadata and illustrative thumbnail catalogue.
 *  This catalogue does not imply that the video export engine renders these transitions.
 */
export type TransitionGroup = 'Fade' | 'Slide' | 'Wipe' | 'Zoom' | 'Blur' | 'Glitch' | '3D'
export type TransitionDefinition = {
  id: string
  name: string
  group: TransitionGroup
  thumbnail: string
  description: string
  duration: number
}
const asset = '/assets/cliptora-transitions/'
const make = (id: string, name: string, group: TransitionGroup, thumbnail: string, description: string, duration = 0.5): TransitionDefinition =>
  ({ id, name, group, thumbnail: `${asset}${thumbnail}.webp`, description, duration })

export const transitions: TransitionDefinition[] = [
  make('cross-fade','Cross Fade','Fade','cross-fade','Smoothly blends the end of one clip into the next.'),
  make('fade-black','Fade to Black','Fade','fade-black','Fades the outgoing clip to black before revealing the next.'),
  make('fade-white','Fade to White','Fade','fade-white','A bright white flash between two clips.'),
  make('slide-left','Slide Left','Slide','slide-left','Slides the next frame in from the right.'),
  make('slide-right','Slide Right','Slide','slide-right','Slides the next frame in from the left.'),
  make('slide-up','Slide Up','Slide','slide-up','Slides the incoming frame upward.'),
  make('slide-down','Slide Down','Slide','slide-down','Slides the incoming frame downward.'),
  make('push-left','Push Left','Slide','push-left','New image pushes the current image to the left.'),
  make('push-right','Push Right','Slide','push-right','New image pushes the current image to the right.'),
  make('push-up','Push Up','Slide','push-up','Vertical push upward.'),
  make('push-down','Push Down','Slide','push-down','Vertical push downward.'),
  make('wipe-left','Wipe Left','Wipe','wipe-left','Reveals the next clip from right to left.'),
  make('wipe-right','Wipe Right','Wipe','wipe-right','Reveals the next clip from left to right.'),
  make('wipe-up','Wipe Up','Wipe','wipe-up','Bottom-to-top reveal.'),
  make('wipe-down','Wipe Down','Wipe','wipe-down','Top-to-bottom reveal.'),
  make('zoom-in','Zoom In','Zoom','zoom-in','Incoming clip zooms toward the viewer.'),
  make('zoom-out','Zoom Out','Zoom','zoom-out','Outgoing zoom reveals the incoming image.'),
  make('zoom-blur','Zoom Blur','Zoom','zoom-blur','Zoom-in with an illustrative motion blur.'),
  make('rotate','Rotate','3D','rotate','Rotational frame change.',0.8),
  make('flip','Flip','3D','flip','Horizontal card flip between clips.',0.8),
  make('cube','Cube','3D','cube','A cube-like face rotation.',0.8),
  make('page-turn','Page Turn','3D','page-turn','Page folding away to expose another frame.',0.8),
  make('glitch','Glitch','Glitch','glitch','Digital RGB displacement and flicker.',0.8),
  make('pixelate','Pixelate','Glitch','pixelate','Pixelated reveal with coarse visual blocks.'),
  make('blur-cross','Blur Crossfade','Blur','zoom-blur','Soft focus while both frames blend.'),
  make('directional-blur','Directional Blur','Blur','zoom-blur','Blur sweeping across the frame.'),
  make('radial-blur','Radial Blur','Blur','zoom-blur','Radial blur between frames.'),
  make('iris-open','Iris Open','Wipe','wipe-up','Circular reveal from the center.'),
  make('iris-close','Iris Close','Wipe','wipe-down','Circular reveal closing inward.'),
  make('diagonal-wipe','Diagonal Wipe','Wipe','wipe-right','Angular wipe across the canvas.'),
  make('split-horizontal','Split Horizontal','Wipe','wipe-left','Reveal from two halves of the frame.'),
  make('split-vertical','Split Vertical','Wipe','wipe-down','Reveal from the top and bottom halves.'),
  make('slide-diagonal','Slide Diagonal','Slide','slide-left','Incoming clip moves along a diagonal.'),
  make('squeeze','Squeeze','3D','flip','Outgoing image compresses to reveal the next.'),
  make('swing','Swing','3D','rotate','A swing-like frame rotation.'),
  make('color-flash','Color Flash','Fade','fade-white','A bright flash with a fast blend.'),
  make('fade-through','Fade Through','Fade','fade-black','A cinematic mid-tone dip between scenes.'),
  make('film-burn','Film Burn','Glitch','glitch','Light leak transition illustration.'),
  make('shutter','Shutter','Wipe','wipe-right','Quick shutter-like opening.'),
  make('whip-pan','Whip Pan','Blur','zoom-blur','Fast movement with directional blur.'),
]
export const transitionGroups: TransitionGroup[] = ['Fade', 'Slide', 'Wipe', 'Zoom', 'Blur', 'Glitch', '3D']
export type TransitionSettings = { duration: number; easing: 'Linear' | 'Ease In' | 'Ease Out' | 'Ease In Out'; blend: 'Normal' | 'Screen' | 'Multiply'; intensity: number; applyAudio: boolean }
export const defaultTransitionSettings = (entry: TransitionDefinition): TransitionSettings => ({ duration: entry.duration, easing: 'Linear', blend: 'Normal', intensity: 1, applyAudio: true })
export const transitionPayload = (entry: TransitionDefinition, settings: TransitionSettings) => ({
  preset_type: 'transition',
  transition_id: entry.id,
  group: entry.group,
  engine: 'preview-css-demo',
  thumbnail: entry.thumbnail,
  ...settings,
})
