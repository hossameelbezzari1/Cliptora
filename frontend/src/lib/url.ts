export function currentOrigin(){return window.location.origin}
export function currentLink(path:string){return new URL(path,currentOrigin()).toString()}
