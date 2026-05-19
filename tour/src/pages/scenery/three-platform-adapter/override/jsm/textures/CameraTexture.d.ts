import { DataTexture } from 'three';
import {
  MagnificationTextureFilter,
  Mapping,
  MinificationTextureFilter,
  PixelFormat,
  TextureDataType,
  Wrapping
} from 'three/src/constants';

export class CameraTexture extends DataTexture {
  /**
   * @param mapping See {@link Texture.mapping | .mapping}. Default {@link THREE.Texture.DEFAULT_MAPPING}
   * @param wrapS See {@link Texture.wrapS | .wrapS}. Default {@link THREE.ClampToEdgeWrapping}
   * @param wrapT See {@link Texture.wrapT | .wrapT}. Default {@link THREE.ClampToEdgeWrapping}
   * @param magFilter See {@link Texture.magFilter | .magFilter}. Default {@link THREE.LinearFilter}
   * @param minFilter  See {@link Texture.minFilter | .minFilter}. Default {@link THREE.LinearFilter}
   * @param format See {@link Texture.format | .format}. Default {@link THREE.RGBAFormat}
   * @param type See {@link Texture.type | .type}. Default {@link THREE.UnsignedByteType}
   * @param anisotropy See {@link Texture.anisotropy | .anisotropy}. Default {@link THREE.Texture.DEFAULT_ANISOTROPY}
   */
  constructor(
    mapping?: Mapping,
    wrapS?: Wrapping,
    wrapT?: Wrapping,
    magFilter?: MagnificationTextureFilter,
    minFilter?: MinificationTextureFilter,
    format?: PixelFormat,
    type?: TextureDataType,
    anisotropy?: number
  );

  /**
   * Read-only flag to check if a given object is of type {@link VideoTexture}.
   * @remarks This is a _constant_ value
   * @defaultValue `true`
   */
  readonly isCameraTexture: true;

  /**
   * @override
   * @defaultValue {@link THREE.LinearFilter}
   */
  magFilter: MagnificationTextureFilter;

  /**
   * @override
   * @defaultValue {@link THREE.LinearFilter}
   */
  minFilter: MinificationTextureFilter;

  /**
   * @override
   * @defaultValue `false`
   */
  generateMipmaps: boolean;

  /**
   * @override
   * @defaultValue `true`
   */
  flipY: boolean;
}
