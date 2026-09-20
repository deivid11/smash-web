import * as THREE from 'three';
import type { ModelPart, ModelTexture } from '../../../lib/hsd/model.ts';
import type { DecodedTexture } from '../../../lib/hsd/texture.ts';
interface Shared<T> { value:T; refs:number; evict:()=>void }
const geometries=new WeakMap<ModelPart,Shared<THREE.BufferGeometry>>();
const geometryOwners=new WeakMap<THREE.BufferGeometry,Shared<THREE.BufferGeometry>>();
const textures=new WeakMap<DecodedTexture,Map<string,Shared<THREE.Texture>>>();
const textureOwners=new WeakMap<THREE.Texture,Shared<THREE.Texture>>();
/** Immutable native geometry/texture storage is shared; palettes, material uniforms,
 * opacity and visibility remain instance-owned. Each instance retains once. */
export function modelGeometry(part:ModelPart,owned:Set<THREE.BufferGeometry>,build:()=>THREE.BufferGeometry):THREE.BufferGeometry {
  let entry=geometries.get(part);
  if(!entry){const value=build();entry={value,refs:0,evict:()=>geometries.delete(part)};geometries.set(part,entry);geometryOwners.set(value,entry);}
  if(!owned.has(entry.value)){owned.add(entry.value);entry.refs++;}return entry.value;
}
/** Phase 3.5: stage textures (minification-heavy) opt into mipmaps; fighter
 * textures keep the historical non-mipmapped sampling. The flag is part of
 * the share key so one image used both ways keeps two GPU uploads. */
export function modelTexture(source:ModelTexture,owned:Set<THREE.Texture>,mipmaps=false,releaseDecoded=true):THREE.Texture {
  let group=textures.get(source.image);if(!group){group=new Map();textures.set(source.image,group);}
  const key=`${source.wrapS}:${source.wrapT}:${mipmaps?1:0}`;let entry=group.get(key);
  if(!entry){
    const value=new THREE.DataTexture(source.image.pixels,source.image.width,source.image.height,THREE.RGBAFormat);
    const wrap=(mode:number)=>mode===1?THREE.RepeatWrapping:mode===2?THREE.MirroredRepeatWrapping:THREE.ClampToEdgeWrapping;
    value.wrapS=wrap(source.wrapS);value.wrapT=wrap(source.wrapT);value.magFilter=THREE.LinearFilter;value.minFilter=mipmaps?THREE.LinearMipmapLinearFilter:THREE.LinearFilter;value.generateMipmaps=mipmaps;value.flipY=false;value.needsUpdate=true;
    // Releasing the last GPU variant of an image drops its decoded RGBA too: the expansion is
    // 4-8x the source bytes, and boot uploads every fighter/stage once for portraits and previews.
    // Effect models opt out: they are built and disposed per burst, so re-decoding would hitch.
    entry={value,refs:0,evict:()=>{group!.delete(key);if(releaseDecoded&&!group!.size)source.image.release?.();}};group.set(key,entry);textureOwners.set(value,entry);
  }
  if(!owned.has(entry.value)){owned.add(entry.value);entry.refs++;}return entry.value;
}
function release<T extends {dispose():void}>(value:T,owners:WeakMap<T,Shared<T>>):void {
  const entry=owners.get(value);if(!entry)return;
  if(--entry.refs===0){entry.evict();owners.delete(value);value.dispose();}
}
export const releaseModelGeometry=(value:THREE.BufferGeometry):void=>release(value,geometryOwners);
export const releaseModelTexture=(value:THREE.Texture):void=>release(value,textureOwners);
