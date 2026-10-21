export type CatalogEntry = { name: string; group: string; kind: 'animation'|'effect'; engine: 'css'|'canvas'|'ffmpeg'; parameters: string[] }
const animationGroups: Record<string, string[]> = {
  Entrance: ['Fade In','Slide Left','Slide Right','Slide Up','Zoom In','Blur In'],
  Exit: ['Fade Out','Slide Out Left','Slide Out Right','Slide Down','Zoom Out','Blur Out'],
  Motion: ['Pan','Ken Burns','Orbit','Float','Bounce','Swing'],
  Emphasis: ['Pulse','Shake','Flash','Pop','Wobble','Spin'],
  Text: ['Typewriter','Character Reveal','Word Reveal','Line Reveal','Tracking Expand','Text Scramble'],
}
const effectGroups: Record<string, string[]> = {
  Color: ['Brightness','Contrast','Saturation','Exposure','Temperature','Tint','Hue','Gamma','Vibrance','Curves'],
  Looks: ['Black & White','Sepia','Vintage','Cinematic LUT','Film Grain','Vignette','Glow','Bloom','Light Leak','Sharpen'],
  Blur: ['Gaussian Blur','Motion Blur','Radial Blur','Pixelate','Mosaic','Lens Distortion','Chromatic Aberration','RGB Glitch','VHS','Scanlines'],
  Visual: ['Chroma Key','Edge Detect','Posterize','Invert','Mirror','Ripple','Wave','Drop Shadow','Outline','Noise'],
  Audio: ['Volume','Fade In','Fade Out','Equalizer','High Pass','Low Pass','Compressor','Limiter','Reverb','Noise Gate'],
}
export const animations: CatalogEntry[] = Object.entries(animationGroups).flatMap(([group,names]) => names.map(name => ({name,group,kind:'animation' as const,engine:'css' as const,parameters:['duration','delay','easing','loop']})))
export const effects: CatalogEntry[] = Object.entries(effectGroups).flatMap(([group,names]) => names.map(name => ({name,group,kind:'effect' as const,engine: group==='Audio' ? 'ffmpeg' as const : 'canvas' as const,parameters: group==='Audio' ? ['amount','mix'] : ['amount','enabled']})))
export const shapes = ['Text','Rectangle','Square','Circle','Ellipse','Triangle','Line','Arrow','Star','Polygon','Blur Box','Directional Blur Box','Mosaic Blur Box'] as const
